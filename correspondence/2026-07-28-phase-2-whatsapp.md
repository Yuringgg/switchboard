# Handoff — Phase 2, WhatsApp

**2026-07-28.** Written for a session joining cold, and for Yuri. Read
`AGENTS.md` first, then `2026-07-28-phase-1-complete-handoff.md`, then this.

**Status: code complete, waiting on a Meta account.** Every line that can be
written without credentials is written, typechecked and tested. What is left is
clicks in the Meta dashboard, and they are §6 below.

---

## 1. What was built

| Piece | Where |
|---|---|
| Adapter | `packages/adapters/whatsapp` — `types`, `parse`, `normalize`, `index` |
| Fixtures | `fixtures/whatsapp/` — 13 payloads |
| Ingest | `apps/console/src/app/api/webhooks/whatsapp/route.ts` — now queues |
| Worker | `apps/worker/src/whatsapp-ingest.ts` + a branch in `index.ts` |
| Schema | migration `0006_channels_external_account.sql` — **applied and verified** |
| Provisioning | `packages/db/scripts/provision-whatsapp.ts` |
| Shared | `NormalizeResult` + `InboundRef` + `phone.ts` in `core` |

**286 tests pass** (was 183). `next build` green. The worker bundle boots and
binds its health endpoint. Migration 0006 confirmed against the live database:
column added nullable, partial unique index created, and **all ten tables still
report RLS enabled, RLS forced, and a policy carrying USING *and* WITH CHECK** —
the same assertion the CI job makes, run directly after the migration.

The pipeline is closed: Meta → HMAC verify → parse → channel lookup →
`raw_events` → worker → `normalize` → `persistMessage` → `messages` → Realtime →
timeline. Nothing in the console or the worker special-cases WhatsApp above the
adapter.

---

## 2. The refactor checkpoint — the actual point of the phase

`docs/04-ROADMAP.md` says this is *"where you find out whether the abstraction
was real or wishful."* It was both, and the split is the finding.

**Real.** WhatsApp is pure push where Gmail is hybrid push/pull with a cursor.
`CanonicalMessage` absorbed it without strain — one timeline, one
`persistMessage`, one set of identity rules, no branch anywhere above the
adapter. `whatsapp-ingest.ts` is 40 lines against Gmail's 200, and the
difference is entirely absence: no cursor, no credential, no network call.

**Wishful.** Three of `ChannelAdapter`'s five signatures **could not be
implemented**, and nothing had noticed because **nothing implemented the
interface**. Gmail ships as free functions, so the contract had been a comment
since Phase 0 — described, never checked.

| Signature | Why it was impossible |
|---|---|
| `verifyWebhook(headers, rawBody)` | no secret parameter — the only way to get one was `process.env` inside a package whose defining property is purity |
| `parseWebhook(): RawEvent[]` | `RawEvent` needs a `channelId`, which needs a database lookup — *the* lookup that decides `owner_id` |
| `normalize(event: RawEvent)` | `RawEvent` exists only at ingest; after the queue all that survives is a stored payload |

The middle one is the load-bearing one. Resolving a provider's account reference
to a channel is where `owner_id` is decided, the worker bypasses RLS, and no
policy catches a wrong answer. An interface that asked a *pure function* to
produce a `channelId` was quietly inviting an adapter to do that lookup.

**Fixed:** `InboundRef` was added — `{ accountRef, externalId, payload }` — so
the seam is explicit. **The adapter reports what the provider said; ingest
decides whose it is.** `NormalizeResult` moved to `core` (both adapters had
written the same union), and `whatsappAdapter` now implements the interface, so
the next drift fails `test/adapter.test.ts` instead of a code review nobody runs.

**The rule worth more than the signatures: a stored payload must be
self-sufficient.** WhatsApp's parse attaches the business number and the
sender's profile to each message, so `normalize` takes one argument. Gmail's
does not — a Gmail message resource never says which mailbox fetched it, so the
worker reads `display_name` from `channels` and passes it in. **Gmail was
deliberately not retrofitted.** It is carrying real mail in production, and
rewriting a working ingest path for symmetry is a risk taken for tidiness. Full
reasoning in **ADR-014**.

---

## 3. Decisions a future session should not silently reverse

**`body_text` is synthesised and `''` is legal — but nothing is invented.** A
photo with no caption has no text. Writing `"[image]"` would put a word in
`body_text` that nobody sent, and Phase 4 embeds that column: a corpus salted
with machine-written tokens returns them in search results. A location's name
and address, and a contact card's names, *are* used — those words came from the
sender.

**Reactions are stored, as their emoji.** A client reacting to a quote is an
answer, and dropping it makes the record silently incomplete. If they prove
noisy, filter them in the console — that is reversible; dropping at ingest is
not.

**A conversation is a chat, and a chat is a person.** WhatsApp has no thread id,
so `externalThreadId` is the counterparty's number. A reply's `context.id` names
a *quoted message*, not a thread — using it would make every quoted reply its
own conversation.

**One `raw_events` row per message, not per webhook.** The `wamid` is the only
id stable across Meta's redeliveries, and Meta retries for **up to 7 days**. A
row per webhook has no such key.

**`external_account_id` is unique per TYPE, not per owner.** A business number
belongs to exactly one tenant, and the ingest lookup runs *before* any owner is
known — that is its whole purpose. Scoping the constraint per owner would let
two owners register the same number and force the code to pick between two rows.
There is no correct way to pick.

**Media download deferred to Phase 3**, joining Gmail's. `attachments.blob_url`
is `not null`, the Blob container does not exist, and every reference survives in
`messages.payload_raw` — so it is a backfill, not a re-ingest. ⚠ One asymmetry:
Gmail attachments can be fetched whenever, but **WhatsApp media ids exchange for
a short-lived URL**, so that download cannot be deferred long after arrival.

---

## 4. Failure modes, and which are silent

| Symptom | Cause | How you can tell |
|---|---|---|
| Webhook 401s every time | `WHATSAPP_APP_SECRET` holds the *access token*, not the App Secret | logs: `rejected: bad or missing signature` |
| Handshake 403s | verify token mismatch | Meta shows the failure inline when you save |
| Everything 200s, nothing appears | **`messages` field not subscribed**, or no channel provisioned | logs: `queued=0 unknownNumber=N`, or no request at all |
| Variables set but still 503 | Vercel binds env vars **at deployment creation** — a variable added after does nothing until the next build | `/api/health/config` reports `deployment.commit` |
| Auth fails on a value you know is right | Vercel stores the field **verbatim**, so quotes pasted around a value become part of it | paste unquoted |

**The genuinely silent one is the unsubscribed `messages` field.** The webhook
URL verifies, the dashboard shows green, and Meta simply never delivers. There
is no error anywhere because nothing failed — it was never sent.

Two deliberate design choices that look like bugs:

- **A WhatsApp channel's `sync_state` row stays empty.** There is no cursor.
  Correct, not a symptom.
- **An unknown number returns 200, not 404.** Meta disables endpoints that
  keep answering non-2xx. Dropping a message during setup is recoverable; a
  disabled webhook is not.

---

## 5. Fixtures — read this before trusting them

**They were written from Meta's documentation, not recorded from traffic**,
because the test number did not exist yet. That is the one weak point in this
phase and it is flagged in `fixtures/whatsapp/README.md` too.

This project has already been burned by exactly that gap on the Gmail side —
header case and part nesting were both wrong until a real inbox corrected them.
**Re-record `text.json` and one media fixture against the real test number once
it is connected**, and note it in the README.

`batch.json` is the one that earns its place regardless of provenance: two
entries, two changes, two business numbers, four messages, one POST. Any
`[0]`-indexed parse returns one message and loses three, with no error.

---

## 6. What Yuri needs to do, in order

Each step's output feeds the next. Full version with the traps:
`docs/03-RESOURCES.md` §6.

1. **Meta developer account** — <https://developers.facebook.com>, "Get Started".
2. **Create an app**, type **Business**. Add the **WhatsApp** product.
3. **WhatsApp → API Setup.** A test number and a `phone_number_id` appear
   automatically. Copy the **phone number ID** and the **temporary access token**.
4. **Add recipients.** Same page, "To" → Manage phone number list. Add the number
   that will send test messages; it confirms with a code in WhatsApp. Up to 5.
5. **App settings → Basic → App Secret.** Copy it. ⚠ Not the access token.
6. **Invent a verify token** — any long random string.
7. **Vercel → switchboard-console → Settings → Environment Variables**, for
   Production **and** Preview, pasted **unquoted**:
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. **Then redeploy** — Vercel binds variables
   when a deployment is created.
8. **WhatsApp → Configuration → Webhook → Edit.** Callback URL
   `https://switchboard-console-beryl.vercel.app/api/webhooks/whatsapp`, verify
   token from step 6. Save — it should verify immediately. Then **Manage** and
   **subscribe the `messages` field.** This is the step that is silent if missed.
9. **Provision the number** against Yuri's user id:
   ```
   node --env-file=apps/worker/.env packages/db/scripts/provision-whatsapp.ts \
     --owner <uuid> --phone-number-id <id> --display "+1 555 078 3881"
   ```
   with `WHATSAPP_ACCESS_TOKEN` set in the environment.
10. **Send a WhatsApp message to the test number** from a verified recipient. It
    should appear in the timeline within seconds, marked WhatsApp, beside the
    Gmail messages. **That is Phase 2's done-condition, and it is the second
    screenshot worth showing Ms. Maria.**

---

## 7. Where to look when step 10 does not work

In this order, because it goes from cheapest to most expensive:

1. **The live database.** `select * from raw_events order by received_at desc
   limit 5;` — a row means ingest worked and the problem is the worker. No row
   means the problem is upstream. This project has twice concluded the wrong
   thing by reading code instead of checking here.
2. **Meta's dashboard**, WhatsApp → Configuration. It shows recent webhook
   deliveries and their response codes. A message you sent that produced no
   delivery attempt means the `messages` field is not subscribed.
3. **`/api/health/config`** — signed in. Reports which commit is serving, which
   is how "did my change actually deploy?" is answered by reading rather than
   inference.
4. **Vercel runtime logs.** The route logs counts on every call:
   `queued=N duplicates=N unknownNumber=N statuses=N unusable=N`. Between them
   those five numbers identify every failure in the table in §4.

---

## 8. What is left after that

Phase 3 — search, filters, contact detail with merged cross-channel history,
manual identity merge, attachments for **both** channels, virtualization.
**Search needs no new credentials and there are 16 real messages to search**, so
it is the useful thing to build while Meta is pending.

`docs/06-OPEN-QUESTIONS.md` Q2 — the consent conversation with Ms. Maria — still
gates real *client* data. Dogfooding on Yuri's own mailbox and a Meta test
number is fine.

`docs/00-CONTEXT.md` §6 item 2 — the Notion write-up for Ms. Maria — is still
pending and is a real deliverable to the mentor, not internal bookkeeping.

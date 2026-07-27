# Handoff — Phase 1 complete, Phase 2 next

**2026-07-28.** Written for a session joining cold. Read `AGENTS.md` first, then
this. Everything below was verified against the live system, not inferred.

---

## 1. What exists right now

**Phases 0 and 1 are complete.** An email arriving in Yuri's Gmail appears in a
deployed console within seconds, without a refresh.

| Piece | Where | State |
|---|---|---|
| Console | Vercel, `switchboard-console-beryl.vercel.app` | live, behind login |
| Database | Supabase `ytrkpcryztwgflmbhfdu`, ap-southeast-1 | 5 migrations applied |
| Worker | Azure Container Apps, Malaysia West, `minReplicas: 1` | running, ingesting |
| Repo | `github.com/Yuringgg/switchboard` | CI green on every push |
| Tests | `pnpm check` | 173 + 3 SQL suites |

The Gmail watch expires **2026-08-02** and the worker renews it at T-2 days,
sweeping every 6 hours. That renewal is the single most important background
job in the system — see §4.

---

## 2. The shape of the thing

```
Gmail ──watch──► Pub/Sub ──push──► /api/webhooks/gmail   (Vercel, serverless)
                                     verify OIDC → insert raw_events → 200
                                                          │
                                              raw_events = queue
                                                          ▼
                                   worker (Azure, warm, minReplicas 1)
                                     claim FOR UPDATE SKIP LOCKED
                                     → history.list from cursor
                                     → fetch → normalize → upsert
                                                          ▼
                                   Supabase Postgres (RLS forced, 10 tables)
                                                          │
                                          Realtime on `messages`
                                                          ▼
                                   console timeline (live, no refresh)
```

**The ingest/worker split is load-bearing.** Providers disable webhooks that
answer slowly, so the route does nothing but verify, insert, and return 200.

---

## 3. Rules that are not negotiable

These each cost real time to learn. Breaking one is silent.

1. **`owner_id` always comes from the `channels` row, never the payload.** The
   worker runs as `service_role`, so RLS is inert there — these values are the
   only thing separating tenants. Applies to `conversations`, `contacts`,
   `contact_identities`, `messages` alike.
2. **Never run `drizzle-kit generate` or `migrate`.** Run against the live
   database it proposed disabling RLS on all ten tables and dropping every
   policy. Migrations are hand-written SQL in `packages/db/migrations/`.
   ADR-012, and `drizzle.config.ts` explains it at length.
3. **`service_role` in the console lives only in `app/api/webhooks/`.** ADR-013.
   A test fails if anything else imports it.
4. **The worker imports the Gmail adapter by SUBPATH**, never the package root.
   The root pulls in `google-auth-library`, which cannot survive ESM bundling
   and crashes the container at startup. A test enforces this.
5. **The timeline never filters by direction.** A self-sent email is `outbound`,
   and that is the demo email. Filtering to `inbound` hides it and makes a
   working pipeline look broken.
6. **`historyId` is read from raw JSON text, never `JSON.parse`d.** It exceeds
   `Number.MAX_SAFE_INTEGER` on real mailboxes; rounded, the cursor lands
   mid-history and mail silently stops arriving.
7. **Never log message bodies.** IDs only. `docs/02-ARCHITECTURE.md` §6.

---

## 4. Failure modes that are silent

The ones that do not raise, do not appear in logs, and look like nothing.

- **Gmail watch expiry.** Lapses after 7 days and Gmail simply stops
  publishing. No error, no final notification. The worker renews at T-2 and
  logs `[watch] renewal DISABLED` loudly every 6 hours if unconfigured.
- **Expired history cursor.** Google keeps ~1 week, "in rare cases" hours. Once
  it lapses every `history.list` 404s forever. Handled: falls back to
  `messages.list` and resets the cursor from `getProfile` — reading that
  historyId **before** listing, or mail arriving mid-list is lost.
- **Encoding.** Gmail returns headers exactly as they arrived, so any non-ASCII
  subject is `=?UTF-8?B?…?=`, and body parts declare their own charset.
  Undecoded, both produce mojibake that gets embedded in Phase 4, making a
  message unfindable by the words it contains. The corpus is **Taglish**, so
  this is the normal case. Fixtures preserve the encoding cases deliberately —
  scrub the words, keep the envelope.
- **A Vercel deploy that never built.** Vercel keeps serving the last green
  build, so the console looks fine while running old code. `/api/health/config`
  reports the serving commit for exactly this reason.

---

## 5. Guards, and why each exists

Every one of these was added after something got through.

| Guard | Catches |
|---|---|
| `packages/db/scripts/assert-rls.ts` (CI job) | RLS/policy loss on any of 10 tables |
| `packages/db/tests/tenant_isolation.sql` | cross-tenant bleed, negative-controlled |
| `packages/db/tests/idempotency.sql` | duplicate rows from redelivery |
| `apps/console/test/service-client-boundary.test.ts` | `service_role` leaking out of ingest |
| `apps/worker/test/import-boundary.test.ts` | the adapter-root import that crashes the container |
| `.githooks/pre-commit` | secrets, and UTF-8 BOMs in JSON |
| CI runs `next build` | resolution failures typecheck cannot see |

**Negative-control anything security-critical.** Three separate times a test
passed that would have passed with the bug present. Break the thing on purpose
and confirm the test fails before trusting it.

---

## 6. Environment quirks

- **`az` is not on PATH**: `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`.
  The **Azure MCP times out — use the CLI.**
- **Vercel MCP cannot see this project.** It is on the personal Hobby scope, not
  team `Yuringgg`. Build logs are not reachable from tooling; reproduce locally.
- **`gh` is not installed.** Use the GitHub REST API anonymously — the repo is
  public.
- **TypeScript pinned to `^5`.** 7.x is the Go port with no classic compiler
  API; `next build` fails while `tsc --noEmit` passes.
- **PowerShell `Out-File -Encoding utf8` writes a BOM.** It broke a build for two
  commits. Use the Write tool for JSON.
- **Azure region is policy-constrained** to japaneast, malaysiawest,
  indonesiacentral, centralindia, koreacentral. `southeastasia` is blocked.
- Fonts now load via `next/font/google`, so a build needs network to reach
  Google Fonts. Accepted trade; noted so it is not a surprise.

---

## 7. Phase 2 — WhatsApp, and what is already done for it

**The point of Phase 2 is the refactor checkpoint, not the channel.** Gmail is
hybrid push/pull with a cursor; WhatsApp is pure push. If the `ChannelAdapter`
interface survives both, it survives a third. Do not skip the step where
duplication moves into `core`.

Already built and waiting:

- `/api/webhooks/whatsapp` — verify-token handshake and `X-Hub-Signature-256`
  HMAC verification, timing-safe, over the **raw body**. Tested. Returns 503
  until configured.
- `verifyHubSignature` in `packages/core` with 8 tests, including one pinning
  the failure the design guards against: a body verified after
  `JSON.parse`/`stringify` fails even though the data is identical.
- The `ChannelAdapter` contract, `CHANNEL_TYPES`, and the console's channel
  legend already enumerate `whatsapp`.

Still needed: Meta app, free test business number (5 recipients, no business
verification), webhook registration, `packages/adapters/whatsapp` with
`parseWebhook`/`normalize`, fixtures, and media download.

⚠ **WhatsApp channels are admin-provisioned, not self-serve.** Numbers belong to
the business, so unlike Gmail a user cannot connect their own — a number is
registered to the WABA, then assigned an `owner_id`. `channels` already has the
unique constraint to support that.

⚠ **Never use `whatsapp-web.js` or Baileys.** They impersonate WhatsApp Web,
violate Meta's terms, and get numbers banned. The Cloud API only receives
messages sent *to a business number you control* — it cannot read existing
personal conversations, and no amount of code changes that.

---

## 8. Phases 3–5, in one line each

- **Phase 3 — console.** Search (Postgres full-text over `body_text`), filters,
  contact detail with merged cross-channel history, **manual identity merge**.
  Realtime already landed early. Q3 is settled: merging is manual, the UI
  suggests. Never auto-merge on display name — two Marias exist.
- **Phase 4 — assistant.** Local Transformers.js embeddings
  (`Xenova/multilingual-e5-small`, 384d, **`"query: "` / `"passage: "` prefixes
  are mandatory**), chunking into `message_chunks`, pgvector cosine retrieval,
  Gemini for answers, Groq for extraction. **Build the similarity floor and the
  refusal path before the happy path**, and write the eval set — including
  questions that must be refused — before tuning any prompt.
- **Phase 5 — extraction, calendar, demo.** Meeting proposals with the source
  message beside them, editable, `events.insert` only on explicit confirm,
  `calendar_event_id` checked before every insert. **Never auto-create.**

---

## 9. Immediate next steps

1. **Phase 2 prerequisites are Yuri's clicks**: Meta developer account, app,
   WhatsApp product, test number, and up to 5 verified recipients.
2. While waiting, the useful build is **Phase 3 search** — it needs no new
   credentials and there are 12 real messages to search.
3. `docs/06-OPEN-QUESTIONS.md` Q2 — the consent conversation with Ms. Maria —
   still gates real *client* data. Dogfooding on Yuri's own mailbox is fine.

---

## 10. How to work here

The docs are the authority; `AGENTS.md` points at them in order. Beyond that:

- **Check the live system rather than reasoning about the code.** The
  supervisor session caught a missing `raw_events` constraint that way, which
  would have shipped a broken upsert.
- **Verify claims before repeating them.** Several times this project's state
  was not what a previous message asserted — including mine.
- **`pnpm check` is not enough.** Two production incidents were invisible to it
  and to CI: run `next build`, and run the thing.
- When something looks broken, **establish which code is actually running**
  before debugging it. That mistake cost the most time of anything here.

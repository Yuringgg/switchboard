# 04 — Build Roadmap

*Phased plan. Each phase ends at something demonstrable.*

---

## Sequencing principle

Every phase ends with **something you could show Ms. Maria that day.** If a week
gets eaten by coursework, the project still has a working artifact at whatever
phase it reached — it never sits in a broken half-migrated state.

The corollary: **thin and end-to-end before wide.** One channel working all the
way from webhook to screen beats two channels half-plumbed. The most common way
projects like this fail is building all the adapters first and discovering at
integration time that the abstraction was wrong.

Phase durations are deliberately unstated. Treat these as ordering and relative
size.

---

## Phase 0 — Foundation ✅ COMPLETE (2026-07-26)

**Goal:** an empty but fully deployed system. Nothing works yet; everything is
wired.

**Done.** The console is live at
<https://switchboard-console-beryl.vercel.app> behind a login, the worker runs
warm on Container Apps, both migrations are applied, and the isolation test
passes — with a CI job that keeps checking it.

- [x] Init monorepo — pnpm workspaces, TypeScript strict, per layout in `docs/02-ARCHITECTURE.md` §7
- [x] `packages/core` — adapter interface and canonical types, no implementations
- [x] Supabase project (`ap-southeast-1`); first migration with the full schema; `pgvector` enabled
- [x] **Supabase Auth + sign-in flow in the console** — email/password, session in
      cookies, route gate in `proxy.ts`. Verified end to end in a browser:
      unauthenticated → `/login`, sign in → console, sign out → `/login`.
- [x] **`owner_id` on every table + RLS policies + `force row level security`** —
      all ten tables, verified by querying `pg_class`/`pg_policy` directly
- [x] **Two-tenant isolation test** — `packages/db/tests/tenant_isolation.sql`.
      Two users, the same external contact, no bleed across reads, writes,
      ownership reassignment, or anonymous access. **Negative control run:
      the test fails when RLS is disabled**, so a pass means something.
- [x] `packages/db` — Drizzle schema (verified column-by-column against the live
      database), worker client, and generated Supabase types
- [x] `apps/console` — Next.js + Tailwind + shadcn foundation, behind a login,
      renders "no messages yet". Verified in a browser: renders, light **and**
      dark, mobile **and** desktop, production build passes.
- [x] **CI assertion: all ten tables still have RLS + force RLS + a policy**
      (ADR-012). `packages/db/scripts/assert-rls.ts`, its own CI job. Also
      asserts every policy has USING **and** WITH CHECK — a policy missing
      WITH CHECK leaves writes unrestricted, which reads as "RLS is on".
      Negative control run: with RLS disabled on one table it exits 1 and names
      it, so a pass means something. **Requires the `DATABASE_URL` repo secret;
      it fails rather than skips without one.**
- [x] Deploy the console to **Vercel** at a public URL —
      <https://switchboard-console-beryl.vercel.app>, auth gate verified from
      outside the browser (307 → `/login`)
- [x] Ingest webhook routes live **inside** the console app (`app/api/webhooks/`) — ADR-011.
      WhatsApp verify-token + HMAC done and tested; Gmail OIDC verification is Phase 1.
- [x] `apps/worker` — containerized, → **Azure Container Apps, `minReplicas: 1`**,
      running warm in Malaysia West. Verified against the live database: it
      claims a seeded event, marks it done, and — the invariant that matters —
      takes `owner_id` from the **channel** even when the event names a
      different tenant.
- [x] Worker image build → **ghcr**, via `GITHUB_TOKEN` (no PAT). Package is
      public (inherited from the repo), so Container Apps pulls anonymously —
      no ACR, no cost. Container App runs the **real image, pinned by digest**.
- [x] `.env.example` and `.gitignore`
- [x] Pre-commit secret scan — `.githooks/pre-commit`, installed via `core.hooksPath`.
      Verified: blocks a staged `.env.local` and a Groq-shaped key, passes clean commits.
- [x] **Supabase keepalive** — `/api/cron/keepalive`, scheduled daily by
      `vercel.json`. *Starts running when the Vercel deploy lands.*
- [x] CI: typecheck + test on push — `.github/workflows/ci.yml`; *runs once a remote exists*

**Done when:** the console is live at a public URL behind a login, the worker
container is running warm, a migration applies cleanly from a fresh checkout, and
the isolation test passes. — **All four met.**

> **Auth and RLS belong here, not later.** This is the whole reason ADR-009 was
> decided before any code exists: adding `owner_id` and policies to nine tables
> in Phase 3 is a migration across every query in the system. In Phase 0 it's a
> column and a policy.

> Do the keepalive now too. Five minutes in Phase 0, a dead demo in Phase 5.

---

## Phase 1 — Gmail, end to end ✅ COMPLETE (2026-07-28)

**Done.** A real email arrives in Gmail and appears in the deployed console
within seconds, with no refresh — watch registered and auto-renewing, webhook
verifying and queueing, worker normalizing and upserting, timeline rendering
live. 12 real messages ingested unattended by the deployed worker.


**Goal:** the "it's real" moment. An email arrives and appears on screen.

Gmail goes first because it reads a **genuine existing inbox** with no recipient
caps — it's the channel that actually demonstrates the product thesis, and Yuri
already has the account.

- [x] Google Cloud project; **Gmail API + Calendar API** both enabled — `switchboard-503613`
- [x] OAuth consent screen in **testing mode**, Yuri allowlisted as a test user
- [x] Request Gmail **and** `calendar.events` scopes in the same consent — one
      flow now saves a second consent screen in Phase 5
- [x] OAuth flow in the console; refresh token **encrypted** into `channels`,
      scoped to the signed-in user
- [x] Pub/Sub topic `gmail-push` + push subscription `gmail-push-sub`, authenticated;
      publish rights granted to `gmail-api-push@system.gserviceaccount.com`
- [x] `users.watch` registration; store `historyId` and `expires_at` in `sync_state` —
      happens in the OAuth callback at connect time, not as a separate step
      someone has to remember. **Verified live: cursor set, watch expires
      2026-08-02 20:08:03 UTC.**
- [x] **Watch renewal** — renews at T-2 days, sweeps every 6 hours, marks
      `channels.status='error'` with the reason on failure so it surfaces on
      `/channels`. Lives in the **worker**, not a Vercel cron: it must decrypt
      every user's credentials, which needs `service_role`, which the console
      must never hold for a user-facing path (ADR-009, ADR-013). Proven in
      production against a probe channel with a deliberately invalid refresh
      token — `status='error'`, correct reason, `cursor` untouched.
- [x] Ingest endpoint: verify Pub/Sub OIDC token → look up the channel by
      notified address → insert `raw_events` → 200. Nothing else.
      **`owner_id` comes from the channel, never the payload.** Migration 0004
      adds the `(channel_id, external_id)` idempotency guard that `raw_events`
      was missing, so Pub/Sub redelivery cannot double-queue.
- [x] `packages/adapters/gmail` — `poll` via `history.list`, `normalize` (MIME, threads, HTML→text).
      **See `docs/02-ARCHITECTURE.md` §2 for the two settled rules:** `bodyText`
      is always synthesised (never null, `''` is legal), and attachments are
      provider references only.
- [x] Record real payloads into `fixtures/gmail/`; unit-test `normalize` against them.
      **Include an HTML-only email with no `text/plain` part** — it's common and
      it's what the fallback chain exists for. Nine fixtures recorded, including
      `nested-html-only` and `bare-html`.
- [x] Worker loop: claim with `FOR UPDATE SKIP LOCKED` → `history.list` from the
      stored cursor → normalize → upsert `messages` → advance the cursor
- [x] Contact identity resolution: create `contact_identities`, auto-create `contacts`
- [x] Console: bare timeline reading from `messages`.
      **Render BOTH directions — do not filter to `inbound`.** The milestone
      email is one you send yourself, which is `outbound` (direction comes from
      the From address). R12 frames the product around messages received from
      others, which makes an inbound-only filter look right; it would hide the
      demo email and read as a broken pipeline.
      The two empty states are **distinct**: "Listening", when a channel is
      connected, versus "No messages yet" plus a Connect action when none is.
      Collapsing them cost a full debugging session once by pointing at a
      connection problem when the connection was fine.
- [x] **Supabase Realtime on `messages`** — **pulled forward from Phase 3,
      2026-07-28.** Migration `0005_realtime_messages.sql` adds the table to the
      `supabase_realtime` publication; the console subscribes with the user's
      own session so RLS scopes the stream (ADR-013). An arriving row triggers
      `router.refresh()` while you are at the top of the list, and is counted
      behind a "3 new messages" pill when you are not — so nothing is ever
      inserted above what you are reading. Realtime payloads carry no joined
      sender, so re-rendering on the server is what keeps one rendering path
      for a row instead of two.
- [x] Console frame holds still — the sidebar and header are fixed and only the
      message column scrolls; the shell streams ahead of the messages behind a
      `<Suspense>` skeleton, and `channels` is fetched once per request instead
      of twice.
- [x] Idempotency test: replay the same notification 3×, assert exactly one row —
      `packages/db/tests/idempotency.sql`. Covers all four guards: `raw_events`,
      `messages`, `conversations` and `contact_identities`, plus a reply reusing
      its thread without creating a second conversation or overwriting the
      subject with a "Re:" prefix. Self-verifying, rolls back.

**Done when:** you send yourself an email and it appears in the deployed console.
**This is the milestone worth screenshotting for Ms. Maria.**

> **Attachments moved to Phase 3** (2026-07-27). `normalize` emits attachment
> references from Phase 1, but nothing downloads bytes and no `attachments` rows
> are written — `attachments.blob_url` is `not null` and there is no blob yet,
> and relaxing that to store a placeholder would trade a real guarantee for a
> half-truth. Nothing is lost: `messages.payload_raw` keeps the full payload, so
> every reference is recoverable. Downloading pulls in an Azure Blob account and
> container, the storage SDK, and per-attachment retry semantics — none of which
> is on the path to the sentence above. Reasoning in `docs/02-ARCHITECTURE.md` §2.

> Be aware this phase has no early visible payoff — OAuth, Pub/Sub, and watch
> registration all have to work before a single message renders. That's the cost
> of dropping Telegram. Push through it; everything after is faster.

---

## Phase 2 — WhatsApp 🟡 CODE COMPLETE, awaiting Meta credentials

**Goal:** prove the adapter abstraction holds against a structurally different
channel. Gmail is hybrid push/pull with a cursor; WhatsApp is pure push. If the
interface survives both, it will survive a third.

**Everything that can be built without a Meta account is built, typechecked and
tested (2026-07-28).** The pipeline is closed end to end — webhook → `raw_events`
→ worker → `messages` → timeline — and 103 new tests cover it, 286 total. What
remains is credentials, and the first real message.

- [ ] ★ Meta developer account, app created, WhatsApp product added — **Yuri**
- [ ] ★ Free **test business number**; verify up to 5 recipient numbers — **Yuri**
- [ ] ★ Webhook registered in the Meta dashboard; `messages` field subscribed;
      the four `WHATSAPP_*` variables set on Vercel — **Yuri**
- [ ] ★ Provision the number: `packages/db/scripts/provision-whatsapp.ts` —
      **needs the ids from the steps above**
- [x] WhatsApp channels are **admin-provisioned**, not self-serve — a number is
      registered to the WABA, then assigned an `owner_id`. Unlike Gmail, a user
      cannot connect their own. A WABA holds 2 numbers, up to 20 once verified.
      `/channels` already says so instead of offering a Connect button, and
      **migration 0006** adds `channels.external_account_id` — the
      `phone_number_id` the webhook resolves a tenant by, kept separate from the
      human-readable `display_name`.
- [x] Verify token handshake — `GET /api/webhooks/whatsapp`, timing-safe
- [x] **`X-Hub-Signature-256` HMAC verification** over the *raw* body, timing-safe
      compare. A test pins the failure the design guards against: a body verified
      after `JSON.parse`/`stringify` fails even though the data is identical.
- [x] `packages/adapters/whatsapp` — `parseWebhook`, `verifyWebhook`, `normalize`,
      **and the `ChannelAdapter` implementation** that makes the contract checked
      rather than described
- [x] Ingest wired: parse → resolve the channel by `phone_number_id` → one
      `raw_events` row **per message** → 200. **`owner_id` comes from the channel,
      never the payload.** One row per message because the `wamid` is the only id
      stable across Meta's redeliveries, which run for **7 days** on any non-200.
- [x] Worker: `whatsapp-ingest.ts` → `persistMessage`. No cursor, no credential,
      no network call — the payload already carries the message. A WhatsApp
      channel's `sync_state` staying empty is correct, not a symptom.
- [x] Fixtures + tests, same as Gmail — 13 fixtures, including `batch.json`,
      which carries two entries, two changes and two business numbers in one POST
      and fails any `[0]`-indexed parse
- [x] **Refactor checkpoint** — see ADR-014. The canonical types held; **three of
      `ChannelAdapter`'s five signatures could not be implemented**, which nothing
      had noticed because nothing implemented the interface. `NormalizeResult` and
      phone comparison moved into `core`; `InboundRef` was added so a pure parse
      cannot be asked to invent a `channelId`.
- [ ] ~~Media/attachment download → Azure Blob~~ **→ Phase 3**, with Gmail's.
      `normalize` emits attachment references from Phase 2; nothing downloads
      bytes. Same reasoning as the Phase 1 move: `attachments.blob_url` is
      `not null`, the Blob container does not exist yet
      (`docs/03-RESOURCES.md` §6), and every reference survives in
      `messages.payload_raw` — so this is a backfill, not a re-ingest.

**Done when:** a WhatsApp message and an email sit in the same timeline, visually
distinguished by channel.

> The refactor checkpoint is the actual point of this phase. Don't skip it — it's
> where you find out whether the abstraction was real or wishful.
>
> **It was both.** The canonical types absorbed a structurally different channel
> without a special case anywhere above the adapter. The *interface* did not: it
> asked a pure function to produce a `channelId`, which requires the database
> lookup that decides `owner_id`. Full finding in ADR-014.

---

## Phase 3 — The console

**Goal:** the part people actually look at. Ms. Maria pointed at UI as somewhere
to invest, and it's what makes the system feel finished.

- [ ] Timeline: virtualized, infinite scroll, channel badges, grouped by day
      *(grouped by day and channel-marked already shipped in Phase 1;
      what remains here is virtualization and infinite scroll)*
- [x] ~~**Supabase Realtime** — new messages appear without a refresh~~
      **Moved into Phase 1 and shipped, 2026-07-28.** Pulled forward on purpose:
      it is the item this section already called the highest ratio of demo
      impact to implementation cost, and the timeline was the surface where its
      absence was most visible — new mail did not appear until you navigated
      away and back. Migration `0005`, `apps/console/src/components/live.tsx`.
- [ ] Keyword search — Postgres full-text over `body_text`
- [ ] Filters: channel, contact, date range
- [ ] Contact list; contact detail = merged cross-channel history
- [ ] **Manual identity merge** — "this email address and this number are the same person"
- [ ] Channel settings: connect, pause, disconnect, sync status, last error
- [ ] **Attachments → Azure Blob; rows in `attachments`** — moved here from
      Phase 1, and **now covers WhatsApp media too** (moved here from Phase 2,
      2026-07-28, for the same reason). Needs the Blob account and container
      provisioned first (`docs/03-RESOURCES.md` §6). The references already
      exist in `messages.payload_raw` for both channels, so this is a backfill,
      not a re-ingest. Note the two channels fetch differently: Gmail uses
      `users.messages.attachments.get`, WhatsApp exchanges a media id for a
      **short-lived** URL — so its download cannot be deferred long after the
      message arrives.
- [ ] Empty, loading, and error states everywhere
- [ ] Responsive down to mobile width

**Done when:** the demo sequence in `docs/01-PRODUCT-SPEC.md` §6, steps 1–5, works
start to finish.

> Realtime is the highest ratio of demo impact to implementation cost in the whole
> project. Watching a message land on screen unprompted is what makes people
> believe the pipeline is real.

---

## Phase 4 — The assistant

**Goal:** the feature Ms. Maria described first.

- [ ] `EmbeddingProvider` — Transformers.js, **multilingual model** (`Xenova/multilingual-e5-small`, 384d)
- [ ] **e5 prefixes:** `"query: "` on searches, `"passage: "` on stored text
- [ ] Chunking for long bodies → `message_chunks` with overlap
- [ ] Worker: embed on ingest; backfill everything already stored
- [ ] `CompletionProvider` — **Gemini 2.5 Flash** for assistant Q&A (250K TPM, 1M ctx)
- [ ] `CompletionProvider` — **Groq/Llama** for per-message extraction (14.4K req/day)
- [ ] Retrieval: pgvector cosine over `message_chunks`, resolve to parent messages, de-dupe
- [ ] **Similarity floor + refusal path — build this before the happy path**
- [ ] Prompt: answer strictly from context, cite message IDs, refuse otherwise
- [ ] Assistant panel in console; citations render as chips linking to messages
- [ ] Eval set: ~15 hand-written Q&A pairs over known messages, **including
      questions that should be refused**

**Done when:** *"do I have upcoming meetings?"* returns a cited answer, and
*"what did we agree about the Jakarta office?"* (nothing in the corpus) returns a
clean refusal.

> Two traps here, both easy to miss and painful to fix late. Use a **multilingual**
> embedding model — the corpus is Taglish and English-only models degrade badly on
> code-switched text, in a way that looks like a ranking bug. And write the eval
> set *before* tuning the prompt, or you're adjusting wording and guessing.

---

## Phase 5 — Extraction, polish, demo

**Goal:** ship it.

- [ ] Extraction pass in worker: commitments, meetings, action items → `extractions`
- [ ] "Needs attention" view over extractions
- [ ] **Calendar write-back (US-7b, ADR-010):**
  - [ ] Meeting proposals in the UI, **source message shown beside each one**
  - [ ] Editable title, time, participants before confirming
  - [ ] `events.insert` on confirm; store `calendar_event_id` + `confirmed_at`
  - [ ] Idempotency: check `calendar_event_id` before every insert
  - [ ] Failure leaves the proposal unconfirmed — never mark it optimistically
- [ ] Daily digest (US-9)
- [ ] Error handling audit — every failure path has a UI state
- [ ] `README.md` with setup instructions, **verified from a clean clone**
- [ ] Architecture diagram for the presentation
- [ ] **Demo rehearsal on deployed infrastructure, not localhost**
- [ ] Seed a realistic demo dataset so the console isn't empty on stage

**Done when:** the full §6 demo sequence runs on deployed infrastructure, twice in
a row, without intervention.

---

## Stretch — only after Phase 5 is solid

| Item | Notes |
|---|---|
| **Facebook Messenger** | Cheap to add — shares Meta's app infrastructure with WhatsApp. Worth it if Ms. Maria says clients use it. |
| **Generic IMAP adapter** | Gmail covers development and testing. If iOzera uses Outlook or a company mail server, an IMAP adapter slots into the same interface — but note IMAP needs a persistent IDLE connection per account rather than webhooks, which fits scale-to-zero containers poorly. |
| **Voice note transcription** | WhatsApp voice notes are media attachments, so this is tractable. Low priority — Ms. Maria's "voice" mention was an offhand example, not a requirement. |
| **Outbound replies (US-12)** | Changes the product's risk profile. Discuss with Ms. Maria first. |
| **Calls** | **Out of scope — ADR-008.** Excluded by Ms. Maria, no native recording exists, and RA 4200 makes recording a criminal offence without all-party consent. If ever revisited: metadata only. |

---

## Risk register

| Risk | Likelihood | Impact | Response |
|---|---|---|---|
| Scope creep | **High** | High | The non-goals list in `docs/01-PRODUCT-SPEC.md` is the defense. Re-read before adding anything. |
| Phase 1 has no early visible payoff, motivation dips | Medium | Medium | Known cost of dropping Telegram. Deploy the console shell in Phase 0 so there's *something* live to point at. |
| Coursework eats build time | High | Medium | Phases end at demonstrable states. A slipped phase isn't a broken project. |
| English-only embedding model on Taglish | **High if unexamined** | High | Multilingual model from the start (ADR-003). Looks like a ranking bug, so it's hard to diagnose late. |
| A free LLM tier is cut or exhausted | Medium | Medium | Assistant and extraction sit on **different providers**, so only half breaks. Embeddings are local, so search never breaks. |
| Gemini project has billing enabled by accident | Low | High | Permanently destroys the free tier. Keep billing off; note it in `.env.example`. |
| Supabase pause kills a demo | Medium | High | Keepalive in Phase 0. |
| Gmail `watch` expires unnoticed | Medium | **High** — it's the primary channel | Renewal cron + alerting in Phase 1. |
| Adapter abstraction turns out wrong | Low | High | Phase 2's refactor checkpoint exists to surface this early. |
| **Cross-tenant leak via a worker bug** | Medium | **Critical** | `service_role` bypasses RLS. Derive `owner_id` from the channel, never the payload. Isolation test in Phase 0. |
| Calendar write-back duplicates events | Medium | Medium | `calendar_event_id` checked before every insert. |
| Google forces production verification | Low | High | Stay in OAuth testing mode with allowlisted users. Publishing with Gmail restricted scopes triggers a CASA assessment. |
| **Gmail refresh token expires every 7 days** | **Certain — it is the documented behaviour of testing mode** | **High: mail stops** | Verified 2026-08-02. External + Testing expires every refresh token **7 days from consent**, per user, not configurable. The watch sweep catches it and shows *Needs attention* on `/channels`, so it is visible — but **reconnect on the morning of any demo.** `docs/03-RESOURCES.md` §2. |
| ~~Multi-user Gmail: two tenants connect the **same** mailbox~~ | — | — | **Fixed 2026-08-02.** `.maybeSingle()` errored on two rows, so ingest 500'd for a shared mailbox and Pub/Sub retried it forever. Now fans out: one `raw_events` row per owner, via `fanOutToChannels` in `apps/console/src/lib/ingest.ts`, with 9 tests. `.limit(1)` was rejected as the fix — it would deliver one tenant's mail to whichever row sorted first. |
| **Scope grew: multi-tenancy + calendar write** | — | — | Both landed in planning rather than mid-build, which is the cheap time for them. Held in check by the team-features non-goal — *isolated, not collaborative*. |

---

*Last updated: 2026-07-28 · Phase 2 built to the edge of what needs credentials:
adapter, ingest, worker, fixtures and the refactor checkpoint (ADR-014) all
landed. WhatsApp media download moved to Phase 3 to sit with Gmail's. Realtime
had moved from Phase 3 into Phase 1 and shipped.*

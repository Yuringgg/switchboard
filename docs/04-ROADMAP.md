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
- [x] **Keyword search — Postgres full-text over `body_text`** (2026-08-02).
      Migration `0007_message_search.sql`: a **generated** `tsvector` over
      `subject || body_text` plus a GIN index, and `search_messages()` —
      **SECURITY INVOKER**, so RLS scopes it exactly as it scopes a table
      query. Negative-controlled against the live database: the owner of the
      65 messages sees 65 through the function, the second account sees **0**.
      `anon` is revoked and PostgREST answers it `42501`, not `PGRST202`, so
      the function is registered *and* locked.
      **⚠ The config is `simple`, not `english`, and that is deliberate** —
      the corpus is Taglish, Postgres ships no Tagalog configuration, and an
      English stemmer applies Porter rules to Tagalog words and strips "at",
      which is Tagalog for "and". It fails by returning the wrong rows, which
      reads as a ranking bug. The cost is no stemming, paid for by a trailing
      `:*` prefix match on the last term (`buildQuery`, `lib/search.ts`) so
      "deadline" still finds "deadlines".
      **⚠ Two query modes on purpose.** `to_tsquery` RAISES on malformed input
      and a text box produces plenty; `websearch_to_tsquery` never raises and
      gives `"phrases"`, `or`, `-exclusions`, but cannot express a prefix.
      Advanced grammar goes to websearch verbatim; everything else is stripped
      to word characters and rebuilt, so the raising parser only ever sees
      machine-built input. **Never pass raw user text with `prefix: true`.**
      Highlighting comes from `ts_headline` delimited with **STX/ETX**, split
      in TypeScript and rendered as `<mark>` elements — a message body must
      never reach `dangerouslySetInnerHTML`, and every body here was written
      by somebody else.
- [x] **Filters: channel, date range** (2026-08-02) — the same function, so
      there is one implementation of the filters rather than two that drift.
      Whole state lives in the URL, so a search is a link. Date bounds are
      **Manila** days (`manilaDayStart`/`End`), matching the timeline's own
      grouping — on UTC bounds "1 August" would drop everything sent after 4pm
      that day and the screen would contradict its own filter.
- [ ] Filter by contact — the function already takes `contact_ids`; the UI
      waits on the contact list below
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
      *(done for search: the prompt state, the no-matches state and the
      streaming skeleton are three distinct screens. "You have not asked yet"
      and "the answer is no" must never converge — the same rule the timeline's
      two empty states already follow, and for the same reason.)*
- [ ] Responsive down to mobile width
      *(verified for search at 375px: no page-level horizontal scroll, all 24
      sampled elements pass WCAG AA in **both** schemes, lowest 6.32:1.
      ⚠ Measure with transitions disabled — `transition-colors` means
      `getComputedStyle` immediately after toggling `.dark` returns a value
      interpolated from the other theme, which read as a 2.58:1 failure that
      did not exist.)*

**Done when:** the demo sequence in `docs/01-PRODUCT-SPEC.md` §6, steps 1–5, works
start to finish.

> Realtime is the highest ratio of demo impact to implementation cost in the whole
> project. Watching a message land on screen unprompted is what makes people
> believe the pipeline is real.

---

## Phase 4A — Per-message summaries

**Goal:** every message carries a one-glance summary of what it says.

> ⭐ **This is in the founding request, not an addition.** Ms. Maria, 2026-07-25:
> *"Do you think you can make a live webapp that can view whatsapp messages real
> time **and have ai summarize** bebe? Parang admin view"* — and again on
> 2026-08-01: *"dont forget to incorporate an llm din to summarize noo"*.
>
> It reached this roadmap only on 2026-08-02 because the original thread had
> never been read into the docs. **The summarizer was always half the product**;
> ingestion was the other half. `docs/00-CONTEXT.md` §2 now carries her verbatim
> words, and ADR-015 records how it got missed.

**⚠ This is a THIRD AI workload, not a variation of the other two.** Getting that
wrong is how it ends up half-built inside the assistant:

| | Shape | Trigger | Output |
|---|---|---|---|
| **4A summary** | one small prompt **per message** | on ingest | prose, one per message |
| 4B assistant | one large RAG prompt **per question** | user asks | cited answer |
| 5 extraction | one small prompt per message | on ingest | structured rows |

4A goes **before** the assistant deliberately. It is far cheaper, it needs no
embeddings and no retrieval, and it proves the Groq plumbing works against real
Taglish mail before Phase 4B depends on a provider nobody has called yet. It is
also the cheapest thing in the project that makes the console look intelligent —
which matters, because Ms. Maria asked for it and will look for it.

- [x] **Migration 0008** *(0007 went to search)* — `kind='summary'` allowed, and
      `unique (message_id) where kind = 'summary'`. Negative-controlled against
      the live database: a summary inserts, a **second** summary for the same
      message is rejected, two `meeting` rows on one message are still allowed,
      and an unknown kind is still rejected. All ten tables still report RLS
      enabled, forced, and a policy afterwards.
- [x] **Store summaries in `extractions`, not on `messages`** (ADR-015).
      `messages` is the record of what actually arrived; a summary is a
      machine's opinion about it. Keeping them apart means a bad prompt can
      never corrupt the message record, `extractions.model` makes *"did the new
      prompt help?"* answerable, and ADR-006 already settled this shape.
- [x] `packages/ai` — `CompletionProvider` over **Groq** (ADR-003).
      **⚠ Model verified from the live rate-limit headers, 2026-08-02, not from
      a docs page:** `llama-3.1-8b-instant` = **14,400 req/day**;
      `llama-3.3-70b-versatile` = **1,000 req/day**. The 70B is a fourteenth of
      the allowance and one backfill would eat it, so **8b-instant is the
      choice** and the constant says why.
      ⚠ **Deviation from `docs/02-ARCHITECTURE.md` §8, stated not smuggled:**
      native `fetch`, not `groq-sdk`. §8 permits deviating with a reason, and
      the reason is the worker's tsup bundle — this project has already lost a
      container to a dependency that could not survive it
      (`google-auth-library`, which `apps/worker/test/import-boundary.test.ts`
      exists to prevent recurring). Groq's API is OpenAI-compatible REST; the
      SDK would buy nothing and add a transitive tree to that same bundle.
- [x] **Worker step, after `persistMessage` and non-blocking.** Sits between
      ingest and `markDone`, wrapped so nothing it does can reach the handler
      that calls `markFailed` — that would burn an attempt on a message which
      ingested perfectly. `GROQ_API_KEY` is **optional** in `env.ts` on purpose:
      no key means no summaries and mail flows exactly as before, where
      `required()` would turn a missing optional feature into a container that
      will not start.
- [x] **Skip rules, applied before spending a request.** `empty` and
      `already-short` (< 280 chars). ⚠ **Consequence worth saying out loud
      before a demo: most WhatsApp messages will have no summary, and that is
      correct.** Chat is short; paraphrasing "Sige, sending the files na" is no
      shorter and less true. Email is where the reading effort is and where the
      summaries appear.
- [x] **Idempotency.** `extractions` is read before the API is called, not just
      guarded by `on conflict` — `on conflict` only saves the write, by which
      point the request is spent.
- [x] **Backfill the existing corpus** — `apps/worker/scripts/backfill-summaries.ts`.
      `--limit` defaults to 25 rather than "everything", a delay between
      requests, `--dry-run`, and it **waits out a rate limit once** using Groq's
      own `retry-after`, then stops if still limited — so a busy minute does not
      abandon the run and an exhausted allowance does not grind through fifty
      failures.
      ⚠ **Running it found the real limit, which is not the documented one.**
      The first version stopped dead on any retryable failure, and a backfill
      429'd on message five with `x-ratelimit-remaining-requests: 14399` and
      `x-ratelimit-remaining-tokens: 4825`. **The binding constraint is 6,000
      tokens/minute, not 14,400 requests/day** — the same finding as ADR-003,
      one layer down. Fixed by capping the body sent at 4,000 characters and by
      honouring `retry-after` (⚠ fractional — `parseFloat`). Full note in
      `docs/03-RESOURCES.md` §4b.
- [x] **Prompt hardening.** The body is fenced between markers carrying a
      **per-request random nonce** — text inside cannot close a delimiter it
      cannot predict, which is what makes "this is data, not instructions"
      enforceable rather than hopeful. Three injection fixtures in the eval set,
      all resisted (below).
- [x] **Taglish — pinned: the summary is ALWAYS English.** A Tagalog-dominant
      message yields an English summary. Rationale: an admin view is fifty rows
      skimmed at speed and a mixed-language column scans worse than a consistent
      one; matching the message would also need language detection, one more
      thing that fails quietly. Names, places, numbers and quoted terms are kept
      verbatim. One line to change if Yuri prefers otherwise.
      ⚠ **The two rules interact:** translating necessarily introduces words not
      in the source ("noong Lunes" → "Monday"), which the eval's
      invented-name check flagged as a hallucination until it learned to allow
      weekday and month names. Written down so it is not rediscovered.
- [x] **Console:** renders in the **opened row**, above the body, in **IBM Plex
      Mono** against the body's Instrument Sans — verified in the live DOM, not
      assumed. Labelled *"Summary · generated by llama-3.1-8b-instant"*: naming
      the model is a more honest claim than "AI", and it is why
      `extractions.model` is recorded per row (ADR-006). The headline is still
      the sender's own words; nothing appears in the preview line.
      ⚠ **The left rule is NEUTRAL, not amber.** It was `border-live/40` for one
      draft, which measured 1.44:1 (invisible) *and* borrowed the hue this
      console reserves for "the board is receiving". Colour here means channel
      or liveness and nothing else — the mono register and the label already
      say "generated", and both survive being colour-blind.
      ⚠ **The PostgREST embed must stay a LEFT join.** `extractions!inner`
      would hide every message without a summary, which is most of them.
      Verified against the live database: six requested, six returned, three
      with a summary and three without.
- [x] **Eval set** — `apps/worker/scripts/eval-summaries.ts`, 10 cases,
      properties not wording. **10/10 pass against the live model.** Deliberately
      not part of `pnpm check`: a suite needing a key and a network is one that
      starts getting skipped.
      ⚠ Two bugs it found were in the *harness*, and both are instructive:
      a substring language check (`includes('ng ')`) matched "landi**ng p**age"
      and failed five correct English summaries; and an injection fixture was
      under 280 chars, so the skip rule fired and it tested nothing.
      ⚠ **Residual weakness, recorded honestly:** an injection claiming *"the
      sender is Dr. Evelyn Harkness, CEO"* did not get its fabricated budget
      into the summary, but the model did adopt the in-band identity claim as
      attribution. The mitigation is structural rather than prompt-level — the
      console shows the **real** sender from `contact_identities`, never from
      the body, so the true sender sits beside the summary.

**Done when:** an email arrives and, seconds later, the opened row shows a
two-line summary beside the original text — and turning Groq off breaks nothing
but the summary. — **Met for the backfill path and the console. The live
ingest path lands when the Container App is repointed at the new image
(see below).**

> ⚠ **The deployed worker runs an image pinned by DIGEST, and CI does not
> repoint it.** `worker-image.yml` builds and pushes to ghcr on a push to
> `main`; nothing updates the Container App. Until someone runs
> `az containerapp update --image <new digest>`, the deployed worker keeps
> running the previous code while the commit looks deployed — the same shape as
> the BOM incident. `packages/ai/**` was also missing from that workflow's
> `paths` filter, which would have made an AI-only change silently ship the old
> image; added 2026-08-02.

> ⚠ **This is the first time message content leaves the system.** Until now
> bodies have never been sent anywhere; summarization posts them to Groq.
> `docs/02-ARCHITECTURE.md` §6 and Q2 in `docs/06-OPEN-QUESTIONS.md` gate real
> *client* data on a consent conversation with Ms. Maria — **this makes that
> conversation more urgent, not less.** Dogfooding on Yuri's own mailbox is
> still fine. Raise it with her when she sends her recommendations.

---

## Phase 4B — The assistant

**Goal:** the feature Ms. Maria described first.

- [x] `EmbeddingProvider` — Transformers.js, `Xenova/multilingual-e5-small`, 384d,
      quantised (129 MB on disk, ~22 ms per embed once loaded).
- [x] **e5 prefixes** — applied *inside* `embedQuery` / `embedPassages`, never
      left to call sites, because omitting them does not error and only degrades
      ranking.
- [x] Chunking with overlap → `message_chunks`. ⚠ Two real bugs the tests caught:
      the overlap step landed **mid-word** (a chunk began `"ng mga files…"`,
      slicing the Tagalog "yung" in half), and an overlap larger than the chunk
      produced **3,690 chunks** from one body. Both fixed and pinned.
- [x] Worker embeds on ingest **and** a backfill script. 73 messages → **394
      chunks**, 0 failures, 128s. No quota, because it is local.
- [x] Retrieval — migration 0009: HNSW index + `match_chunks`, **SECURITY
      INVOKER** so RLS scopes it, collapsed to one row per message.
- [x] **Similarity floor + refusal path, built before the happy path** — and
      building it first is what proved the design wrong. **See ADR-016.**
      The floor **cannot** separate answerable from unanswerable: the lowest
      answerable top-score (0.8487) sits *below* the highest unanswerable one
      (0.8563). The refusal moved onto the model; a **relative** floor replaces
      the absolute one. `apps/worker/scripts/probe-floor.ts` measures it.
- [x] Prompt: answer strictly from context, cite message ids, refuse otherwise.
- [x] Assistant panel in the console; citations numbered to match the `[n]`
      markers in the answer, and an uncited answer renders **as a refusal**.
- [x] Eval set — `apps/worker/scripts/eval-assistant.ts`, 15 cases, 8 of which
      **must be refused**.

**Done when:** *"do I have upcoming meetings?"* returns a cited answer, and
*"what did we agree about the Jakarta office?"* returns a clean refusal.
— **Both met**, measured 2026-08-02.

> ### ⚠ Where the eval actually stands, stated honestly
>
> Best measured run: **5/5 refusals correct, 5/7 answerable correct.** Before the
> prompt was hardened it was the other way round — 7/7 answerable but only 3/8
> refusals, with the model citing all eight retrieved messages for a question
> about a submarine.
>
> The hardened prompt **over-refuses two answerable questions** ("do I have
> upcoming meetings?", "summarise what needs my attention"). That is the safe
> direction to fail — ADR-007 is explicit that a fabricated meeting is worse than
> no answer — but it is **not finished**. One more tuning pass is owed, and the
> eval is the instrument for it.
>
> ⚠ Some eval runs also fail on `groq rate limit`. That is the **daily token
> cap**, not a logic failure; re-run the next day rather than chasing it.

> ### ⚠ The assistant no longer runs on Gemini
>
> **Gemini 2.5 Flash's free tier is 20 requests per DAY**, measured from the
> quota error on 2026-08-02 — not the 250 `docs/03-RESOURCES.md` recorded. One
> eval run is 15 requests. The assistant defaults to Groq
> `llama-3.3-70b-versatile` (1,000/day) instead; summaries stay on
> `llama-3.1-8b-instant` so the two cannot exhaust each other, which preserves
> ADR-003's isolation argument inside one vendor.
> `ASSISTANT_PROVIDER=gemini` switches back in one variable.

> ### ⚠ Not yet live in production — deliberately
>
> The code is pushed and the console builds, but **the deployed assistant will
> report "could not reach the embedding service" until three things are done**,
> and none of them was safe to do without watching the result:
>
> 1. The Container App must be repointed at the new image (CI builds it; nothing
>    repoints it — see the Phase 4A note above).
> 2. The worker's ingress must be switched from **internal** to external, so
>    Vercel can reach `POST /embed`.
> 3. `EMBED_API_SECRET` (both sides), `EMBED_API_URL` and `GROQ_API_KEY` must be
>    set on Vercel, and `EMBED_API_SECRET` on Azure.
>
> The Dockerfile change was verified against a **simulated copy of the runtime
> layout** rather than a real build — Docker is not installed on this machine.
> That simulation caught two real defects (see the commit), but it is not the
> same as building the image. **Watch the logs after repointing and keep the
> previous digest to roll back.**

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
| **The 100-user cap is a LIFETIME total, and never resets** | Certain | Medium — but irreversible | Google's own wording on the Audience screen: *"Allowed user cap prior to app verification is 100, and is counted over the entire lifetime of the app."* Not 100 concurrent — 100 authorisations, ever. At 1/100 on 2026-08-02. Every throwaway test account burns one permanently. Verified in the Cloud Console, 2026-08-02. |
| **A new user is blocked by Google before reaching the app** | High, the moment a second person tries | Medium — reads as our bug | Google returns `access_denied` for *both* "you cancelled" and "you are not allowlisted", and usually blocks on its own page without redirecting back at all. Fixed 2026-08-02: the callback message now names both causes, and `/channels` states the requirement **before** the click, quoting the reader's own address for an admin to paste. **There is no API for the allowlist** — Google withdrew the IAP OAuth Admin APIs in March 2026 — so this cannot be automated, only explained. |
| ~~Multi-user Gmail: two tenants connect the **same** mailbox~~ | — | — | **Fixed 2026-08-02.** `.maybeSingle()` errored on two rows, so ingest 500'd for a shared mailbox and Pub/Sub retried it forever. Now fans out: one `raw_events` row per owner, via `fanOutToChannels` in `apps/console/src/lib/ingest.ts`, with 9 tests. `.limit(1)` was rejected as the fix — it would deliver one tenant's mail to whichever row sorted first. |
| **Scope grew: multi-tenancy + calendar write** | — | — | Both landed in planning rather than mid-build, which is the cheap time for them. Held in check by the team-features non-goal — *isolated, not collaborative*. |

---

*Last updated: 2026-07-28 · Phase 2 built to the edge of what needs credentials:
adapter, ingest, worker, fixtures and the refactor checkpoint (ADR-014) all
landed. WhatsApp media download moved to Phase 3 to sit with Gmail's. Realtime
had moved from Phase 3 into Phase 1 and shipped.*

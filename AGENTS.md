# AGENTS.md — Read This First

You are working on **Switchboard**. This file is the entrypoint for any AI session
joining this project cold. Read it fully, then read the docs it points you to,
**before writing any code or making any claim about the project.**

---

## 1. What this project is, in one paragraph

Switchboard is a **cross-channel communication monitoring tool**. Messages from
multiple platforms — **Gmail and WhatsApp** — are ingested into a single private
server, normalized into one canonical message format, stored in Postgres, and
surfaced in a web console. On top of that store sits an assistant
that answers natural-language questions about the corpus — *"what did the client
say about the deadline?"*, *"do I have upcoming meetings?"* — and, on explicit
confirmation, turns detected meetings into real Google Calendar events.

It is **multi-tenant**: multiple people each connect their own channels and see
only their own data, isolated by row-level security.

It is **Yuri's OJT project at iOzera**, where it doubles as a proposed internal
tool for the company. See `docs/00-CONTEXT.md`.

---

## 2. Who's who

| Role | Who | What it means for you |
|---|---|---|
| **Chief / product owner** | Yuri | Final say on everything. Approves scope and direction. |
| **Supervisor / architect** | Claude (planning sessions) | Owns the plan, the docs in `docs/`, and technical direction. |
| **Builder** | Claude Code (build sessions) | Implements against the plan. **This is probably you.** |
| **Industry mentor** | **Ms. Maria** | iOzera-side mentor. **Proposed and scoped the project — the sole source of requirements.** |
| **Also mentioned** | Fatima | Came up in scoping; no requirements have come from her. |

> **Ms. Maria is the single source of requirements.** She proposed this project
> and she is the only person who has scoped it. If any doc attributes a
> requirement to someone else, that attribution is wrong — trace it back to her
> or treat it as unverified.

---

## 3. Read these next, in order

| File | What's in it | When you need it |
|---|---|---|
| `docs/00-CONTEXT.md` | Meeting record, stakeholders, OJT constraints, hours situation | Always — this is the "why" |
| `docs/01-PRODUCT-SPEC.md` | What we're building, user stories, scope, **non-goals** | Before any feature work |
| `docs/02-ARCHITECTURE.md` | System design, data model, the adapter contract | Before any code |
| `docs/03-RESOURCES.md` | Every API, its real limits and cost, credentials checklist | Before touching an integration |
| `docs/04-ROADMAP.md` | Phased build plan, milestones, definition of done | To pick up the next task |
| `docs/05-DECISIONS.md` | ADR log — what we chose, what we rejected, **and why** | Before you "improve" an existing choice |
| `docs/06-OPEN-QUESTIONS.md` | Unresolved items and live blockers | When something seems underspecified |

---

## 4. Ground rules for agents on this project

**Do not invent facts about APIs, pricing, or quotas.**
`docs/03-RESOURCES.md` records what was actually verified, with sources and a
verification date. If you need a number that isn't there, look it up and add it
to that file with a source link. Never guess a rate limit or a price.

**Do not silently change an architectural decision.**
If you think a choice in `docs/05-DECISIONS.md` is wrong, say so to Yuri and
propose an amendment. Don't just build it differently.

**Update the docs as part of the work, not after it.**
A phase isn't done until `docs/04-ROADMAP.md` reflects reality. If you discover
something that invalidates a doc, fix the doc in the same session.

**Respect the non-goals.**
`docs/01-PRODUCT-SPEC.md` has an explicit non-goals list. Scope creep is the
single biggest risk to an internship project on a deadline. When in doubt, ship
the narrow version.

**Treat message content as sensitive by default.**
This system reads private client communications. Credentials are encrypted,
never logged, never committed. See the Security section of
`docs/02-ARCHITECTURE.md` before handling real data.

**Prefer boring, working technology.**
Yuri has a limited number of OJT hours and enrollment week eats into them. A
feature that works and is understood beats a clever one that half-works.

---

## 5. Current status

**Phase 0 ✅ COMPLETE (2026-07-26). Phase 1 ✅ COMPLETE (2026-07-28).
Phase 2 🟡 CODE COMPLETE (2026-07-28) — every line is written, typechecked and
tested; it is waiting on a Meta account and a test number, which are Yuri's
clicks.**

> **Joining cold? Read these two after this file, in order:**
> `correspondence/2026-07-28-phase-1-complete-handoff.md` — what is deployed
> where, the seven rules that are not negotiable, the failure modes that are
> silent, and why each guard exists.
> `correspondence/2026-07-28-phase-2-whatsapp.md` — what Phase 2 built, the
> refactor checkpoint's finding, and exactly what is left.

**Phase 2 in one paragraph.** `packages/adapters/whatsapp` parses Meta's webhook
and normalizes it; `/api/webhooks/whatsapp` verifies the HMAC, resolves the
channel by `phone_number_id` and queues one `raw_events` row per message; the
worker normalizes and persists through the same `persistMessage` Gmail uses.
Migration 0006 adds `channels.external_account_id` — the tenant lookup key,
separate from the human-readable `display_name`. 13 fixtures, 103 new tests, 286
total. `next build` green, the worker bundle boots. **Nothing is stored until a
number is provisioned** — see `docs/03-RESOURCES.md` §6.

**⚠ The refactor checkpoint found a real defect — read ADR-014.** The canonical
types held against a structurally different channel with no special case
anywhere above the adapter. **Three of `ChannelAdapter`'s five signatures could
not be implemented**, and nothing had noticed because nothing implemented the
interface — Gmail ships as free functions, so the contract had been a comment
since Phase 0. `verifyWebhook` had no secret; `parseWebhook` had to invent a
`channelId`, which requires the database lookup that decides `owner_id`;
`normalize` took a shape that only exists at ingest. All three are amended, and
`packages/adapters/whatsapp` now implements the interface so the next drift
fails a test. **The rule that came out of it: a stored payload must be
self-sufficient.** WhatsApp's is; Gmail's is not, and Gmail was deliberately
left alone because it is carrying real mail.

**An email arriving in Gmail now appears in the deployed console within
seconds, without a refresh.** The console is live at
<https://switchboard-console-beryl.vercel.app> behind a login, the worker runs
warm on Container Apps ingesting real mail, Realtime pushes new rows to the
timeline, and CI asserts tenant isolation on every push.

**What is built** (build sessions 1–4, 2026-07-26):

- pnpm workspace + TypeScript strict, directory tree per `docs/02-ARCHITECTURE.md` §7
- `packages/core` — the `ChannelAdapter` contract and canonical types, no
  implementations
- **Supabase project `switchboard`** (`ap-southeast-1`, ref `ytrkpcryztwgflmbhfdu`),
  full schema, pgvector, and **RLS forced on all ten tables**
- **The two-tenant isolation test passes, and fails when RLS is disabled** —
  `packages/db/tests/tenant_isolation.sql`
- **A CI job asserts the boundary on every push** (ADR-012) —
  `packages/db/scripts/assert-rls.ts`. All ten tables must report
  `rowsecurity`, `forcerowsecurity`, and a policy carrying USING **and**
  WITH CHECK. Negative-controlled: it exits 1 and names the table when RLS is
  disabled. Needs the `DATABASE_URL` repo secret and **fails rather than skips**
  without one.
- `apps/console` — Next.js 16 + Tailwind + shadcn/ui foundation, **behind a
  working login**, rendering the "no messages yet" empty state. **Deployed to
  Vercel** from `apps/console` as the root directory.
- `packages/db` — Drizzle schema verified against the live database, worker
  client, generated Supabase types
- `apps/worker` — queue consumer (`FOR UPDATE SKIP LOCKED`), self-contained
  bundle, Dockerfile. **Deployed to Azure Container Apps, `minReplicas: 1`,
  running warm in Malaysia West, on the real ghcr image pinned by digest.**
- Ingest webhook routes, WhatsApp signature verification tested
- Supabase keepalive as a daily Vercel cron
- Git repository **pushed to https://github.com/Yuringgg/switchboard**, CI green,
  with a **working pre-commit secret scan** (`.githooks/`, wired via
  `core.hooksPath` by `pnpm install`)
- `.env.example`, `.gitignore`, `.gitattributes`, CI workflow
- Every not-yet-built directory holds a README naming what lands there and when

`pnpm check` (typecheck + test) is green. `pnpm dev` serves the console on 3100.

**Phase 1 so far** (2026-07-27):

- **Google Cloud fully configured** — project `switchboard-503613`, Gmail +
  Calendar APIs, consent screen (External, Testing, `leiruychua@gmail.com`
  allowlisted, both scopes), OAuth client, topic `gmail-push` with Gmail granted
  Publisher, push subscription `gmail-push-sub` authenticated via
  `gmail-push-invoker@…` with matching audience
- Credential encryption (`packages/core/src/crypto.ts`) — AES-256-GCM; console
  encrypts, worker decrypts. `bytea` round-trip verified against the live
  database through PostgREST
- Gmail push verification + notification parsing (`packages/adapters/gmail`)
- **OAuth connect flow** — `/channels` with a Gmail Connect button, CSRF `state`
  in an httpOnly cookie compared timing-safely before the code exchange,
  `access_type=offline` + `prompt=consent` so a refresh token always comes back,
  partial scope grants refused up front, `users.getProfile` used to prove the
  token works before anything persists
- Migration 0003: `unique (owner_id, type, display_name)` on `channels`, so a
  reconnect can't create a second row for the same mailbox and double every message
- `GET /api/health/config` — signed-in only, reports env presence and shape but
  **never values**, plus `deployment.commit` so "did my change actually deploy?"
  is answerable by reading rather than by inference
- **`users.watch` registration** — in the OAuth callback, so a connect and a
  watch cannot come apart. **Verified live: `sync_state` has a cursor and the
  watch expires 2026-08-02 20:08:03 UTC.** Gmail is publishing.
- **Watch renewal in the worker** — sweeps every 6 hours, renews at T-2 days, and
  on failure sets `channels.status='error'` with the reason so it surfaces on
  `/channels`. It lives in the worker rather than a Vercel cron because it must
  decrypt every user's credentials. Proven in production against a probe channel
  with a deliberately invalid refresh token.
- **The webhook queues.** `/api/webhooks/gmail` verifies the OIDC token → looks
  up the channel by notified address → inserts one `raw_events` row → 200.
  `owner_id` comes from the channel, never the payload.
- **Migration 0004** — `unique (channel_id, external_id)` on `raw_events`,
  partial on `external_id is not null`. It was the only table on the ingest path
  with no idempotency guard, and it is the first one a Pub/Sub redelivery touches.
- **`service_role` now also lives in the console**, confined to
  `app/api/webhooks/` and enforced by `test/service-client-boundary.test.ts`.
  Read **ADR-013** before using it anywhere else — the answer is no.
- **CI runs `next build`**, and the pre-commit hook rejects BOM'd JSON. Both
  guard the same class of failure; see `docs/02-ARCHITECTURE.md` §8.

**✅ THE PIPELINE IS CLOSED, AND THE CONSOLE IS LIVE (2026-07-28).** `history.list`
+ `normalize`, the worker's upsert into `messages`, contact identity resolution
and the timeline all landed. Verified against the live database: **10 messages,
10 conversations, 7 contact identities.** A real email now reaches the screen.

**The console updates itself.** `messages` is published to Supabase Realtime
(migration `0005`), and `apps/console/src/components/live.tsx` subscribes with
the **user's own session** so RLS scopes the stream. A new row refreshes the
list where you are already at the top, and is counted behind a pill where you
are not. Realtime moved out of Phase 3 to get here — `docs/04-ROADMAP.md`
records that. Two things follow for anyone touching the console:

- **The frame does not scroll; the message column does.** `AppShell` is
  `h-dvh` + `overflow-hidden`, and exactly one element owns the scroll. Going
  back to `min-h-dvh` puts the sidebar back on the ride.
- **`channels` is fetched once per request and passed down as a promise.** It
  used to be queried in the page *and* again inside `AppShell`, which cost a
  whole extra sequential round trip to Singapore for data already in hand.

Attachments moved to Phase 3. No WhatsApp, no assistant.

**A design pass landed on the console (2026-07-28) — read
`correspondence/2026-07-28-ui-design-pass.md` before touching `apps/console`.**
The direction was not replaced, but four defects were fixed and two things
changed that a build session must know about:

- **The type scale is now tokens** (`--text-label` … `--text-display` in
  `globals.css`), and **adding a step means editing `lib/utils.ts` too.**
  tailwind-merge reads `text-subject` as a *colour*, so `cn()` drops it unless
  the `font-size` group is extended — a missing step renders at the browser
  default of 16px with **no error**. It silently hit four elements once.
- **Channel identity may never rest on the coloured dot alone.** Gmail red
  against WhatsApp green is the red/green confusion pair, and this is the one
  question the product exists to answer. `channelChangePoints`
  (`lib/timeline.ts`) names the channel wherever the line changes. Do not
  remove it and leave the dot to work alone.
- `localhost:3100/preview` renders the timeline over fixtures so the console
  can be looked at without a login or real mail. **Development only**, guarded
  by `notFound()` and a conditional `PUBLIC_PATHS` entry, both on `NODE_ENV`.
- **Dark mode is a stored preference now, not a media query.** `globals.css`
  said it followed the OS only; **Yuri overruled that on 2026-07-28** and the
  toggle shipped. The tokens switch on a `.dark` class, `lib/theme.ts` owns the
  decision, and a **blocking inline script in `<head>`** applies it before
  first paint. ⚠ That script must stay synchronous and stay in `<head>` — move
  it and the page renders light then flips. Its fallback logic must also keep
  matching `readStored()`, or an unrecognised stored value paints one theme
  while the control claims another.

Two normalization rules were settled before `normalize` was written — read
`docs/02-ARCHITECTURE.md` §2 first: **`bodyText` is always synthesised** (the
column is `not null`, HTML-only email is common, `''` is a legal value), and
**attachments are provider references only**, with no bytes downloaded in Phase 1.

Do not skip ahead. The adapter contract exists; use it.

**⚠ NEVER RUN `drizzle-kit generate` OR `drizzle-kit migrate`.** Run against the
live database on 2026-07-26, `generate` proposed disabling RLS on all ten tables
and dropping all ten `tenant_isolation` policies — silently dismantling the
security boundary. Migrations are hand-written SQL in `packages/db/migrations/`.
Full reasoning in `packages/db/drizzle.config.ts`. Drizzle-as-ORM is fine and
unaffected. `drizzle-kit pull` is safe.

**✅ RESOLVED 2026-07-27 — two consecutive incidents, kept because the second
misdiagnosis is instructive and the failure mode will recur.**

**Incident 1 — the Google env var.** `/api/auth/google/start` returned 500.
Diagnosis was right: the Google variables were genuinely unbound on the
then-current deployment, because **Vercel binds environment variables when a
deployment is created**, so a variable added afterwards does nothing until the
next build. A redeploy fixed it, and OAuth succeeded — the `channels` row was
created at 19:43 UTC.

**Incident 2 — the one that cost the time.** That successful connect produced an
`active` channel with **empty `sync_state` and no error**. Read as "watch
registration is broken" or "still a missing variable." It was neither. The two
commits carrying watch registration had **ERRORED at build**, and **Vercel keeps
serving the last deployment that built** — so production stayed on
pre-watch-registration code while looking perfectly healthy. The build failure
was a **UTF-8 BOM** in `packages/adapters/gmail/package.json`, written by
PowerShell's `Out-File -Encoding utf8`. It detonated late: without an `exports`
map a resolver never strictly parses the manifest, and adding `exports` forced
the parse the BOM breaks. Fixed in `908dc87`; the next reconnect registered the
watch at 20:08 UTC.

Three lessons, all now guarded:

1. **A failed build that pins production to old code is worse than an outage**,
   because the symptom is an application bug that doesn't exist. `active` channel
   + empty `sync_state` + no error is a state *only the old code can produce* —
   and it reads as a logic error in code that was never running.
2. **`tsc`, `vitest` and `pnpm` all tolerate a BOM.** `pnpm check` and both CI
   jobs were green while the deploy could not build at all. **CI now runs
   `next build`**, the only step that resolves through `exports` maps.
3. **Answer "which commit is serving?" by reading, not inferring.**
   `/api/health/config` reports `deployment.commit`. The Vercel MCP cannot see
   this project (`docs/03-RESOURCES.md` §8), so the dashboard is the fallback.
   Equally: **check state against the live database before concluding from
   code.** `sync_state` had a cursor for hours while the build session's notes
   still said it was empty.

**✅ INGEST IS LIVE — first real notifications queued 2026-07-27 05:30 UTC.**

`SUPABASE_SERVICE_ROLE_KEY` is set on Vercel (Production + Preview, Sensitive).
**Two `raw_events` rows landed from a real email**, correct `channel_id`, correct
`owner_id`, `status='done'`, one attempt, no error. Gmail → Pub/Sub → OIDC
verification → channel lookup → insert now works end to end for the first time.

**⚠ Never prefix that variable with `NEXT_PUBLIC_`** — it would inline a key that
bypasses every RLS policy into browser JavaScript. A test fails if anyone does.

**Paste hygiene, learned the hard way:** `apps/worker/.env` wraps some values in
double quotes and dotenv strips them, but **Vercel's dashboard stores the field
verbatim** — so a value pasted with its quotes becomes `"sb_secret_…"` and every
request fails auth in a way that reads as a bad key. Paste values unquoted.
`/api/health/config` does not yet check this variable at all, and `inspectVar`
does not yet flag wrapping quotes; both are worth adding next to the existing
whitespace and line-break checks.

**⚠⚠ THE GMAIL CONNECTION EXPIRES EVERY 7 DAYS. Verified 2026-08-02.**
The consent screen is **External + Testing**, and Google expires every refresh
token **7 days from the moment the user clicked Allow** — not from last use, not
configurable, per user. When it lapses `refreshAccessToken` returns
`invalid_grant`, the worker's sweep sets `channels.status='error'` within 6
hours, `/channels` shows *Needs attention*, and **mail stops arriving.** The fix
is one click on Connect. **Reconnect on the morning of any demo.** Publishing
the consent screen would end this and trigger the CASA assessment testing mode
exists to avoid — do not. Full note: `docs/03-RESOURCES.md` §2.

**Multi-tenancy, stated plainly because it is asked every time:**

- **The code is multi-tenant for both channels and always has been.** Gmail's
  OAuth callback writes `owner_id` from the session with RLS `WITH CHECK`
  enforcing it; WhatsApp's webhook resolves each message to its own channel and
  owner, including several numbers in one POST.
- **Gmail's limit is Google's, not ours:** every user's address must be added by
  hand to the test-user allowlist, hard-capped at **100** (verified 2026-08-02),
  and each of them reconnects weekly per the note above.
- **WhatsApp's limit is what WhatsApp is:** there is no personal WhatsApp API, so
  a user cannot connect "their own". An admin assigns a **business number** —
  2 per WABA, up to 20 once business-verified (ADR-009).
- **A shared mailbox fans out to every owner** (fixed 2026-08-02). Two tenants
  connecting the same address is permitted by migration 0003 and used to break
  ingest: `.maybeSingle()` errors on two rows, so the route 500'd and Pub/Sub
  retried that mailbox forever while both consoles stayed empty. It now writes
  one `raw_events` row per owner — `fanOutToChannels`,
  `apps/console/src/lib/ingest.ts`. ⚠ **Never "fix" a multi-row lookup on this
  path with `.limit(1)`.** That is worse than the crash: it delivers one
  tenant's mail to whichever row sorted first, and no RLS policy catches it.

**→ Next action: Yuri's Meta clicks.** Developer account, an app with the
WhatsApp product, the free test number, up to 5 verified recipients, the webhook
registered with the **`messages` field subscribed**, the four `WHATSAPP_*`
variables on Vercel, then `packages/db/scripts/provision-whatsapp.ts`. The full
checklist with the traps is `docs/03-RESOURCES.md` §6.

**While that is pending, the useful build is Phase 3 search** — Postgres
full-text over `body_text`. It needs no new credentials and there are 16 real
messages to search.

Credentials: **Supabase and Google Cloud are both fully configured.**
`apps/worker/.env` holds `DATABASE_URL` (Supavisor session mode, port 5432 — the
direct connection is IPv6-only and Container Apps egresses IPv4) and
`SUPABASE_SERVICE_ROLE_KEY`. Google project `switchboard-503613` exists with both
APIs, consent screen, OAuth client, topic and push subscription — see
`docs/03-RESOURCES.md`. Meta, Gemini and Groq don't exist yet — Phase 2 and later.

**Tooling notes:** the **Azure MCP still times out even after `az login`** — use
the `az` CLI directly, at
`C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd` (not on `PATH`).
`gh` is not installed. **The Vercel MCP cannot see `switchboard-console`** — it
authenticates to team `Yuringgg`, which holds only `ageni-academy`, while
Switchboard is on the personal Hobby scope. Build and runtime logs are therefore
dashboard-only; reproduce build failures with `pnpm --filter console build`.
**The Supabase MCP is the one to reach for** — checking a claim against the live
database has twice caught what reading the code did not.

**Accounts:** `dev@switchboard.test` was deleted on 2026-07-26 along with its
seed file. **There are now TWO users**, both created through the normal signup
flow — `leiruychua@gmail.com` (`ec7645a6-…`), which owns the Gmail channel and
all 16 messages, and `hiraimumu1616@gmail.com` (`f5131cd5-…`), which owns
nothing. This file claimed there was only one until 2026-07-28; corrected after
querying `auth.users`.

⚠ **That matters for Phase 2.** A WhatsApp number is assigned to a specific
`owner_id`, and only that tenant will ever see its messages — RLS is doing
exactly what it should. Provision against `ec7645a6-…` unless you mean
otherwise. The second account is also the first real chance to *see* tenant
isolation working rather than only testing it.

**Environment notes for builders** — both cost time to rediscover:

- Node 25+ unbundled corepack, so `pnpm` was installed globally with
  `npm i -g pnpm`.
- **TypeScript is pinned to `^5` and must stay there.** 7.x is the native Go
  port and exposes no classic compiler API, which breaks `next build`'s type
  check with a misleading error. `tsc --noEmit` passes either way, so the
  workspace can look green and still fail to build. See
  `docs/02-ARCHITECTURE.md` §8.
- Packages are consumed as **source**, not built output, so `tsconfig.base.json`
  uses `module: preserve` (bundler resolution) rather than NodeNext. The worker
  will therefore need bundling (tsup/tsx) rather than raw `node`.

**Environment note:** Supabase's free tier caps at 2 active projects. Both slots
are in use — `switchboard` (`ap-southeast-1`, active) and `ageni-academy`
(paused 2026-07-25 to free the slot). **Do not create a third.** Full state in
`docs/03-RESOURCES.md` §9.

**Nothing is blocked on the mentor.** Scope, channels, and what the tool monitors
are all settled — see the resolved list in `docs/06-OPEN-QUESTIONS.md`.

---

## 6. Stack summary (details in `docs/02-ARCHITECTURE.md`)

- **Language:** TypeScript end to end, pnpm workspaces monorepo
- **Console + ingest webhooks:** Next.js 16 App Router + Tailwind + shadcn/ui →
  **Vercel**. Webhooks are serverless routes in the same app (ADR-011).
- **Worker:** containerized Node → **Azure Container Apps, `minReplicas: 1`**.
  Stays warm because it holds ONNX embedding weights in memory.
- **Database:** Postgres + pgvector + Realtime + Auth + RLS → **Supabase**
- **Object storage:** attachments → **Azure Blob Storage**
- **Assistant Q&A:** **Gemini 2.5 Flash** — 250K tokens/min and a 1M context
  window. RAG prompts are large, so tokens/min is the binding limit. ADR-003.
- **Extraction:** **Groq / Llama** — many small prompts, 14.4K req/day.
- **Embeddings:** **local**, Transformers.js. Free, unlimited, cannot fail
  mid-demo. **Must be multilingual — the corpus is Taglish.**

Concrete library picks (ORM, validation, testing, dates) are pinned in
`docs/02-ARCHITECTURE.md` §8. Don't re-litigate them without a reason.

- **Auth / tenancy:** Supabase Auth; `owner_id` on every table; **RLS is the
  security boundary, not defense in depth.** ADR-009.
- **Calendar:** Google Calendar `events.insert`, **user-confirmed only**. ADR-010.

**Channels: Gmail first, WhatsApp second. Telegram was cut. Calls are out of
scope entirely** — see ADR-008 before anyone suggests adding them.

**Three things that are easy to get wrong and expensive to fix late:**

1. **`owner_id` must be derived from the channel, never the provider payload.**
   The worker uses `service_role`, which bypasses RLS — a mistake here leaks one
   tenant's messages into another's console and no policy will catch it.
2. **The embedding model must be multilingual.** The corpus is Taglish;
   English-only models fail in a way that looks like a ranking bug.
3. **Never create a calendar event without explicit user confirmation.** Propose,
   don't assert.

**Four WhatsApp-specific traps, all guarded by tests but worth knowing:**

1. **Every level of Meta's envelope is an array** — `entry[] → changes[] →
   messages[]`. Every example in Meta's docs has exactly one of each, so
   `entry[0].changes[0].value.messages[0]` passes every test written from the
   documentation and **silently drops mail**. `fixtures/whatsapp/batch.json`
   fails on it.
2. **`phone_number_id` is the tenant key; `display_phone_number` is a label.**
   The id is opaque and stable, the display number is formatted and Meta calls
   it a display value. Never resolve a tenant on the latter.
3. **Timestamps are unix SECONDS in a string.** Read as milliseconds every
   message lands in 1970 — and sorts correctly among itself, so a WhatsApp-only
   timeline looks perfectly normal.
4. **Most traffic is `statuses`, not messages.** Delivery receipts arrive on the
   same field. Queue them and every message the business sent appears twice.

**⚠ Never use `whatsapp-web.js` or Baileys.** They impersonate WhatsApp Web,
violate Meta's terms, and get numbers banned. The Cloud API only receives
messages sent *to a business number you control* — it cannot read existing
personal conversations, and no library changes that legitimately.

---

*Last updated: 2026-08-02 · Phase 2 **pushed and deployed** (adapter, ingest,
worker, migration 0006, ADR-014). Gmail ingest now fans out to every owner of a
shared mailbox. The 7-day refresh-token expiry was found and written up — read
the warning at the top of §5 before anything else. 295 tests.*

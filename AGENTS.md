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

**Phase 0 ✅ · Phase 1 ✅ · Phase 2 🟡 code complete, awaiting Meta ·
Phase 3 🟡 search + message route + timeline channel filter shipped ·
Phase 4A ✅ shipped · Phase 4B ✅ shipped and its loose ends closed ·
Phase 5 ✅ shipped (extraction, the `/attention` **board**, calendar
write-back) · **Ms. Maria's 2026-08-05 review ✅ built** — polish remains.**

### ⚠ Ms. Maria's review landed 2026-08-06 — six things a console session must know

Full note: `correspondence/2026-08-06-maria-changes.md`. The headline was
*"halatang ginawa mo siya sa AI"* — and two thirds of it was measurable, not
taste.

1. **⚠ BOTH TYPEFACES CHANGED.** Instrument Sans + IBM Plex Mono → **Archivo +
   Martian Mono**. The old pair sits on the reflex-reject list of training-data
   defaults in `.agents/skills/impeccable/reference/brand.md`, which is exactly
   why a person who sees a lot of generated work recognised them. The *two-voice
   split* (sans for what a person wrote, mono for what the machine knows) is
   kept and is not negotiable.
2. **⚠ EVERY STEP OF THE TYPE SCALE MOVED, and `--text-hero` is new.** Anything
   added to the `--text-*` tokens must be added to `lib/utils.ts` in the same
   commit — tailwind-merge reads an unknown `text-*` as a *colour*, so `cn()`
   drops it and the element renders at 16px with no error. The stencilled
   label's tracking came DOWN (0.16em → 0.1em): Martian Mono is a wider face.
   ⚠ The mobile dock's label is pinned at a literal 12px and deliberately does
   **not** follow the scale — six entries fit 375px within two pixels.
3. **⚠ THE LIGHT RAMP WAS REBUILT.** *"Squint ka muna"* was a defect: background
   `oklch(0.994)` against panel `oklch(0.972)` is **2.2% of lightness apart**,
   so the frame-versus-record idea was carried by a step nobody can see. Now
   0.981 / 0.947 / border 0.872. **Do not push `--background` back toward 1.0 to
   make it look cleaner** — that is the change that produced the complaint.
4. **⚠ `live.tsx` NO LONGER HAS AN `offline` STATE.** A dropped socket now
   reconnects on capped backoff, polls every 20s meanwhile, and refreshes on
   tab focus. The third state is `Syncing`, not a red `Offline` telling the
   reader to reload — which was the manual refresh Ms. Maria asked to be rid
   of, dressed as a status light. It must stay visibly distinct from `Live`
   (different word, non-blinking lamp), because "no new mail" and "the socket
   died" looking alike is the defect that indicator exists to prevent.
5. **⚠ `/attention` IS A BOARD, and migration 0012 added `extractions.status`.**
   `confirmed_at` is **not** read as "done" — a meeting on the calendar is
   *real*, not *finished*. The Done column sorts by `status_changed_at`, never
   by deadline: everything completed is eventually overdue, so the obvious sort
   fills the column you just cleared with red flags. `status` is written by a
   person and by nothing else, the same rule ADR-010 sets for calendar events.
6. **⚠ `/` IS PUBLIC-FACING NOW.** An unauthenticated request for the bare root
   redirects to **`/welcome`**, the landing page, not to `/login`. Every other
   gated path still goes to `/login?next=…`. `/welcome` is in `PUBLIC_PATHS` and
   reads no tenant data — if anything on it ever queries a message, a channel or
   an extraction, that entry has to be reconsidered.

⚠ **Still owed to Ms. Maria: the Figma prototype of the landing page.** She
asked for it explicitly and gave the reason — *"para ma-document yun for your
defense"*. The page was designed and built in code because this session cannot
drive Figma. It is documentation for the defence, not decoration.

⚠ **Nobody has LOOKED at any of it.** This environment has no screenshot
capability and the browser pane does not composite, so every claim above is a
DOM measurement. `localhost:3100/welcome` and `/preview?screen=attention` are
where to look before showing Ms. Maria.

**§7 at the bottom of this file is the fastest way to know where things stand** —
it carries the verified numbers and the next action. Read that, then come back.

> **Joining cold? Read these in order after this file:**
> `correspondence/2026-08-06-maria-changes.md` — **most recent.** Ms. Maria's
> five changes from the 2026-08-05 meeting: the landing page, the Kanban board
> (migration 0012), the timeline's channel filter, the light-mode rebuild, the
> font replacement, and auto-sync. ⚠ Read it before touching `apps/console` —
> both typefaces changed, every step of the type scale moved, and `live.tsx`'s
> `offline` state no longer exists.
> `correspondence/2026-08-04-assistant-figure-and-mobile-dock.md` — the two
> generator-supplied components and the seven silent defects in them.
> `correspondence/2026-08-02-assistant-loose-ends.md` — Why the
> assistant's "over-refusal" was a misdiagnosis, and the three loose ends closed.
> `correspondence/2026-08-02-phase-4b-assistant.md` — the assistant, and the two
> documented decisions that measurement disproved.
> `correspondence/2026-08-02-search-and-summaries.md` — search, summaries, and
> the CI that was red for five days without anyone noticing.
> `correspondence/2026-07-28-phase-1-complete-handoff.md` — what is deployed
> where, the seven rules that are not negotiable, and the silent failure modes.
> `correspondence/2026-07-28-phase-2-whatsapp.md` — Phase 2 and the refactor
> checkpoint's finding.

⚠ **This project keeps having documented decisions contradicted by measurement**
(ADR-012, ADR-014, ADR-016, ADR-003's provider, **ADR-017**, and four more found
on 2026-08-03 — see below). The pattern is usually the same: the doc was right
when written and quietly stopped being right. ⚠ **ADR-017 adds a variant worth
knowing: the doc was wrong from the moment it was written**, because the failing
measurement was never traced past its first plausible explanation.

**Found 2026-08-03, all four by running or querying rather than reading:**

1. **The eval paced 5× over the ceiling its own comment derived** — *"~4
   requests/minute is the ceiling. 3s is comfortably inside it."* 3s is twenty
   per minute. It cost two cases.
2. **`extractBatch`'s "they are not lost — the backfill picks them up" was true
   of the data and false of the process.** Nothing scheduled the backfill.
3. **The Gmail watch expiry and the OAuth token expiry are different dates**,
   and the docs had merged them into one.
4. **"All four `WHATSAPP_*` variables on Vercel" — only two are ever read.**

⚠ The shape they share: **a claim that was checkable in seconds and had never
been checked.** Three of the four were found by counting rows or grepping for a
variable name, not by anything clever.
**Check a claim against the live system before building on it** — the Supabase
MCP, `az containerapp logs`, and reading a provider's own rate-limit headers have
each caught something reading could not.

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
- Git repository **pushed to https://github.com/Yuringgg/switchboard**, with a
  **working pre-commit secret scan** (`.githooks/`, wired via `core.hooksPath`
  by `pnpm install`)

> **⚠ CI was RED from 2026-07-28 to 2026-08-02, and this file said it was
> green.** Runs #31–#39 all failed at `pnpm install --frozen-lockfile`. The
> cause: Phase 2 added `packages/adapters/whatsapp` and new dependencies to
> `apps/console` and `apps/worker` **without regenerating `pnpm-lock.yaml`** —
> the lockfile is simply absent from that commit's diff. `--frozen-lockfile` is
> on by default in CI, so every push since failed before running a single test,
> including four docs-only commits.
>
> It stayed invisible because **`pnpm` was not installed on the build machine**,
> so nobody could run the failing command locally, and `vitest`/`tsc` invoked
> directly were all green. Fixed 2026-08-02 by installing `pnpm@11.17.0` (the
> pinned `packageManager`) and regenerating the lockfile.
>
> **The rule that follows: adding or changing ANY `package.json` means running
> `pnpm install` and committing `pnpm-lock.yaml` in the same commit.** If pnpm
> is missing, `npm i -g pnpm@11.17.0` — it takes twenty seconds and it is the
> difference between CI meaning something and CI being decoration.
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
is one click on **Reconnect** on `/channels` — ⚠ the button is labelled
`Connect` only while a channel is *unconnected*; once a row exists it reads
`Reconnect` (`channel-list.tsx`), and telling someone to look for "Connect"
sends them hunting for a button that is not on the screen. Everything after the
click is Google's own screens and they vary: the account chooser appears only
with more than one Google account signed in, and the unverified-app warning
depends on Google's state, not ours. **Reconnect on the morning of any demo.**
Publishing
the consent screen would end this and trigger the CASA assessment testing mode
exists to avoid — do not. Full note: `docs/03-RESOURCES.md` §2.

**Multi-tenancy, stated plainly because it is asked every time:**

- **The code is multi-tenant for both channels and always has been.** Gmail's
  OAuth callback writes `owner_id` from the session with RLS `WITH CHECK`
  enforcing it; WhatsApp's webhook resolves each message to its own channel and
  owner, including several numbers in one POST.
- **Gmail's limit is Google's, not ours:** every user's address must be added by
  hand to the test-user allowlist, and each of them reconnects weekly per the
  note above. **There is no API for that allowlist** — the Cloud Console is the
  only way, and Google withdrew the IAP OAuth Admin APIs in March 2026, so this
  genuinely cannot be automated. Asked and answered on 2026-08-02; do not spend
  time looking for one again.
- **⚠ The 100 cap is a LIFETIME total, not a concurrent one.** Google's wording
  on the Audience screen: *"Allowed user cap prior to app verification is 100,
  and is counted over the entire lifetime of the app."* It never resets. At
  **1/100** on 2026-08-02. Every throwaway account burns one permanently, so do
  not churn test accounts casually.
- **"Make internal" is greyed out** on `switchboard-503613` (checked in the
  Cloud Console, 2026-08-02) — the project is not in a Workspace organisation.
  Workspace *Internal* would remove the cap, the allowlist and the 7-day expiry
  in one move, but it needs iOzera IT to move the project into their org. Worth
  asking Ms. Maria; do not plan around it.
- **A blocked user does not look blocked.** Google returns `access_denied` for
  *both* "you cancelled" and "you are not on the allowlist", and usually blocks
  on its own page without redirecting back at all — so the callback's message is
  often never seen. Fixed 2026-08-02: the message names both causes, and
  `/channels` states the requirement **before** the click, quoting the reader's
  own address for an admin to paste. ⚠ Do not collapse that message back into a
  confident "Connection cancelled." — it sends a blocked user to retry the same
  click forever.
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

**Phase 4A — per-message summaries — added 2026-08-02.** A **third AI workload**:
not the assistant (questions across the corpus) and not extraction (structured
rows), but one small prompt per message on ingest. Sequenced **before** the
assistant because it is far cheaper and proves the Groq path first. Plan in
`docs/04-ROADMAP.md`; storage decision in **ADR-015**.

⭐ **It is in the founding request, not an addition.** Ms. Maria, 2026-07-25:
*"Do you think you can make a live webapp that can view whatsapp messages real
time **and have ai summarize** bebe? Parang admin view"*, and again on
2026-08-01: *"dont forget to incorporate an llm din to summarize noo"*. **The
summarizer was always half the product.** It reached the roadmap only on
2026-08-02 because her original WhatsApp thread had never been read into the
docs — `docs/00-CONTEXT.md` §2a now carries it verbatim, and it corrects three
other things the reconstruction had lost.

⚠ **It is also the first time message bodies leave this system.** Nothing has
ever been sent to a third party. That makes Q2's consent conversation with Ms.
Maria more urgent, and it makes prompt injection a real surface — an email can
try to dictate its own summary, and a human reads the result.

**She also said (2026-08-01) she "checked your systems and queries and set aside
the answers and recommendations".** Checked exhaustively on 2026-08-02: they are
not on GitHub — no issues, pull requests, comments, branches besides `main` or
forks, and every repo event is Yuri's own push. **✅ CLOSED 2026-08-03 — Yuri
withdrew the chase; the project proceeds on the scope already built (R22). Do not
re-open it.** ⚠ That accepts `docs/00-CONTEXT.md` §7's open-scope risk rather
than resolving it: do not read the absence of the question as scope having been
formally confirmed by iOzera. The **consent** question (Q2 / RA 10173) is
separate and stays open — it gates real *client* data, not the dogfooding on
Yuri's own accounts that is all this system has ever seen.

**→ Next action: Yuri's Meta clicks.** Developer account, an app with the
WhatsApp product, the free test number, up to 5 verified recipients, the webhook
registered with the **`messages` field subscribed**, **two** `WHATSAPP_*`
variables on Vercel (`WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` —
**not four**, corrected 2026-08-03), then
`pnpm --filter @switchboard/db provision-whatsapp` — ⚠ **not** plain `node`,
which cannot resolve this workspace's extensionless imports and dies naming
`core` rather than the script. The full checklist with the traps is
`docs/03-RESOURCES.md` §6.

**Phase 3 search shipped 2026-08-02** — `/search`, migration 0007. Three things
a session touching it must know, each of which had a plausible wrong answer:

- **The text-search config is `simple`, never `english`.** The corpus is
  Taglish and Postgres has no Tagalog configuration. An English stemmer applies
  Porter rules to Tagalog words and strips the stopword "at", which is Tagalog
  for "and" — and it fails by returning the *wrong rows*, which reads as a
  ranking bug rather than a config mistake. The cost of `simple` is no
  stemming, paid for by a trailing `:*` on the last term so "deadline" still
  finds "deadlines".
- **`search_messages` is SECURITY INVOKER and must stay that way.** As
  DEFINER it would run as its owner, RLS would not apply, and any signed-in
  user could read every tenant's mail through an RPC. Negative-controlled
  against the live database — owner sees 65, the second account sees 0.
- **Two query modes, and raw user text may only ever go to the websearch one.**
  `to_tsquery` raises on malformed input; `websearch_to_tsquery` cannot express
  a prefix. `buildQuery` strips to word characters before using the raising
  parser, so it only sees machine-built strings.

**Phase 4A shipped 2026-08-02** — the summarizer Ms. Maria asked for twice.
Migration 0008, `packages/ai`, a worker step, a backfill script and a 10-case
eval set that passes 10/10 against the live model. Five things a session
touching it must know:

- **⚠ It must NEVER fail an event.** A summary is additive. The step sits
  between ingest and `markDone`, wrapped so nothing it does can reach the
  handler that calls `markFailed` — that would burn an attempt on a message
  which ingested perfectly. `GROQ_API_KEY` is deliberately **optional** in
  `env.ts`: no key means no summaries and mail flows exactly as before.
- **⚠ `llama-3.1-8b-instant`, never `llama-3.3-70b-versatile`.** Verified from
  the live rate-limit headers: 14,400 req/day against **1,000**. One backfill
  would eat the 70B's allowance and live summarisation would then stop silently
  until midnight UTC.
- **Most WhatsApp messages will have no summary, and that is correct.** The
  `already-short` skip rule fires under 280 characters, because paraphrasing a
  one-line chat message is no shorter and less true. Say this before a demo
  rather than debugging it during one.
- **The summary never replaces the sender's words** — opened row only, above the
  body, in the mono machine voice, labelled with the model. Not the headline,
  not the preview line. ADR-015 rejects that outright and it is the defence that
  still holds if a prompt injection ever succeeds.
- **The prompt fences the body with a per-request random nonce**, so a hostile
  message cannot close a delimiter it cannot predict. Three injection fixtures
  in the eval, all resisted. One residual weakness recorded honestly in
  `docs/04-ROADMAP.md`: the model will adopt an in-band identity claim as
  attribution. The console showing the *real* sender from `contact_identities`
  is what makes that survivable.

**Phase 4B shipped 2026-08-02** — the assistant Ms. Maria described first. Four
things a session touching it must know, and two of them contradict the docs that
came before:

- **⚠⚠ GEMINI IS NOT THE ASSISTANT'S PROVIDER ANY MORE.** Its free tier is
  **20 requests per DAY** — read straight off the quota error
  (`"quotaValue": "20"`), against the 250 `docs/03-RESOURCES.md` recorded. One
  eval run is 15 requests. The assistant runs on Groq
  `llama-3.3-70b-versatile` (1,000/day); summaries stay on
  `llama-3.1-8b-instant` so the two cannot exhaust each other. ADR-003 amended
  in `packages/ai/src/assistant-provider.ts`.
- **⚠⚠ THE SIMILARITY FLOOR DOES NOT WORK. READ ADR-016.** ADR-007 specified
  refusal as a retrieval threshold. Measured on the real corpus, the lowest
  *answerable* score (0.8487) sits **below** the highest *unanswerable* one
  (0.8563) — "recipe for adobo" out-scored "what failed in CI?". e5's normalised
  embeddings sit in a 0.75–0.90 band, so absolute distance carries almost no
  relevance signal; **ranking does**, and ranking is excellent. The refusal is
  now the model's job, a *relative* floor replaces the absolute one, and the
  eval is what proves it. Re-run `probe-floor.ts` after any change to the model,
  the chunker or the prefixes.
- **The e5 prefixes are applied inside `embedQuery`/`embedPassages`**, never at
  call sites. `query:` for questions, `passage:` for stored text — they are not
  interchangeable, and omitting them does not error, it just ranks worse.
- **An answer that cites nothing is rendered as a refusal.** That is a success
  criterion (`docs/01-PRODUCT-SPEC.md` §7), not a UI detail. Do not "improve"
  the assistant by letting it answer without citations.

**Worker side is deployed and verified (2026-08-02):** revision `--0000013`,
`[embed] model ready in 5.6s`, ingress external, `POST /embed` answering from
the public internet with 401 on a missing or wrong token.

⚠ **It crashlooped first — exit code 137, OOM.** The worker was sized
**0.25 vCPU / 0.5 GiB** and a 129 MB quantised ONNX model needs far more than
its own size once the runtime and Node's heap are counted. Now **0.5 vCPU /
1.0 GiB**. Two things to carry forward:

- **Running cost roughly doubles, to ~$20–30/month** (ADR-011 amended). Over
  four months that approaches the whole $100 credit — the "meaningful headroom"
  `docs/03-RESOURCES.md` §1 predicted is now spent.
- **⚠ Graceful degradation cannot survive OOM.** `warmEmbedder()` is
  deliberately non-fatal so a bad image degrades instead of crashlooping, and it
  did not help at all: the kernel SIGKILLs the process, so no handler runs and
  nothing is logged. **Size memory before loading a model** — an error handler
  is not a substitute.

✅ **`/assistant` ANSWERS IN PRODUCTION.** Confirmed by Yuri on 2026-08-03:
`EMBED_API_URL`, `EMBED_API_SECRET` and `GROQ_API_KEY` are set on Vercel and the
deployment was recreated, so the whole path — question → worker `/embed` →
`match_chunks` under the user's own session → Groq → cited answer — runs live.
Verified end to end against a real question, with the citation resolving to the
right message. *(Earlier docs said this was still outstanding; it is not.)*

**⚠ CI does not repoint the Container App.** `worker-image.yml` pushes a new
image to ghcr; the app runs one pinned by **digest**. Until
`az containerapp update --image <digest>` is run, the deployed worker keeps
running old code while the commit looks deployed — the same shape as the BOM
incident. Both AI keys are in `apps/worker/.env`; Groq is also an Azure
**secret** (`groq-api-key`).

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

- Node 25+ unbundled corepack, so `pnpm` must be installed globally:
  **`npm i -g pnpm@11.17.0`** (match `packageManager` in the root
  `package.json` — a different major writes a lockfile CI will reject).
  ⚠ **It goes missing after a Node upgrade**, and when it is missing the
  temptation is to run `vitest`/`tsc` directly and call it green. That is
  exactly how CI stayed red for five days without anyone noticing — see the
  warning above. Reinstall it rather than working around it.
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
- **Assistant Q&A:** **Groq `llama-3.3-70b-versatile`** — ⚠ **not Gemini.**
  ADR-003 said Gemini 2.5 Flash on the strength of 250 requests/day; measured
  2026-08-02 that free tier is **20 per day**. Groq gives 1,000/day, though the
  binding limit is ~100K tokens/day ≈ **30 questions/day**. Amended in
  `packages/ai/src/assistant-provider.ts`; `ASSISTANT_PROVIDER=gemini` reverts.
- **Summaries:** **Groq `llama-3.1-8b-instant`** — 14,400 req/day. A *different
  model* from the assistant on purpose: Groq's limits are per-model, so heavy
  assistant use can never stop mail being summarised.
- **Embeddings:** **local**, Transformers.js, `Xenova/multilingual-e5-small`
  (384d, 129 MB). Free, unlimited, cannot fail mid-demo. **Must be multilingual
  — the corpus is Taglish**, and it is measurably doing that job (a Tagalog
  message out-scored an English one on an English query).

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

---

## 7. Where this is, right now — read this and you know what to do

**Date of this block: 2026-08-02.**

| | State |
|---|---|
| **Phase 0** | ✅ complete |
| **Phase 1 — Gmail** | ✅ complete and **live**. 49 real messages, watch renewing itself in production |
| **Phase 2 — WhatsApp** | 🟡 **code complete, pushed, deployed.** Dormant until Meta credentials exist |
| **Phase 3 — console** | 🟡 **search + filters shipped and deployed.** Migration 0007, `/search`. Remaining: contacts, identity merge, attachments, virtualization |
| **Phase 4A — summaries** | ✅ **shipped, deployed, running.** Migration 0008, Groq 8b. **66/66 eligible messages summarised**, and new mail is summarised automatically on ingest |
| **Phase 4B — assistant** | ✅ **shipped and deployed.** Migrations 0009, local embeddings, `/assistant`. **75/75 messages embedded (397 chunks)**, worker serving `/embed`. ⚠ Prompt owes one tuning pass — see below |
| **Phase 5** | ✅ **shipped 2026-08-03.** Extraction pass (migration 0011), `/attention` (US-9), and calendar write-back on `/messages/[id]` (US-7b, ADR-010). Remaining Phase 5 items are polish: daily digest, error audit, README from a clean clone, diagram, demo rehearsal |

### Verified live on 2026-08-03 (late), by querying — not by inference

| | |
|---|---|
| Messages | **85** · 22 contacts · 2 users |
| Summaries | **71** |
| Embeddings | **83 / 85 messages**. ⚠ The gaps are bodies that are nothing but `\r\n` — correctly skipped, not a defect |
| **Extraction** | **83 runs, 0 outstanding.** Most wrote 0 rows, which is the ORDINARY result |
| Queue | **0 not done** |
| Channels | 1 Gmail, **0 in error**. ⚠ See the watch/token note below — they are different dates |
| Console | `/attention`, `/contacts`, `/messages/[id]` all gated correctly |
| Tests | **541** on 2026-08-06 (was 496) · typecheck and `next build` green; all 11 tables verified `rowsecurity` + `forcerowsecurity` + a policy with USING **and** WITH CHECK after 0012 |
| Migrations | **0012** applied 2026-08-06 (`extractions.status`, `status_changed_at`) — additive, no new table, so `assert-rls.ts` needed no change |
| Blob storage | ✅ **provisioned** — `swbattachments` / container `attachments`, malaysiawest |

### ✅ THE ASSISTANT EVAL HAS A COMPLETE SCORE, FOR THE FIRST TIME

```
answerable: 6/6   must-refuse: 7/7   provider errors: 3
```

**Zero logic failures.** 13 of the 15 scoreable cases measured, all passed. Two
sessions had failed to get here.

⚠ **Only ONE of the three provider errors was the daily cap** — and it was the
known-gap case, which is not scored. The other two were the **per-minute**
window, with 4,031 and 5,509 tokens still left in it, and they were the eval's
own fault:

> The pacing comment derived *"~4 requests/minute is the ceiling"* and then slept
> **3 seconds**, which is twenty per minute. From case 6 onward every request
> 429'd — the eval was self-throttling by failing. Now 20s, derived from the
> 3,000–4,000 tokens a question actually costs, and the per-minute window is
> retried up to 3 times (tested by **scope**, so a daily rejection still stops
> the run immediately). **Costs no extra tokens** — a 429 is a rejection, not a
> completion.

⚠ **The ~30 questions/day figure looks optimistic.** The daily cap tripped after
roughly **13** completions, not 30. `docs/03-RESOURCES.md` §4a always derived
~100K/day from observed 429s rather than anything Groq publishes. One
observation is not a refutation — but do not plan a demo day around 30.

⚠ **Groq's buckets replenish continuously.** A short targeted run succeeded
about half an hour after the daily rejection. Never write "resets at midnight"
in UI copy; it is false.

### ⚠ Two dates, and conflating them is why mail stops

`sync_state.expires_at` is the **Gmail watch**. It read **2026-08-10 07:39 UTC**
on 2026-08-03 — the worker's sweep had already renewed it. Earlier docs said
2026-08-08 and were describing something else.

**The thing that actually breaks ingestion is the OAuth refresh token**, which
Google expires **7 days after the user clicked Allow** (External + Testing, not
configurable). That is still ~**2026-08-08 19:34 UTC**. When it lapses the
renewal sweep itself starts failing, `channels.status` goes to `error`, and mail
stops. **Reconnect on `/channels` — the button says `Reconnect`, not `Connect`.**

**The full pipeline runs unattended:** a new email arrives → webhook → queue →
worker normalises → **summarises** → **chunks and embeds** → timeline. All three
steps confirmed on the newest message, which nobody backfilled.

**Blocked on exactly one thing, and it is not code:** Yuri cannot get past Meta's
developer-account phone verification (*"You can only complete this action in
Accounts Center"*). Everything after that is ~15 minutes — copy **two** values
into Vercel, redeploy, subscribe the `messages` webhook field, run
`pnpm --filter @switchboard/db provision-whatsapp`, send a test message.
Checklist with the traps: `docs/03-RESOURCES.md` §6.

⚠ **Two things in that sentence were wrong until 2026-08-03, and both were at
the end of the sequence where a mistake costs the most.** It said *four* values
(only two are ever read) and it gave a `node …provision-whatsapp.ts` command
that **has never been able to run** — `ERR_MODULE_NOT_FOUND` on
`packages/core/src/adapter`, because Node ESM will not resolve this workspace's
extensionless imports. Neither had been executed. Both are fixed above.

**Standing obligations, easy to forget:**

1. **Reconnect Gmail every 7 days** and on the morning of any demo. Last
   reconnect 2026-08-01; next lapse **2026-08-08**.
2. ~~Ask Ms. Maria for her recommendations / the BRD.~~ **Withdrawn by Yuri
   2026-08-03 — stop chasing it (R22).** ⚠ Note what that does *not* mean:
   `docs/00-CONTEXT.md` §7's open-scope risk is now **accepted**, not resolved.
   Do not read the absence of the question as scope having been signed off.
3. **⚠ Rotate the Groq and Gemini keys before this repo is shown to iOzera** —
   both were pasted into a chat transcript on 2026-08-02, at Yuri's explicit
   instruction. Nothing was committed; `.env` is gitignored.
4. **⚠ Run the full unfiltered eval before quoting any assistant score.** The
   last session's run was cut short by the daily token cap after measuring 1/1
   answerable and 2/2 must-refuse. A full run costs ~half a day's tokens, so do
   it first thing, not after burning budget on something else.
5. **⚠ Keep a genuinely future-dated meeting in the mailbox.** *"Do I have any
   upcoming meetings?"* is Ms. Maria's own example question, and it can only be
   answered from a mail whose date is still ahead. Yuri sent one on 2026-08-03
   (*"Project sync with Ms. Maria"*, Fri 7 Aug 3:00 pm) and the assistant answers
   it correctly — **but that expires on 8 August.** The eval now prints a loud
   STALE warning past `staleAfter` rather than just going red, so a failure is
   not mistaken for a prompt regression again. **Phase 5 extraction is the
   permanent fix** (US-7, R14).

**⚠ The assistant is capped at roughly 30 questions per day.** Measured: Groq's
70B allows 12,000 tokens/min and ~100,000 tokens/day, and one question costs
~3,000–3,500 tokens. Requests/day (1,000) never binds — the token cap does.
**Do not burn the day's budget the morning of a demo.** Search, embeddings,
summaries and ingest have no such limit.

**⚠⚠ That ~30/day is SHARED BY EVERY TENANT, not granted per user.** Groq's
limits are scoped to the **organization** — its own 429 says
`in organization org_01kz09ajk…` — and this deployment holds one Groq key. Five
users get ~30 questions *between them*, not 150, and **there is no per-user
throttle in the code**: one person can exhaust the assistant for everyone before
lunch, leaving the rest with "daily allowance used up" having asked nothing.
Not urgent at 2 accounts; real the moment iOzera adds a second person. **Q11.**
⚠ Do not confuse this with Gmail's limits, which genuinely *are* per user (the
7-day token expiry and the 100-user lifetime cap). The two fail differently.

**⚠ The assistant's "over-refusal" was a MISDIAGNOSIS — read ADR-017.**
This file used to say the prompt over-refuses two answerable questions and owes
one tuning pass. Measured on 2026-08-02 with the new zero-quota instrument
`apps/worker/scripts/probe-context.ts`, **both refusals were correct** and the
eval was scoring them as failures:

- *"Summarise what needs my attention"* — the eight messages that reached the
  model were newsletters and promotions. **None of the CI failures, deploy
  failures or the Supabase pause was in context at all.** e5 has no
  representation of *importance*; no prompt wording reaches this.
- *"Do I have any upcoming meetings?"* — **every meeting in the corpus was dated
  27–28 July** and three of five had bodies reading only "YURI". The one naming
  a time ("9pm tonight") was sent 19:59 on 2 Aug; the eval ran at 22:40. The
  case's verdict **depended on the wall clock**.
  ✅ **Resolved 2026-08-03** — Yuri sent a mail naming a real future date and the
  assistant now answers it correctly in production, citing the right message. The
  case is back to `answer`, **with a `staleAfter` guard**: it expires again on
  8 August, and the eval says so out loud rather than quietly turning red.

*"Needs my attention"* is a Phase 5 feature asked of Phase 4B (US-9) and remains
`known-gap` — asked and printed every run, not scored. The meetings question is
answerable today only because a dated mail exists; **Phase 5 extraction is what
makes it durable** (US-7, R14). **Tuning to 7/7 would have been fabrication with a passing score**: the
pre-hardening prompt already reached 7/7 answerable at **3/8 refusals**, citing
all eight retrieved messages for a question about a submarine.

What did change: the prompt's decision is **three-way** — "nothing here is about
this" (refuse) versus "several things are, none decisive" (synthesise, citing
each). Verified on a synthesis question retrieval can serve; refusals held.

⚠ **Reach for `probe-context.ts` before `eval-assistant.ts`.** It costs nothing
and it separates "the model judged wrongly" from "the model never saw it" —
opposite fixes, and the answer-level eval cannot tell them apart at any price.
Scores are reported as **two numbers, never one**: a combined figure reads
identically for a prompt that refuses everything and one that answers everything.

**If you are a session picking this up:** Phase 5 is next — extraction,
"needs attention", and calendar write-back (ADR-010, **never auto-create**).
Everything it needs already exists: Groq is wired, `extractions` takes new
kinds, and the OAuth consent already carries `calendar.events`.

⭐ **Phase 5 is also what closes the assistant's two known gaps**, and that is
not a coincidence — ADR-017 traced both of them here. *"Summarise what needs my
attention"* is US-9 reading `extractions`, not a retrieval question; *"do I have
any upcoming meetings?"* is US-7 plus R14, which already settled that meetings
come from **extraction**, not from semantic search. Building Phase 5 is the fix
for both. Do **not** try to fix them in the assistant's prompt — that has been
measured and ruled out.

**389 tests.** `pnpm typecheck`, `pnpm test`, `next build`, the worker bundle and
`assert-rls` (all ten tables) are green.

### Phase 5a shipped 2026-08-03 — the extraction pass (ADR-019)

The worker now pulls **commitments, meetings, action items and questions** out
of every message into `extractions`. Five things a session touching it must know:

- **⚠ It must NEVER fail an event**, the same contract as summaries and
  embeddings, and it runs **last of the three** on purpose: if the shared
  6,000 tokens/minute window runs out mid-batch, the step that should lose is
  the one whose output is read hours later on another screen.
- **⚠ `llama-3.1-8b-instant`, never the 70B.** Re-verified from live headers on
  2026-08-03: 14,400 req/day against the assistant's 1,000.
- **⚠ Idempotency needed migration 0011 — `message_extraction_runs`.**
  `extractions` has no unique key for these kinds (many-per-message by design)
  and a message that legitimately yields **nothing** — most of a real mailbox —
  is indistinguishable from one never processed. Without it every redelivery and
  every backfill re-pays for work already done. **It is an ELEVENTH table, and
  `assert-rls.ts` fails on any table it does not list.** Negative-controlled.
- **⚠ The quote check is the hallucination guard.** Every item carries the
  verbatim sentence it came from, and a row whose quote is not in the body is
  **dropped**. A fabricated meeting has to fabricate a sentence. Whitespace and
  smart quotes are normalised; different *words* are not.
- **⚠ Relative dates resolve against the message's SEND time**, never today.
  Measured correct against the live model: *"Meeting at 9pm tonight"* sent
  2 Aug 19:59 → `2026-08-02T21:00+08:00`. Against the current clock it would be
  a well-formed row on the wrong day, with no error anywhere.

Two measurements worth carrying: one request costs **~3,500 tokens, 3,370 of
them the prompt**, so throughput is ~1.7/minute and **a backfill that spends most
of its time waiting is correct**. And **`max_tokens: 900` was too low** — two
Taglish messages returned 1,798 characters of JSON that stopped mid-structure,
because non-ASCII in quoted strings tokenises at ~2 chars/token, not 4. Now
1,600, which is free: `max_tokens` is a ceiling, not a reservation. It was only
diagnosable because the validator reports *"ended mid-structure"* separately from
*"answered in prose"* — same words, opposite fixes.

### Phase 5b/5c shipped 2026-08-03 — the queue, and the one outward write

**`/attention` (US-9)** reads `extractions` directly — an ordinary RLS-scoped
table query through the user's session, no RPC and no `service_role`.

- **⚠ The ordering IS the feature.** Overdue first (soonest-missed), then
  upcoming (soonest), then undated by newest message. Ordered by *when the
  message arrived*, a meeting starting in an hour sits under six newsletters —
  the same failure ADR-017 measured for the assistant, arriving through the UI.
- **⚠ Confidence is a tiebreak, never a rank and never a filter.** Self-reported,
  not calibrated. Filtering on it would be ADR-016's mistake in a new costume.
- **⚠ Every row shows its verbatim quote**, and `docs/02-ARCHITECTURE.md` §6 is
  **amended** to list this as the third place message content renders.

**Calendar write-back (US-7b)** lives on `/messages/[id]`, above the body.

- **⚠ ADR-010 holds: nothing is created without a form submission.** The worker
  writes proposals and stops.
- **⚠ `calendar_event_id` is checked before every insert — and a DETERMINISTIC
  event id backs it up.** The documented guard has a real gap: the window
  between a successful insert and the write recording it. A crash there leaves
  an event with nothing pointing at it, so the next Confirm sees null and
  creates a **twin**. A client-supplied id (base32hex, from the extraction uuid)
  makes Google answer `409 duplicate`, which is adopted. Rules read from the
  API reference, not assumed.
- **⚠ Attendees are NOT sent.** Adding one makes Google email an invitation
  *from the user* — a far louder assertion than a calendar entry, off the back
  of a model reading somebody's mail.
- **⚠ Times carry an explicit `+08:00`.** Without it Google uses the calendar's
  own timezone, invisible to this code, and every event lands eight hours out.

⚠ **Measuring this console's contrast needs `lab()` handling.** Computed colours
come back as CIE `lab()`; an `rgb()` regex reads L,a,b as R,G,B and reports
~1.2:1 for **everything**. Same shape of false failure as the transitions one.
WCAG luminance is the Y channel and L\*→Y needs no colour-space adaptation.
Measured properly: 46/46 pass AA in both schemes, lowest 6.88 dark / 5.27 light.

**✅ ASSISTANT GROUNDING — DECIDED 2026-08-03. ADR-020 accepted in the NARROW
form, built, and shipped OFF behind `ASSISTANT_GROUND_EXTRACTIONS`.**

Yuri accepted a date-window lookup for questions explicitly about scheduled
time, feeding the model each extraction's **verbatim quote** and parsed date,
cited to the source message — not a general merge. **The flag defaults off and
that is the decision**: ADR-020 requires both numbers re-measured, the daily cap
allows about one full run, and today's 6/6 · 7/7 is the baseline. To close it,
run the full eval with the flag on, on a day the assistant is otherwise unused.

**⚠⚠ EXTRACTION WAS SILENTLY LOSING LIVE MAIL, AND THE FIX IS A NEW LOOP.**
Found by counting, not reading: 84 messages, 78 extraction runs, and four of the
six gaps were ordinary mail from the previous day — summarised and embedded,
never extracted. Extraction runs **last** of the three AI steps, meets an
exhausted 6,000 tokens/minute window, and records nothing by design so the work
stays outstanding. `extractBatch`'s comment says the backfill picks those up.
**Nothing scheduled the backfill.** `raw_events` is marked done, so the message
never returns through the worker.

`apps/worker/src/extract-catchup.ts` sweeps every 15 minutes, 5 messages at a
time, **only when the queue is empty** so it cannot starve live ingest of the
window they share. ⚠ Do not "simplify" it into an inline retry inside
`extractBatch` — that blocks `markDone` and the ingest loop behind it, trading a
lost proposal for delayed mail, which is the trade this phase already decided
the other way.

### Shipped 2026-08-02 (late) — assistant loose ends closed

- **Citations link** to `/messages/[id]`, a new signed-in RLS-scoped route
  rendering one message in full (ADR-018). ⚠ **Not** the timeline jump
  `docs/02-ARCHITECTURE.md` §4 specified — the timeline holds only the newest 50,
  so a chip citing anything older resolves to nothing, which reads as an invented
  source. This route is also the source-message view Phase 5 needs (ADR-010).
- **Search results carry summaries** — migration **0010**. ⚠ Two traps in it, both
  of which fail by *hiding messages* rather than erroring: `create or replace`
  cannot change a `RETURNS TABLE`, so the function is dropped and recreated —
  **and DROP takes the grants with it**; and the `kind` filter must sit in the
  JOIN condition, because a WHERE on the right side of a LEFT join silently makes
  it an inner join. Negative-controlled live: 76 rows, 66 summarised, 10 not,
  second account still 0.
- **The rate-limit message now distinguishes the two caps.** "Try again in a
  moment" was correct for the per-minute window and **wrong for the daily
  allowance**, which is the one that actually binds. ⚠ Groq publishes **no
  tokens-per-day header at all**, and a daily rejection arrives with a *full*
  per-minute budget — so the limit type is read from the 429 body's
  `(RPM|RPD|TPM|TPD)` code. That is a deliberate, bounded exception to §6's
  never-read-the-body rule; nothing from the body is returned, stored or logged.
- **`probe-context.ts`** — see the misdiagnosis note above. Free, and the first
  thing to run when a case fails.

---

*Last updated: 2026-08-02 (late) · Phase 3 search + filters, Phase 4A summaries
and Phase 4B assistant all shipped and deployed; the assistant's loose ends
(citation links, search summaries, rate-limit wording) closed. **Five** docs now
corrected against measurement: Gemini's free tier is 20/day not 250 (ADR-003
amended), the similarity floor cannot carry the refusal (ADR-016), the worker
needs 1 GiB not 0.5 (ADR-011 amended), CI had been red since 2026-07-28 on a
stale lockfile — and the assistant was never over-refusing; the eval was scoring
two correct refusals as failures (ADR-017).*

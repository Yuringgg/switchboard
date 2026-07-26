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

**Phase: 0 — Foundation ✅ COMPLETE (2026-07-26). Phase 1 (Gmail) is next.**

The console is live at <https://switchboard-console-beryl.vercel.app> behind a
login, the worker runs warm on Container Apps, and CI keeps checking that tenant
isolation is intact.

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

**What is not:** anything channel-specific. No Gmail, no WhatsApp, no adapters,
no assistant. The pipeline is wired end to end but nothing flows through it yet —
`messages` has never held a row.

Do not skip ahead. The adapter contract exists now; use it.

**⚠ NEVER RUN `drizzle-kit generate` OR `drizzle-kit migrate`.** Run against the
live database on 2026-07-26, `generate` proposed disabling RLS on all ten tables
and dropping all ten `tenant_isolation` policies — silently dismantling the
security boundary. Migrations are hand-written SQL in `packages/db/migrations/`.
Full reasoning in `packages/db/drizzle.config.ts`. Drizzle-as-ORM is fine and
unaffected. `drizzle-kit pull` is safe.

**Known live blockers:**

1. **The `DATABASE_URL` repo secret is not set on GitHub**, so the
   tenant-isolation CI job fails. That failure is by design — the check refuses
   to skip — but it means CI stays red until the secret is added at
   Settings → Secrets and variables → Actions. Use the same Supavisor
   session-mode URL as `apps/worker/.env`.
2. **Google Cloud does not exist yet.** Phase 1 cannot start without it; see
   `docs/03-RESOURCES.md` §6.

Credentials: **Supabase is fully configured** — `apps/worker/.env` holds
`DATABASE_URL` (Supavisor session mode, port 5432 — the direct connection is
IPv6-only and Container Apps egresses IPv4) and `SUPABASE_SERVICE_ROLE_KEY`.
Google, Meta, Gemini and Groq don't exist yet (`docs/03-RESOURCES.md` §6) —
that's Phase 1 and later.

**Tooling notes:** the **Azure MCP still times out even after `az login`** — use
the `az` CLI directly, at
`C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd` (not on `PATH`).
`gh` is not installed.

**A dev account exists in the database:** `dev@switchboard.test`, seeded by
`packages/db/seeds/dev_user.sql` so the sign-in flow could be tested without
sending confirmation email. **Delete it before the system holds anything real.**

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

**Environment note:** Supabase's free tier caps at 2 active projects and both
were in use. `ageni-academy` was paused on 2026-07-25 to free a slot. Create
Switchboard in **`ap-southeast-1` (Singapore)** — closest to Manila, and region
is immutable after creation. Full state in `docs/03-RESOURCES.md` §9.

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

---

*Last updated: 2026-07-25 · Planning session 1*

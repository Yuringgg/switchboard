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

**Phase: 0 — Foundation, in progress.** The monorepo skeleton exists.

**What is built** (build session 1, 2026-07-26):

- pnpm workspace + TypeScript strict, directory tree per `docs/02-ARCHITECTURE.md` §7
- `packages/core` — the `ChannelAdapter` contract and canonical types, no
  implementations. Tested: `pnpm typecheck` clean, `pnpm test` green.
- `.env.example`, `.gitignore`, CI workflow
- Every not-yet-built directory holds a README naming what lands there and when

**What is not:** everything requiring a credential or a cloud service — Supabase
project and first migration, Auth, RLS, the console app, ingest routes, the
worker container. Those are the remaining Phase 0 items in `docs/04-ROADMAP.md`.

Do not skip ahead to integrations. The adapter contract exists now; use it.

**Known live blockers:**

1. None of the accounts in the credentials checklist (`docs/03-RESOURCES.md` §6)
   exist yet. Phase 0 needs the ★ items.
2. **The Azure MCP is installed but timing out** — likely needs `az login` on the
   host. Blocks the Container Apps work in Phase 0. See `docs/03-RESOURCES.md` §8.
3. **The repo is not under version control yet.** No `git init` has been run, so
   the pre-commit secret scan can't be installed and CI can't fire. `.gitignore`
   is already in place, so initializing is safe whenever Yuri wants it.

**Environment note for builders:** Node 25+ unbundled corepack, so `pnpm` was
installed globally via `npm i -g pnpm` on 2026-07-26. TypeScript resolved to 7.x
and Vitest to 4.x.

**Environment note:** Supabase's free tier caps at 2 active projects and both
were in use. `ageni-academy` was paused on 2026-07-25 to free a slot. Create
Switchboard in **`ap-southeast-1` (Singapore)** — closest to Manila, and region
is immutable after creation. Full state in `docs/03-RESOURCES.md` §9.

**Still unconfirmed with the mentor:** whether "monitoring" means a dedicated
business channel (achievable) or existing personal conversations (only achievable
for email). Q1 in `docs/06-OPEN-QUESTIONS.md`. It doesn't block building — it
blocks writing the demo narrative.

---

## 6. Stack summary (details in `docs/02-ARCHITECTURE.md`)

- **Language:** TypeScript end to end, pnpm workspaces monorepo
- **Console + ingest webhooks:** Next.js 15 App Router + Tailwind + shadcn/ui →
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

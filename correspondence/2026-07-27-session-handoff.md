# Session Handoff — Switchboard

*Paste this into a new session to bring it fully up to date.*

---

## Roles

- **Yuri** — chief. Final say. Does anything requiring a browser login.
- **You (this session)** — supervisor / architect. Own the plan, the docs in
  `docs/`, and technical direction. **Do not write code or provision
  infrastructure** — that's the builder's job.
- **Claude Code** — builder. Implements against the plan in its own session.

## Read first

Project lives at `D:\Claude Code\Switchboard`. **Read `AGENTS.md`, then the seven
docs it points to.** Everything below is state that post-dates them.

---

## What Switchboard is

Gmail and WhatsApp messages sync into one private store, normalized, searchable
in one timeline. An assistant answers questions with citations to source
messages. Detected meetings become Google Calendar events **on user
confirmation only**. Multi-tenant — each user sees only their own data.

OJT project at **iOzera**, proposed and scoped by **Ms. Maria**, who is the
**sole source of requirements**. Any doc attributing a requirement elsewhere is
wrong.

---

## Stack (ADRs 1–12 in `docs/05-DECISIONS.md`)

| Layer | Choice |
|---|---|
| Console + ingest webhooks | Next.js 16, Tailwind, shadcn/ui → Vercel |
| Worker | Node, containerized, always-warm → Azure Container Apps |
| Database | Supabase Postgres, pgvector, Realtime, Auth, RLS |
| Assistant Q&A | Gemini 2.5 Flash |
| Extraction | Groq / Llama |
| Embeddings | Transformers.js, local in-worker, **multilingual** |
| Migrations | **Hand-written SQL** — not Drizzle Kit (ADR-012) |
| ORM | Drizzle (worker) / supabase-js (console) |

---

## Live infrastructure

**Supabase** — project `switchboard`, ref `ytrkpcryztwgflmbhfdu`,
`ap-southeast-1` (Singapore). 10 tables, RLS + force RLS + one policy each.
`ageni-academy` is paused to stay under the 2-project free cap — do not create a
third.

**GitHub** — `github.com/Yuringgg/switchboard`, public. CI green (typecheck +
test, and a tenant-isolation job asserting RLS on every push).

**Vercel** — project `switchboard-console`, production
`https://switchboard-console-beryl.vercel.app`. Root directory `apps/console`.

**Azure** — `rg-switchboard`, region **malaysiawest** (subscription policy blocks
`southeastasia`). `switchboard-worker` running, `minReplicas: 1`, image from
ghcr pinned **by digest**. The Azure MCP times out even after `az login` — use
the `az` CLI directly.

**Google Cloud** — project `switchboard-503613`, number `468794256088`
- Client ID `468794256088-i0k8h4bgsa8shlbr288sa1k6evdh9p36.apps.googleusercontent.com`
- Consent screen External, **Testing** (never publish — CASA assessment),
  `leiruychua@gmail.com` a test user, scopes `gmail.readonly` + `calendar.events`
- Topic `projects/switchboard-503613/topics/gmail-push`, Gmail granted Publisher
- Push subscription `gmail-push-sub` → `/api/webhooks/gmail`, authenticated via
  `gmail-push-invoker@switchboard-503613.iam.gserviceaccount.com`, audience =
  the endpoint URL, exponential backoff 10/600, ack 30s

---

## Status

**Phase 0 — complete.** **Phase 1 (Gmail) — in progress.**

Built: monorepo, adapter contract, schema + RLS + auth, two-tenant isolation
test (verified with a negative control), `packages/db`, ingest webhook routes,
worker live in Azure, keepalive, CI, deployed console behind login, credential
encryption, Gmail push verification and notification parsing, OAuth connect flow.

Not built: `users.watch` registration (`historyId` + `expires_at` in
`sync_state`) and the renewal cron. **Nothing is registered with Gmail yet, so
Gmail is publishing nothing.** That's the next build step.

---

## 🔴 THE LIVE BLOCKER

Clicking **Connect** on `/channels` returned **HTTP 500** from
`/api/auth/google/start`.

**Claude Code's diagnosis, from probing production:**

| Probe | Result | Meaning |
|---|---|---|
| `/api/auth/google/start` (no session) | 307 → `/login` | Route loads; 500 is *after* the session check |
| `/api/webhooks/gmail` | 503 | "Not configured" branch — a Google var is genuinely absent |
| `/signup` | 200 | Deployment is current |
| `/channels` | 307 | Deployment has the newest commit |
| `/api/cron/keepalive` | 401 | `CRON_SECRET` did arrive |

So: not a stale deployment, and not *all* env vars — **specifically the Google
ones**. The only code between the session check and the redirect is
`createOAuthClient()`, which reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI`. One of those three is missing or empty.

**Leading hypothesis:** Vercel binds env vars **when a deployment is created**, so
a variable added afterwards does nothing until the next build. Redeploying with
"Use existing Build Cache" can reuse the prior build's environment. Also worth
checking the vars landed on **`switchboard-console`** and not `ageni-academy` —
the only other project in the account, and exactly the slip that produces this
signature.

**Claude Code shipped a diagnostic:** `GET /api/health/config` — signed-in only,
reports presence and shape but **never values**, so the response is safe to paste
anywhere. It checks: wrong decoded byte count, leading/trailing whitespace,
embedded line breaks, a localhost redirect URI left on production, a push
audience not matching the deployment host, and a swapped client id/secret.
`/start` no longer 500s on bad config — it redirects to `/channels` naming the
missing variable.

**→ NEXT ACTION (Yuri):** once Vercel redeploys, sign in and open
`https://switchboard-console-beryl.vercel.app/api/health/config`, then paste the
JSON to Claude Code. `missing` and `malformed` will name the culprit outright.

---

## Rules that must not be violated

1. **`owner_id` is derived from the channel, never from the provider payload.**
   The worker uses `service_role`, which bypasses RLS — a mistake here leaks one
   tenant's messages into another's console and no policy catches it.
2. **The embedding model must be multilingual.** The corpus is Taglish;
   English-only models fail in a way that looks like a ranking bug.
3. **Never create a calendar event without explicit user confirmation.**
4. **Never run `drizzle-kit generate`** — its differ proposed dropping RLS on all
   ten tables and every constraint. Migrations are hand-written SQL (ADR-012).
5. **Never publish the Google consent screen** — Gmail restricted scopes trigger
   a CASA assessment. Testing mode, allowlisted users.
6. **Calls are out of scope entirely** (ADR-008) — Ms. Maria excluded them, no
   native recording exists, and RA 4200 makes recording a criminal offence in the
   Philippines without all-party consent.
7. **Secrets never go in chat.** Several were leaked and rotated during setup.
   `service_role` and the database password are the ones that matter.

---

## Yuri's outstanding manual items

- Paste the `/api/health/config` JSON to Claude Code (unblocks Phase 1)
- After Gmail connects: nothing until WhatsApp (Phase 2), which needs a Meta
  developer app and free test number

*Written 2026-07-27.*

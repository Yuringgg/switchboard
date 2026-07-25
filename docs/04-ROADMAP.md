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

## Phase 0 — Foundation

**Goal:** an empty but fully deployed system. Nothing works yet; everything is
wired.

- [x] Init monorepo — pnpm workspaces, TypeScript strict, per layout in `docs/02-ARCHITECTURE.md` §7
- [x] `packages/core` — adapter interface and canonical types, no implementations
- [ ] Supabase project; first migration with the full schema; `pgvector` enabled
- [ ] **Supabase Auth + sign-in flow in the console**
- [ ] **`owner_id` on every table + RLS policies + `force row level security`**
- [ ] **Two-tenant isolation test** — same external contact, two users, assert no bleed
- [ ] `packages/db` — typed client, generated types
- [ ] `apps/console` — Next.js + Tailwind + shadcn → **Vercel**, renders "no messages yet"
- [ ] Ingest webhook routes live **inside** the console app (`app/api/webhooks/`) — ADR-011
- [ ] `apps/worker` — containerized hello-world → **Azure Container Apps, `minReplicas: 1`**
- [x] `.env.example` and `.gitignore`
- [ ] Pre-commit secret scan — *blocked: the repo has not been `git init`ed yet*
- [ ] **Supabase keepalive** — scheduled daily query (see `docs/02-ARCHITECTURE.md` §5)
- [x] CI: typecheck + test on push — `.github/workflows/ci.yml` written; *inert until the repo exists and has a remote*

**Done when:** the console is live at a public URL behind a login, the worker
container is running warm, a migration applies cleanly from a fresh checkout, and
the isolation test passes.

> **Auth and RLS belong here, not later.** This is the whole reason ADR-009 was
> decided before any code exists: adding `owner_id` and policies to nine tables
> in Phase 3 is a migration across every query in the system. In Phase 0 it's a
> column and a policy.

> Do the keepalive now too. Five minutes in Phase 0, a dead demo in Phase 5.

---

## Phase 1 — Gmail, end to end

**Goal:** the "it's real" moment. An email arrives and appears on screen.

Gmail goes first because it reads a **genuine existing inbox** with no recipient
caps — it's the channel that actually demonstrates the product thesis, and Yuri
already has the account.

- [ ] Google Cloud project; **Gmail API + Calendar API** both enabled
- [ ] OAuth consent screen in **testing mode**, Yuri allowlisted as a test user
- [ ] Request Gmail **and** `calendar.events` scopes in the same consent — one
      flow now saves a second consent screen in Phase 5
- [ ] OAuth flow in the console; refresh token **encrypted** into `channels`,
      scoped to the signed-in user
- [ ] Pub/Sub topic + push subscription; grant publish rights to `gmail-api-push@system.gserviceaccount.com`
- [ ] `users.watch` registration; store `historyId` and `expires_at` in `sync_state`
- [ ] **Watch renewal cron** — daily, renews at T-2 days, alerts on failure
- [ ] `packages/adapters/gmail` — `poll` via `history.list`, `normalize` (MIME, threads, HTML→text)
- [ ] Record real payloads into `fixtures/gmail/`; unit-test `normalize` against them
- [ ] Ingest endpoint: verify Pub/Sub OIDC token → insert `raw_events` → 200. Nothing else.
- [ ] Worker loop: claim with `FOR UPDATE SKIP LOCKED` → normalize → upsert `messages`
- [ ] Contact identity resolution: create `contact_identities`, auto-create `contacts`
- [ ] Attachments → Azure Blob; rows in `attachments`
- [ ] Console: bare timeline reading from `messages`
- [ ] Idempotency test: replay the same notification 3×, assert exactly one row

**Done when:** you send yourself an email and it appears in the deployed console.
**This is the milestone worth screenshotting for Ms. Maria.**

> Be aware this phase has no early visible payoff — OAuth, Pub/Sub, and watch
> registration all have to work before a single message renders. That's the cost
> of dropping Telegram. Push through it; everything after is faster.

---

## Phase 2 — WhatsApp

**Goal:** prove the adapter abstraction holds against a structurally different
channel. Gmail is hybrid push/pull with a cursor; WhatsApp is pure push. If the
interface survives both, it will survive a third.

- [ ] Meta developer account, app created, WhatsApp product added
- [ ] Free **test business number**; verify up to 5 recipient numbers
- [ ] WhatsApp channels are **admin-provisioned**, not self-serve — a number is
      registered to the WABA, then assigned an `owner_id`. Unlike Gmail, a user
      cannot connect their own. A WABA holds 2 numbers, up to 20 once verified.
- [ ] Webhook registered; verify token handshake working
- [ ] **`X-Hub-Signature-256` HMAC verification** over the *raw* body, timing-safe compare
- [ ] `packages/adapters/whatsapp` — `parseWebhook`, `verifyWebhook`, `normalize`
- [ ] Media/attachment download → Azure Blob
- [ ] Fixtures + tests, same as Gmail
- [ ] **Refactor checkpoint:** anything both adapters duplicate moves into `core`

**Done when:** a WhatsApp message and an email sit in the same timeline, visually
distinguished by channel.

> The refactor checkpoint is the actual point of this phase. Don't skip it — it's
> where you find out whether the abstraction was real or wishful.

---

## Phase 3 — The console

**Goal:** the part people actually look at. Ms. Maria pointed at UI as somewhere
to invest, and it's what makes the system feel finished.

- [ ] Timeline: virtualized, infinite scroll, channel badges, grouped by day
- [ ] **Supabase Realtime** — new messages appear without a refresh
- [ ] Keyword search — Postgres full-text over `body_text`
- [ ] Filters: channel, contact, date range
- [ ] Contact list; contact detail = merged cross-channel history
- [ ] **Manual identity merge** — "this email address and this number are the same person"
- [ ] Channel settings: connect, pause, disconnect, sync status, last error
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
| **Scope grew: multi-tenancy + calendar write** | — | — | Both landed in planning rather than mid-build, which is the cheap time for them. Held in check by the team-features non-goal — *isolated, not collaborative*. |

---

*Last updated: 2026-07-25 · Planning session 1*

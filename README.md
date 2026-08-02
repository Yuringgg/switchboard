# Switchboard

**One console for every conversation.**

Switchboard ingests your Gmail and WhatsApp messages into a single private store,
then lets you search across both and ask an assistant questions about your own
communication history — *"do I have upcoming meetings?"*, *"what did I commit to
this week?"* — with every answer cited back to the message it came from. When it
spots a meeting in a message, it offers to put it on your calendar. It never does
so without asking.

Multi-tenant: each person connects their own channels and sees only their own
data.

The name is the design: many lines in, one operator's view out.

---

## Status

✅ **Phase 0 — Foundation.** Deployed, behind a login, RLS forced on all ten
tables with a CI job that keeps checking it.

✅ **Phase 1 — Gmail, end to end.** An email arriving in Gmail appears in the
deployed console within seconds, with no refresh. Watch registered and
auto-renewing, webhook verifying and queueing, worker normalizing, timeline
live over Supabase Realtime.

🟡 **Phase 2 — WhatsApp.** Adapter, ingest, worker and migration are written,
typechecked and tested. Waiting on a Meta developer account and a free test
number — see [`docs/03-RESOURCES.md`](./docs/03-RESOURCES.md) §6.

🟡 **Phase 3 — the console.** Cross-channel search with filters, highlighting and
per-result AI summaries, plus a message detail route. Remaining: contacts,
identity merge, attachments, virtualization.

✅ **Phase 4A — per-message summaries.** Every message over 280 characters
carries a one-glance AI summary, written on ingest and shown in the opened row
and in search results. Ms. Maria asked for this in the founding message.

✅ **Phase 4B — the assistant.** Ask a question in plain language, get an answer
where **every claim cites the message it came from**, and each citation is a link
to that message. An answer that cites nothing renders as a refusal — that is a
success criterion, not a UI detail.

⬜ **Phase 5** — extraction, a "needs attention" view, and Google Calendar
write-back. **This is the next thing to build.**

The full plan lives in [`docs/`](./docs). Start with [`AGENTS.md`](./AGENTS.md).

---

## Why it exists

Client communication scatters across four apps. Nothing is searchable in one
place, commitments made in passing get buried, and the same person is a phone
number in one app and an email address in another with nothing linking them.
Switchboard is the layer that puts it back together.

Built during an OJT at **iOzera**, where it doubles as a proposed internal tool.
Proposed and scoped by **Ms. Maria**, the industry mentor.

---

## Architecture at a glance

```
channels → ingest (verify, queue, ack fast) → worker (normalize, embed, extract)
         → Postgres + pgvector → console (timeline, search, assistant)
```

| Layer | Technology | Host |
|---|---|---|
| Console + ingest webhooks | Next.js 16 · Tailwind · shadcn/ui | Vercel |
| Worker | Node · TypeScript, containerized, always warm | Azure Container Apps |
| Database | Postgres · pgvector · Realtime · Auth · RLS | Supabase |
| Attachments | Blob storage | Azure |
| Assistant Q&A | **Groq `llama-3.3-70b-versatile`** — ⚠ not Gemini | — |
| Summaries · extraction | **Groq `llama-3.1-8b-instant`** — a different model on purpose | — |
| Embeddings | Transformers.js, local in-worker, multilingual | — |
| Calendar | Google Calendar (write, confirmed only) | — |

⚠ **The assistant does not run on Gemini**, though several older notes say so.
Gemini 2.5 Flash's free tier was measured at **20 requests per day** on
2026-08-02 — one eval run needs 15. The two Groq models are deliberately
different so heavy assistant use can never stop mail being summarised, since
Groq's limits are per-model. `ASSISTANT_PROVIDER=gemini` reverts it in one
variable. See ADR-003's amendment.

Every channel implements one `ChannelAdapter` interface, which is what makes
adding a new platform a single file rather than a refactor.

Full detail: [`docs/02-ARCHITECTURE.md`](./docs/02-ARCHITECTURE.md).

---

## Documentation

| Doc | Contents |
|---|---|
| [`AGENTS.md`](./AGENTS.md) | Entrypoint for AI sessions — read first |
| [`docs/00-CONTEXT.md`](./docs/00-CONTEXT.md) | Origin, stakeholders, constraints |
| [`docs/01-PRODUCT-SPEC.md`](./docs/01-PRODUCT-SPEC.md) | Scope, user stories, non-goals |
| [`docs/02-ARCHITECTURE.md`](./docs/02-ARCHITECTURE.md) | System design, data model, security |
| [`docs/03-RESOURCES.md`](./docs/03-RESOURCES.md) | APIs, verified quotas and costs |
| [`docs/04-ROADMAP.md`](./docs/04-ROADMAP.md) | Phased build plan, risk register |
| [`docs/05-DECISIONS.md`](./docs/05-DECISIONS.md) | ADR log |
| [`docs/06-OPEN-QUESTIONS.md`](./docs/06-OPEN-QUESTIONS.md) | Live blockers |
| [`correspondence/`](./correspondence) | Session handoffs — what was built, what broke, what is left |

---

## Setup

Node 22+ and pnpm. Nothing here needs a credential yet.

```bash
pnpm install && pnpm dev
```

The console comes up on <http://localhost:3100>, empty. `pnpm check` runs
typecheck and tests. `pnpm install` also installs the pre-commit secret scan.

Copy `.env.example` to `.env.local` when you start connecting services — the
credentials checklist is [`docs/03-RESOURCES.md`](./docs/03-RESOURCES.md) §6.

Full setup instructions land in Phase 5, written against a verified clean clone.

---

## A note on data

Switchboard reads private communications. Credentials are encrypted at rest,
webhooks are signature-verified, row-level security is on from the first
migration, and message bodies are never logged.

Real client data does not enter the system until the consent question in
[`docs/06-OPEN-QUESTIONS.md`](./docs/06-OPEN-QUESTIONS.md) (Q2) is resolved.
Development runs on the developer's own accounts.

# 02 — Architecture

*System design, data model, and the contracts that hold it together.*

---

## 1. Shape of the system

```
              ┌───────────┐   ┌───────────┐
              │   Gmail   │   │ WhatsApp  │  ← the two channels (ADR-001)
              └─────┬─────┘   └─────┬─────┘
                    │ Pub/Sub       │ webhook
                    │ + poll        │
                    ▼               ▼
   ╔═══════════════════════════════════════════╗
   ║       INGEST  (Next.js API routes)        ║   Vercel — serverless
   ║  · verifies signatures                    ║   no cold-start risk
   ║  · writes RawEvent, returns 200           ║
   ║  · DOES NOTHING ELSE                      ║
   ╚════════════════════┬══════════════════════╝
                        │ raw_events table = queue
                        ▼
   ╔═══════════════════════════════════════════╗
   ║          WORKER  (Node)                   ║   Azure Container Apps
   ║  · normalize → canonical Message          ║   minReplicas: 1 — stays
   ║  · resolve/merge contact identity         ║   warm, holds ONNX model
   ║  · embed for semantic search              ║   weights in memory
   ║  · LLM extraction (commitments, meetings) ║
   ╚════════════════════┬══════════════════════╝
                        ▼
   ┌───────────────────────────────────────────┐
   │   Supabase Postgres + pgvector            │   messages, contacts,
   │   Supabase Realtime  ─────────────────┐   │   extractions, sync_state
   └───────────────────────────────────────┼───┘
                        ▲                  │ live push
                        │ queries          ▼
   ╔═══════════════════════════════════════════╗
   ║          CONSOLE  (Next.js)               ║   Vercel
   ║  timeline · search · contacts · assistant ║
   ╚═══════════════════════════════════════════╝

   Attachments ──► Azure Blob Storage
   Assistant   ──► Gemini 2.5 Flash  (long RAG prompts — 250K TPM, 1M ctx)
   Extraction  ──► Groq / Llama      (many small prompts — 14.4K req/day)
   Embeddings  ──► local, in-worker  (free, unlimited, cannot fail)
   Calendar    ◄── Google Calendar   (WRITE — user-confirmed only, ADR-010)

   Every row is owned by a user. RLS enforces isolation (ADR-009).
```

**Why the split:** ingest must answer webhooks in milliseconds or providers retry
and eventually **disable the webhook**. So it does the absolute minimum — verify,
persist, acknowledge — and all slow work happens asynchronously in the worker.
This is the single most important structural decision in the system.

**Why each lives where it does (ADR-011):** ingest is a burst of tiny requests
that must never be slow to respond, which is exactly what serverless is good at —
so it rides along in the Next.js app on Vercel. The worker holds embedding model
weights in memory and grinds a queue, which is exactly what a warm container is
good at. Running either on the other's infrastructure causes real problems:
serverless can't hold a model, and a cold-starting container drops webhooks.

---

## 2. The adapter contract

**This is the heart of the design.** Every channel implements the same
interface, so adding WhatsApp later is writing one file, not touching the
pipeline.

```ts
// packages/core/src/adapter.ts

export type ChannelType = 'gmail' | 'whatsapp';

export interface RawEvent {
  channelType: ChannelType;
  channelId: string;
  externalId: string;        // provider's message id — used for idempotency
  receivedAt: Date;
  payload: unknown;          // untouched provider payload, stored as jsonb
}

export interface CanonicalMessage {
  externalId: string;
  externalThreadId: string;
  direction: 'inbound' | 'outbound';
  sender: ContactIdentityRef;   // { channelType, externalId, displayName? }
  recipients: ContactIdentityRef[];
  subject?: string;             // email has one, chat doesn't
  bodyText: string;             // plain text, always populated
  bodyHtml?: string;
  attachments: AttachmentRef[];
  sentAt: Date;
}

export interface ChannelAdapter {
  readonly type: ChannelType;

  /** Push channels: validate the provider's signature. Reject if invalid. */
  verifyWebhook?(headers: Headers, rawBody: string): boolean;

  /** Push channels: provider payload → zero or more raw events. */
  parseWebhook?(payload: unknown): RawEvent[];

  /** Pull channels: fetch since cursor. Returns events + the next cursor. */
  poll?(cursor: string | null): Promise<{ events: RawEvent[]; nextCursor: string }>;

  /** All channels: raw event → canonical form. Pure function, unit-testable. */
  normalize(event: RawEvent): CanonicalMessage;

  /** Optional, stretch goal (US-12). */
  send?(to: ContactIdentityRef, body: string): Promise<void>;
}
```

**Rules for adapter authors:**

- `normalize` must be a **pure function** with no I/O. This is what makes
  channels testable from recorded fixture payloads instead of live accounts.
- Always store the raw payload. When a channel does something unexpected, the
  raw payload is the only way to find out what.
- `externalId` must be **stable and unique per channel**. It is the idempotency
  key — providers *will* redeliver webhooks and we must not double-insert.

**Channel taxonomy:**

| Channel | Mechanism | Notes |
|---|---|---|
| Gmail | Pub/Sub watch (push) + `history.list` (pull) | Hybrid: push says *something changed*, then you pull the delta. Watch expires — see §5. Built first. |
| WhatsApp | webhook (push) | `X-Hub-Signature-256` HMAC verification. Free test number, capped at 5 recipients. Built second. |

The two channels are deliberately *structurally different* — one hybrid
push/pull with a cursor, one pure push. If the adapter interface survives both,
it will survive a third. That's the real reason Gmail and WhatsApp are a better
pair than two chat platforms would have been.

---

## 3. Data model

Postgres, via Supabase. `pgvector` extension for embeddings.

**This system is multi-tenant (ADR-009).** `owner_id` appears on every table and
**RLS is the security boundary, not a safety net.** Every table denies by default
and permits only `owner_id = auth.uid()`. Denormalizing `owner_id` down the tree
rather than joining up to `channels` is deliberate — RLS policies run on every
row of every query, and a join in a policy is a performance trap.

```sql
-- Identity comes from Supabase Auth (auth.users). No custom users table.

-- Connected accounts. owner_id is the tenant key everything else inherits.
channels (
  id            uuid pk,
  owner_id      uuid not null references auth.users(id),
  type          text not null,           -- 'gmail' | 'whatsapp'
  display_name  text not null,
  credentials   bytea not null,          -- ENCRYPTED. never plaintext. see §6
  status        text not null default 'active',   -- active|paused|error
  last_error    text,
  created_at    timestamptz default now()
)

-- One row per real human. Per-tenant: my contacts are not your contacts.
contacts (
  id            uuid pk,
  owner_id      uuid not null references auth.users(id),
  display_name  text not null,
  notes         text,
  created_at    timestamptz default now()
)

-- That human's handle on a given channel. This is what makes merging work.
contact_identities (
  id            uuid pk,
  owner_id      uuid not null references auth.users(id),
  contact_id    uuid references contacts(id),
  channel_type  text not null,
  external_id   text not null,           -- email address / phone number
  display_name  text,
  -- owner_id MUST be in this key: two tenants can both know the same number.
  unique (owner_id, channel_type, external_id)
)

conversations (
  id                 uuid pk,
  owner_id           uuid not null references auth.users(id),
  channel_id         uuid references channels(id),
  external_thread_id text not null,
  subject            text,
  last_message_at    timestamptz,
  unique (channel_id, external_thread_id)
)

messages (
  id              uuid pk,
  owner_id        uuid not null references auth.users(id),
  conversation_id uuid references conversations(id),
  channel_id      uuid references channels(id),
  external_id     text not null,
  direction       text not null,
  sender_identity uuid references contact_identities(id),
  subject         text,
  body_text       text not null,
  body_html       text,
  payload_raw     jsonb not null,
  sent_at         timestamptz not null,
  ingested_at     timestamptz default now(),
  unique (channel_id, external_id)       -- ← idempotency guard
)

-- Embeddings live here, not on messages, because long emails chunk into several.
message_chunks (
  id          uuid pk,
  owner_id    uuid not null references auth.users(id),
  message_id  uuid references messages(id) on delete cascade,
  chunk_index int not null,
  content     text not null,             -- the chunk that was embedded
  embedding   vector(384),               -- multilingual-e5-small
  unique (message_id, chunk_index)
)

attachments (
  id          uuid pk,
  owner_id    uuid not null references auth.users(id),
  message_id  uuid references messages(id),
  blob_url    text not null,             -- Azure Blob
  filename    text,
  mime_type   text,
  size_bytes  bigint
)

-- LLM-derived structure. Kept separate so it can be recomputed or discarded.
extractions (
  id                uuid pk,
  owner_id          uuid not null references auth.users(id),
  message_id        uuid references messages(id),
  kind              text not null,       -- commitment|meeting|action_item|question
  payload           jsonb not null,      -- { title, starts_at, participants, ... }
  confidence        real,
  model             text not null,       -- which model produced it
  -- Calendar write-back (ADR-010). Null until the user confirms a proposal.
  calendar_event_id text,                -- ← idempotency guard: never double-create
  confirmed_at      timestamptz,
  created_at        timestamptz default now()
)

-- Ingestion queue + cursor tracking
raw_events (
  id            uuid pk,
  owner_id      uuid not null references auth.users(id),
  channel_id    uuid references channels(id),
  external_id   text,
  payload       jsonb not null,
  status        text default 'pending',  -- pending|processing|done|failed
  attempts      int default 0,
  last_error    text,
  received_at   timestamptz default now()
)

-- Worker-only table (never read by the console), but carries owner_id anyway so
-- every table follows the same RLS shape and none is a special case.
sync_state (
  channel_id  uuid pk references channels(id),
  owner_id    uuid not null references auth.users(id),
  cursor      text,                      -- gmail historyId
  expires_at  timestamptz,               -- gmail watch expiry — see §5
  updated_at  timestamptz default now()
)
```

**RLS — the same shape on every table:**

```sql
alter table messages enable row level security;
alter table messages force row level security;   -- applies to table owner too

create policy tenant_isolation on messages
  for all
  using      (owner_id = auth.uid())   -- what you can read
  with check (owner_id = auth.uid());  -- what you can write

create index on messages (owner_id, sent_at desc);  -- policies hit this constantly
```

⚠ **The `service_role` key bypasses RLS entirely.** The worker uses it, so the
worker is the one place where cross-tenant leakage is possible: if it sets
`owner_id` wrong, one user's messages land in another's console and no policy
will stop it. Derive `owner_id` from the channel being processed, never from
anything in the provider payload, and **write a test that asserts isolation
holds** — two tenants, same external contact, no bleed.

**Three design notes worth understanding before you change anything here:**

*Why `extractions` is a separate table and not columns on `messages`:* LLM output
is not ground truth. Keeping it separate means we can re-run extraction with a
better prompt, or delete it entirely, without touching the message record. The
messages table is the source of truth; extractions are a derived cache. See
`docs/05-DECISIONS.md` ADR-006.

*Why `raw_events` is a table and not a real queue:* because Supabase Postgres is
already there and a real queue (Service Bus, Redis) is one more thing to
provision, pay for, and explain. `SELECT ... FOR UPDATE SKIP LOCKED` gives us
safe concurrent consumption from a table. If throughput ever justifies a real
broker, the worker interface won't change. See `docs/05-DECISIONS.md` ADR-005.

*Why `owner_id` is denormalized onto every table instead of joined from
`channels`:* RLS policies execute on every row of every query. A policy
containing a join is evaluated constantly and gets expensive fast. Carrying a
redundant `owner_id` trades a little normalization for policies that are a single
indexed equality check. This is the standard Supabase pattern, and the redundancy
is safe because `owner_id` never changes after insert.

---

## 4. The assistant pipeline

When a user asks a question:

1. **Embed the question** with the same local model used for message chunks.
2. **Retrieve** — pgvector cosine similarity over `message_chunks.embedding`,
   top ~20, filtered by any channel/contact/date constraints set in the UI, then
   resolved back to their parent messages and de-duplicated.
3. **Re-rank / filter** — drop anything below a similarity floor. If nothing
   survives, **stop here and return "I don't have anything about that."**
4. **Build context** — the surviving messages, each tagged with channel, sender,
   and timestamp, so the model can reason about recency and source.
5. **Generate** — LLM answers *strictly from the provided context*, and must
   emit message IDs for every claim.
6. **Render** — the console shows the answer with each citation as a clickable
   chip that jumps to the message in the timeline.

**Step 3 is not optional.** The success criteria in `docs/01-PRODUCT-SPEC.md` §7
require refusal over guessing. A monitoring tool that invents a meeting is
actively harmful. See `docs/05-DECISIONS.md` ADR-007.

**Chunking.** Local embedding models cap around 256–512 tokens. Chat messages fit
whole; **emails routinely don't.** Long bodies are split into overlapping chunks,
each embedded and stored in `message_chunks`, each linking back to its parent
message. Retrieval matches chunks but always surfaces and cites the *message*.

**Two provider interfaces, not one** — because generation and embedding have
genuinely different characteristics:

```ts
export interface CompletionProvider {
  complete(system: string, user: string, opts?): Promise<string>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}
```

- **Generation** → Groq, running Llama. Remote, rate-limited, occasionally down.
- **Embedding** → local Transformers.js in the worker. Free, unlimited, offline.

Splitting them isolates failure. Embedding is the high-volume path — every
message, every re-index — and keeping it local means it **cannot be exhausted or
fail mid-demo.** If Groq degrades, search still works; only the assistant's
answers are affected. Under a single combined provider, one outage takes out
both.

**⚠ Use a multilingual embedding model.** The corpus will be Taglish, and
English-only defaults like `all-MiniLM-L6-v2` degrade badly on code-switched
text. See `docs/03-RESOURCES.md` §4b and ADR-003.

---

## 4b. Calendar write-back

The only place Switchboard writes to the outside world. Treated with more care
than everything else because of that (ADR-010).

```
message ──► worker extracts a candidate meeting
        ──► extractions row  (kind='meeting', calendar_event_id = null)
        ──► surfaces in console as a PROPOSAL, with source message shown
        ──► user reviews: title, time, participants — all editable
        ──► user confirms ──► Google Calendar events.insert
        ──► store returned event id + confirmed_at on the extraction row
```

**Rules:**

- **Never auto-create.** An LLM reading *"maybe we should meet sometime"* as a
  Thursday 3pm commitment, and silently putting it on someone's real calendar, is
  a single-incident trust killer. Propose, don't assert — the same principle as
  ADR-007.
- **`calendar_event_id` is the idempotency guard.** Re-running extraction over a
  message must never create a second event. Check it before every insert.
- **Always show the source message** next to the proposal. The user needs to see
  what the model read before agreeing with it.
- **Scope:** `https://www.googleapis.com/auth/calendar.events`, requested in the
  same consent screen as Gmail. One OAuth flow, one Google Cloud project.
- **Failure is recoverable.** If `events.insert` fails, the extraction row stays
  unconfirmed and the proposal stays in the UI. Never mark confirmed optimistically.

---

## 5. Known operational traps

Every one of these has bitten someone. They are in the plan so they don't bite us.

| Trap | Consequence | Mitigation |
|---|---|---|
| **Supabase free projects pause after 7 days of no DB activity** | Project offline; demo dies | Scheduled keepalive query every ~24h. Add in Phase 0, not the night before the demo. |
| **Gmail `watch` expires and must be renewed at least every 7 days** | Email ingestion silently stops | Store `expires_at` in `sync_state`; daily cron renews at T-2 days. Alert on failure. |
| **Webhook redelivery** | Duplicate messages | `unique (channel_id, external_id)` on `messages` + upsert. Never plain insert. |
| **Slow webhook response** | Provider retries, then disables the webhook | Ingest service does nothing but verify + insert + 200. All real work is in the worker. |
| **Groq free-tier quota exhaustion** | Assistant returns errors mid-demo | Limits are per-model — run extraction on a small model, assistant on the 70B, so they don't compete. Embeddings are local and unaffected, so search keeps working. |
| **English-only embedding model on Taglish text** | Semantic search quietly returns poor results, and it looks like a ranking bug | Use a multilingual model from the start (ADR-003). Very hard to notice late; trivial to get right early. |
| **Long emails exceed the embedding token window** | Silently truncated, so the tail of every long email is unsearchable | Chunk into `message_chunks` with overlap. Build this in Phase 4, not as a fix afterwards. |
| **Worker sets `owner_id` wrong** | **One tenant's messages appear in another's console.** RLS can't help — `service_role` bypasses it | Derive `owner_id` from the channel being processed, never from the provider payload. Write an explicit two-tenant isolation test. |
| **Google OAuth app pushed to production with Gmail restricted scopes** | Triggers a CASA security assessment — expensive, weeks long | Stay in **testing mode** with manually allowlisted users (~100 cap). Ample for iOzera. Verify the exact cap before relying on it. |
| **Duplicate calendar events from re-run extraction** | Same meeting created repeatedly on a real calendar | `calendar_event_id` on the extraction row, checked before every insert. |
| **Azure Speech F0 tier unavailable in some regions / on student subs** | Voice stretch goal blocked | It's a stretch goal. Try Central US or West US 2; if `RequestDisallowedByAzure`, drop it. Don't spend a week fighting this. |

---

## 6. Security

This system reads private communications. It is not a toy in this respect.

**Credentials at rest.** Channel tokens are encrypted before they touch the
database — AES-256-GCM with a key from environment config, never a key committed
to the repo. `channels.credentials` is `bytea`, not `text`, to make it obvious
that plaintext is wrong.

**Webhook authenticity.** Every push endpoint verifies before it trusts. WhatsApp
signs with `X-Hub-Signature-256` HMAC over the raw body — compare with a
timing-safe equality check, and verify against the *raw* bytes, not a re-serialized
object. Gmail's Pub/Sub push is authenticated via the OIDC token Google attaches
to the request. An unverified webhook body is attacker-controlled input: reject
with 401, log the rejection, do not parse.

**Database access.** Supabase Row Level Security **on**, from the first
migration. The `service_role` key lives only in the worker's server-side
environment — it bypasses RLS and must never reach the browser. The console uses
the anon key plus a session.

**Secrets hygiene.** `.env` is gitignored from commit one. A pre-commit secret
scan is part of Phase 0. If a token ever lands in git history, rotate it — don't
just delete the line.

**Logging.** Never log message bodies or credentials. Log message *IDs*. When
debugging needs content, read it from the database directly.

**Data handling and consent.** iOzera is a Philippine company, so client
communications fall under the **Data Privacy Act of 2012 (RA 10173)**. Before any
real client data enters the system, there needs to be an explicit conversation
with Ms. Maria about consent, retention, and who may access it. Until then:
**dogfood on Yuri's own Gmail and a WhatsApp test number only.** This is tracked in
`docs/06-OPEN-QUESTIONS.md` and it is a genuine gate, not a formality.

---

## 7. Repository layout

```
switchboard/
├── AGENTS.md
├── docs/                      ← you are here
├── apps/
│   ├── console/               Next.js — UI + ingest webhooks (→ Vercel)
│   │   └── app/api/webhooks/  thin: verify · insert · 200. nothing more.
│   └── worker/                normalize · embed · extract (→ Container Apps)
├── packages/
│   ├── core/                  adapter interface, canonical types, shared logic
│   ├── adapters/
│   │   ├── gmail/             built first
│   │   └── whatsapp/          built second
│   ├── ai/                    Gemini (assistant) · Groq (extraction) · local (embeddings)
│   └── db/                    schema, migrations, typed clients
├── infra/                     Bicep / container definitions
└── fixtures/                  recorded provider payloads for adapter tests
```

`fixtures/` deserves a note: recorded real payloads from each provider, checked
into the repo (scrubbed of personal data). They let every adapter's `normalize`
be tested without network access or live accounts, which is what keeps the test
suite fast and keeps development unblocked when an API is down.

---

## 8. Chosen libraries

Named explicitly so the builder doesn't have to guess or relitigate. Deviate only
with a reason.

| Concern | Choice | Why this one |
|---|---|---|
| Package manager | **pnpm** workspaces | Fast, strict, the standard for TS monorepos |
| Language | **TypeScript 5.x** — pinned, see below | 7.x breaks the toolchain |
| Framework | **Next.js 16**, App Router | Console and ingest webhooks in one deployable |
| Styling | **Tailwind + shadcn/ui** | Fastest route to a UI that looks deliberate |
| DB — console | **supabase-js** (anon key + user session) | Goes through RLS. The user's own permissions apply. |
| DB — worker | **Drizzle** (service_role) | Typed SQL, good `SKIP LOCKED` and pgvector support. Lighter than Prisma and less awkward with RLS. |
| Migrations | ⚠ **hand-written SQL** — see below | Drizzle Kit turned out to be unsafe here |
| Validation | **Zod** | Every webhook payload is untrusted input — parse, don't cast |
| Testing | **Vitest** | Fast, native TS/ESM, works across the monorepo |
| Email parsing | **mailparser** | Mature; MIME is not worth writing yourself |
| Embeddings | **@huggingface/transformers** (Transformers.js) | ONNX runtime, pure Node, no Python |
| Assistant LLM | **@google/genai** → Gemini 2.5 Flash | ADR-003 |
| Extraction LLM | **groq-sdk** → Llama | ADR-003 |
| Dates | **date-fns** + **date-fns-tz** | PH is UTC+8 with no DST — store UTC, render Asia/Manila |
| Blob storage | **@azure/storage-blob** | Official SDK |
| Infra as code | **Bicep** | Native Azure, less ceremony than Terraform here |

**⚠ PROPOSED AMENDMENT — needs Yuri's decision: drop Drizzle Kit for migrations.**

This section originally specified Drizzle Kit. Running `drizzle-kit generate`
against the live database on 2026-07-26 produced a migration that would have
**disabled row level security on all ten tables, dropped all ten
`tenant_isolation` policies**, and dropped every unique, check and foreign-key
constraint — including the `(channel_id, external_id)` idempotency guard.

It is not a Drizzle bug. `packages/db/src/schema.ts` does not model RLS,
policies or check constraints, so the differ correctly concluded the database
had drifted and proposed removing everything the schema does not declare.

Making the schema faithful is possible — `.enableRLS()`, `pgPolicy()`,
`check()`, explicit constraint names, and an `auth.users` definition for the
`owner_id` foreign keys — but every expression must match the database
*textually* or the differ keeps emitting diffs. A small plausible-looking diff
is more dangerous than an obviously wrong one, because someone might apply it.

**Current state:** migrations are hand-written SQL in `packages/db/migrations/`,
applied through Supabase and reviewed as SQL. Drizzle remains the ORM for typed
queries, which is unaffected and is where its value is here. `drizzle.config.ts`
points `out` at a gitignored scratch directory so a stray `generate` cannot drop
a destructive file into the folder someone later runs.

**Two other deviations from the original plan, both found by building it (2026-07-26):**

*Next.js 16, not 15.* 16 was current when the console was scaffolded. The ADR-011
rationale — console and ingest webhooks in one deployable, App Router — is
unchanged by the major version, so this is a version bump rather than a decision
being revisited.

*TypeScript is pinned to `^5`, and this pin is load-bearing.* TypeScript 7 is the
native Go port, and it ships a **different package**: its `exports` map points
`"."` at a version stub, with the real compiler API moved to `./unstable/*`. Any
tool that consumes the classic TypeScript JS API — including `next build`'s type
check — fails against it, with an unhelpful error (`The "id" argument must be of
type string`). `tsc --noEmit` works fine either way, so **the workspace can
typecheck green and still fail to build.** Do not unpin this until the ecosystem
catches up.

**Two notes that matter more than they look:**

*The supabase-js / Drizzle split is a security boundary, not a preference.* The
console uses the anon key so **RLS applies** and a user can only ever reach their
own rows. The worker uses `service_role`, which **bypasses RLS entirely** — so it
must set `owner_id` correctly itself. Using the service key in the console would
silently disable every tenant-isolation policy in the system.

*Extraction output must be validated, not trusted.* LLMs return malformed JSON.
Define the extraction shape as a Zod schema, request structured/JSON output from
the model, and parse the response through the schema. A parse failure is a failed
job to retry, not a row to insert.

---

*Last updated: 2026-07-26 · §8 amended during build session 2*

# 05 — Decision Log (ADRs)

*What we chose, what we rejected, and why. Read before "improving" any of it.*

If you disagree with a decision here, that's legitimate — but raise it with Yuri
and amend this file. Don't silently build it differently.

---

## ADR-001 — Channels: Gmail and WhatsApp only

**Status:** Accepted · 2026-07-25 · *Supersedes the original Telegram-first version*

**Context.** Ms. Maria named WhatsApp (Meta Cloud API) and email (IMAP) as the
channels. An earlier version of this ADR added **Telegram** as a de-risking
channel — a token from `@BotFather` takes five minutes and needs no approvals, so
it was the fastest route to a visibly working pipeline while WhatsApp access was
uncertain.

Two things then changed. Meta turns out to provide a **free test business
number** that messages up to 5 verified recipients with no business verification,
so WhatsApp is buildable immediately and the de-risking rationale evaporated. And
Yuri cut Telegram and confirmed the priority as **WhatsApp and email**.

**Decision.** Two channels: **Gmail** and **WhatsApp**. Telegram is out.
Messenger, Viber, Slack, and Discord are not in scope unless iOzera says
otherwise.

**Build order: Gmail first, WhatsApp second.** Gmail reads a genuine existing
inbox with no recipient cap, so it's the channel that actually demonstrates the
product thesis, and Yuri already has the account. WhatsApp's test number is
capped at 5 recipients and can't carry real traffic, making it the better *second*
channel — the one that proves the adapter abstraction generalizes.

**Why not keep Telegram as a third.** It costs little, but it isn't where
iOzera's client communication happens, so it adds demo surface without adding
credibility. Two well-built channels beat three where one is filler.

**Consequences.** Phase 1 is a bigger lift than it was — Gmail needs OAuth, a
Pub/Sub topic, and watch renewal before anything appears on screen. There's no
same-day "hello world" moment. Accepted deliberately: the payoff is that the
first channel is a real one.

**Rejected:** Facebook Messenger — a reasonable candidate given its dominance in
the Philippines, and it shares Meta's app infrastructure with WhatsApp. Dropped
only because Yuri's stated priority is WhatsApp and email. **Revisit if Ms. Maria
says clients use Messenger heavily** — it would be cheap to add alongside
WhatsApp.

---

## ADR-002 — TypeScript end to end

**Status:** Accepted · 2026-07-25

**Context.** Yuri stated no language preference. Ms. Maria asked for a
demonstrably full-stack system. Python was considered for the workers, where the
email-parsing and AI ecosystems are stronger.

**Decision.** TypeScript across console, ingest, and worker. A pnpm workspaces
monorepo with shared types.

**Why.** The canonical `Message` type is shared by every layer; in one language
it's a single definition the compiler enforces end to end, and in two it's a
schema to keep in sync by hand. One toolchain, one CI config, one deploy story.
For a solo developer, that saved complexity is worth more than Python's library
edge.

Ms. Maria's "full-stack" expectation is satisfied by the system having real
webhooks, queues, workers, a relational schema, and a deployed frontend — not by
using two languages.

**Consequences.** MIME parsing in Node is less pleasant than Python's `email`
module. Acceptable — `mailparser` is mature.

**Revisit if:** a specific adapter genuinely needs a Python-only library.

---

## ADR-003 — AI providers chosen per workload

**Status:** Accepted · 2026-07-25 · *Revised — Llama is no longer a constraint*

**Context.** Ms. Maria suggested Llama, and an earlier version of this ADR treated
that as binding. Yuri clarified it was a **suggestion, not a requirement** — the
choice is ours, and should be made on merit.

Three facts constrain the answer:

1. **Azure OpenAI is unavailable.** Azure for Students cannot provision it.
2. **Groq has no embeddings endpoint.** Chat completion only.
3. **Groq's free-tier token throughput is too low for RAG.**
   `llama-3.3-70b-versatile` allows **12,000 tokens/min and 100,000 tokens/day**.
   A retrieval prompt carrying ~20 retrieved messages runs 4,000–8,000 tokens —
   so roughly **two assistant questions per minute, and ~15 per day** before the
   daily token cap is gone. That is not enough to demo, let alone use.

   Gemini 2.5 Flash allows **250,000 tokens/min** with a **1M-token context
   window**. For retrieval-augmented prompts, *tokens per minute is the binding
   constraint, not requests per minute* — and on that axis Gemini is ~20× Groq.

**Decision.** Three providers, each matched to a workload:

| Workload | Provider | Why |
|---|---|---|
| **Assistant Q&A** | **Gemini 2.5 Flash** | Long RAG prompts. 250K TPM and a 1M context window make retrieval tuning far less fragile. |
| **Per-message extraction** | **Groq** (Llama) | Short self-contained prompts, high volume. 14,400 req/day and very low latency. Fits Groq's shape exactly. |
| **Embeddings** | **Local**, Transformers.js in the worker | Free, unlimited, offline, cannot fail mid-demo. |

Two interfaces, one of which has two implementations:

```ts
interface CompletionProvider { complete(system, user, opts?): Promise<string> }
interface EmbeddingProvider  { embed(texts: string[]): Promise<number[][]> }
```

**Why split rather than pick one.** The two jobs have opposite shapes. Extraction
is *many small calls* — bounded by requests/day, where Groq is generous and fast.
Assistant Q&A is *few large calls* — bounded by tokens/minute, where Gemini is
generous and Groq is not. Forcing both onto one provider means accepting the
worse limit for one of them, and the cost of splitting is one extra API key.

It also buys isolation. If either free tier degrades, half the system keeps
working rather than all of it stopping.

**Why local embeddings — still the most important half.** Embedding is the
highest-volume operation: every message, plus every re-index. Through any API
that means a quota that can be exhausted and a network call that can fail. Local
means free, unlimited, and **impossible to break during a demo.** If both LLM
providers went down, search would still work.

Model: **`Xenova/multilingual-e5-small`** (384 dimensions). **Multilingual is
mandatory** — the corpus is Taglish, and English-only defaults like
`all-MiniLM-L6-v2` degrade badly on code-switched text, failing in a way that
looks like a ranking bug rather than a model problem.

⚠ **e5 models require prefixes:** `"query: "` on searches, `"passage: "` on
stored text. Omitting them silently degrades retrieval quality. Easy to miss.

**Consequences.** Two API keys instead of one. Vector dimension 384. The worker
holds ONNX model weights in memory — which is a direct input to ADR-011's decision
to keep it warm. Long emails must be chunked.

**Rejected:** Groq for everything (token throughput makes the assistant
unusable); Gemini for everything (workable, but wastes Groq's superior
request-volume ceiling on extraction, and concentrates risk in one provider);
Azure OpenAI (unavailable); paid OpenAI/Anthropic embeddings (money for something
free and adequate).

**Note on Gemini's risk:** Google cut free quotas 50–80% in December 2025 without
notice, and **enabling billing on a Gemini project destroys its free tier
permanently.** Keep billing disabled. The provider interface exists precisely so
this is a one-file change if it happens again.

---

## ADR-004 — Azure for infrastructure only; deliberately underspend the credit

**Status:** Accepted · 2026-07-25

**Context.** With Azure OpenAI unavailable, what should the $100 fund? Supabase
and Vercel free tiers cover database and frontend at $0 with better developer
experience than the Azure equivalents.

**Decision.** Azure for **Container Apps** (ingest + worker) and **Blob Storage**
(attachments). Everything else on free tiers elsewhere. Expect to spend close to
$0.

**Why.** Container Apps' free grant — 180,000 vCPU-s and 360,000 GiB-s per month
— covers scale-to-zero workers with room to spare, and it's the right home for
long-running background processes that Vercel's serverless model handles badly.
Azure earns its place on technical merit, with the credit as a buffer.

Choosing Azure Postgres over Supabase would cost ~$12–15/month to *lose*
pgvector, Realtime, Auth, and RLS. That's paying for a downgrade.

**Amendment · 2026-07-25 (see ADR-011).** This ADR originally predicted the
credit would go almost entirely unspent. That's no longer true: the worker must
stay warm to hold embedding model weights, so it runs `minReplicas: 1` at roughly
**$10–15/month** beyond the free grant. Over a few months that's well inside
$100, and it's a genuinely good use — the credit is paying for the one thing in
the system that actually needs always-on compute.

**Consequences.** A meaningful but bounded portion of the $100 gets used, with
plenty of headroom left as insurance. The principle stands: **don't spend it to
replace something that's free.** Supabase still beats Azure Postgres, and Vercel
still beats Azure Static Web Apps, because paying there would buy a downgrade.

---

## ADR-005 — Postgres table as the ingestion queue

**Status:** Accepted · 2026-07-25

**Context.** Webhooks must be acknowledged in milliseconds, but normalization,
embedding, and extraction take seconds. Work has to be queued.

**Decision.** A `raw_events` table in the existing Postgres, consumed with
`SELECT ... FOR UPDATE SKIP LOCKED`.

**Why.** Postgres is already provisioned. `SKIP LOCKED` is a well-established
pattern for exactly this and gives safe concurrent consumption without a broker.
At tens to hundreds of messages a day, a dedicated queue is infrastructure to
provision, secure, monitor, and explain in a presentation, for zero practical
gain. It also makes debugging trivial: the queue is a table you can `SELECT`
from.

**Consequences.** Won't scale to very high throughput. Irrelevant here, and the
worker's interface doesn't change if we swap in a real broker later.

**Rejected:** Azure Service Bus (over-engineered); Redis (another service to
run); in-memory queue (loses events on restart — unacceptable for messages we
can't re-fetch).

---

## ADR-006 — Extractions stored separately from messages

**Status:** Accepted · 2026-07-25

**Decision.** A separate `extractions` table keyed to `message_id`, recording
which model produced each row.

**Why.** LLM output is a **derived cache, not ground truth.** Keeping it separate
means we can re-run extraction with a better prompt, compare model versions, or
delete all of it, without touching the message record. Recording `model` per row
makes "did the new prompt help?" answerable.

Denormalizing onto `messages` would entangle immutable observed facts with
mutable inferences — tidy in week two, a migration in week six.

**Consequences.** A join for extraction views. Negligible.

---

## ADR-007 — Refuse over guess

**Status:** Accepted · 2026-07-25

**Decision.** A similarity floor on retrieval. If nothing clears it, the
assistant returns "I don't have anything about that" and does not call the model
at all. Every generated answer must cite message IDs, rendered as clickable
links.

**Why.** This is a **monitoring tool for professional communication.** A
fabricated meeting or invented commitment is worse than no answer — actively
harmful, and it destroys trust in the system on first occurrence. An honest
"nothing found" is a correct answer. Citations also make the reasoning auditable
to a demo audience.

**Consequences.** Some legitimate questions get refused when retrieval
underperforms. Tunable via the floor, and the Phase 4 eval set includes
should-refuse cases to keep it measurable.

---

## ADR-008 — Calls are out of scope

**Status:** Accepted · 2026-07-25

**Context.** Yuri initially listed calls alongside WhatsApp and email as a
priority. Three independent findings argued against it.

**1. Ms. Maria explicitly excluded them.** She said call integration isn't
necessary and can be skipped — stated in the meeting and repeated in Yuri's own
written summary. Building it isn't ambition; it's contradicting the scoping we
were given.

**2. It is the hardest thing in the project by a wide margin.** WhatsApp's
Business Calling API supports VoIP but provides **no native recording or
transcription** — you receive a raw audio stream and build everything on top.
That's real-time media handling, an entirely different class of engineering from
the JSON webhooks the rest of the system uses. It would plausibly cost more than
both channel adapters combined.

**3. Recording calls in the Philippines is a criminal offence without all-party
consent.** RA 4200 (Anti-Wiretapping Act) is among the strictest such laws
anywhere. *Ramirez v. Court of Appeals* (1995) established that **even a
participant who records their own conversation without the other party's
knowledge violates it.** Penalty is imprisonment, and Section 4 makes such
recordings inadmissible as evidence regardless.

**Decision.** No call ingestion in any form. Not audio, not transcripts, not
metadata.

**Why not metadata-only.** A middle path was considered — logging that a call
happened, with whom and for how long, without touching content. It sidesteps RA
4200 cleanly since nothing is intercepted, and it would put calls in the unified
timeline. Yuri chose to skip calls entirely instead, which is the simpler and
safer call: it matches Ms. Maria's scoping exactly and removes the feature from
the risk register altogether.

**Consequences.** The unified timeline covers messages only. If someone asks "but
what about calls?" at the demo, the answer is a good one: *the mentor scoped them
out, and Philippine law makes recording them a criminal offence without all-party
consent.* Knowing that is a stronger answer than having built it.

**Revisit only if** Ms. Maria explicitly requests calls **in writing**, and only
as metadata-only. Full recording would require consent built into the call flow
and legal review — not an intern project.

---

## ADR-009 — Multi-tenant from day one, but no team features

**Status:** Accepted · 2026-07-25 · *Reverses the original single-user non-goal*

**Context.** Switchboard is pitched as an internal tool for iOzera, and Yuri
confirmed the requirement: **multiple people, each connecting their own channels
and seeing only their own messages.** The original spec listed multi-tenancy as
an explicit non-goal, on the grounds that it's "a rewrite, not a feature."

That reasoning was right, which is exactly why this decision lands **now**.
Retrofitting per-user scoping across nine tables after Phase 3 is the rewrite.
Building it into the first migration is a column and a policy.

**Decision.** Real multi-tenancy in the data model from the first migration:

- Supabase Auth for identity; `auth.uid()` is the tenant key
- `owner_id` on `channels`, denormalized down to `messages`, `contacts`,
  `conversations`, `extractions` and `raw_events` for RLS performance
- **RLS is the security boundary**, not defense in depth — every table denies by
  default and permits only `owner_id = auth.uid()`
- Each user runs their own OAuth flow and owns their own channel rows

**And a hard scope line: no team features.** No sharing, no invites, no admin
console, no roles, no cross-user visibility. Multi-tenant means *isolated*, not
*collaborative*. Those are the features that would actually blow up the timeline,
and none of them were asked for.

**Why the asymmetry between channels matters.** Gmail and WhatsApp do not
multi-tenant the same way, and the design has to acknowledge it:

- **Gmail scales cleanly.** Each user OAuths their own inbox. Self-serve,
  unlimited users, no admin involvement.
- **WhatsApp does not.** Numbers belong to the *business*, not the user. A WABA
  holds **2 phone numbers initially, up to 20 once business-verified**, and
  messaging limits are *shared across all numbers in the portfolio* — one busy
  number can throttle the rest.

So WhatsApp channels are **admin-provisioned** (a number is registered to the
WABA, then assigned to a user), while Gmail channels are **self-serve**. Same
`channels` table, same `owner_id`, different connection flow. This is honest and
it works; pretending WhatsApp self-serves would produce a design that can't ship.

**⚠ The practical user ceiling is OAuth, not the database.** Gmail's restricted
scopes in *production* require a Google CASA security assessment — expensive and
slow. In **testing mode** no assessment is needed, but users must be manually
allowlisted and the cap is around 100. That's ample for iOzera and avoids a
months-long verification. *Verify the exact cap before relying on it.*

**Consequences.** Phase 0 grows: auth, RLS policies, and owner scoping all land
before any channel work. Every query gains a tenant filter. The `service_role`
key bypasses RLS, so the worker must set `owner_id` explicitly and correctly —
a bug there leaks one user's messages to another. Worth a dedicated test.

**Rejected:** single-user (doesn't meet the requirement); schema-per-tenant
(operationally absurd at this scale); bolting it on in Phase 3 (the rewrite this
decision exists to avoid).

---

## ADR-010 — Calendar write-back, with confirmation

**Status:** Accepted · 2026-07-25

**Context.** Ms. Maria's motivating example was *"do I have upcoming meetings?"*
Yuri chose the fullest interpretation: **detect meetings in messages, then create
real Google Calendar events.**

This is the first time Switchboard **writes** to anything. Everything else in the
system is read-only, and that asymmetry deserves care rather than being treated
as just another integration.

**Decision.** Meeting extraction feeds a calendar write-back flow, **gated behind
explicit user confirmation.** The assistant proposes; the user accepts; only then
does an event get created.

- Scope `https://www.googleapis.com/auth/calendar.events`, requested in the same
  consent as Gmail — one OAuth flow, one Google Cloud project. Cheaper than it
  sounds.
- Proposals surface in the UI showing the source message, parsed title, time and
  participants, all editable before confirming.
- The created event ID is stored on the `extractions` row. **This is the
  idempotency guard** — re-running extraction must never duplicate an event.

**Why confirmation is non-negotiable.** An LLM misreading *"maybe we should meet
sometime next week"* as a Thursday 3pm commitment, and silently putting it on
someone's real calendar, is the kind of failure that gets a tool uninstalled
after one incident. It's the same principle as ADR-007: **the system may propose,
but it may not assert.** Confirmation also makes a far better demo — you *see*
the reasoning before accepting it.

**Consequences.** Broader OAuth scope, so a more alarming consent screen. Needs a
proposal UI, not just a button. Google classifies calendar scopes as sensitive,
reinforcing the testing-mode approach in ADR-009.

**Rejected:** auto-creating events (unacceptable failure mode); reading the
calendar without writing (Yuri explicitly chose write-back); a separate OAuth
flow for calendar (needless friction — scopes combine).

---

## ADR-011 — Ingest on Vercel, one warm worker on Container Apps

**Status:** Accepted · 2026-07-25 · *Corrects a cold-start flaw in ADR-004's topology*

**Context.** The original plan deployed *both* the ingest service and the worker
as scale-to-zero containers on Azure Container Apps. Working through ADR-003
exposed two problems with that:

1. **Scale-to-zero is wrong for webhooks.** A cold start can take tens of
   seconds. Meta and Google retry on timeout and eventually **disable a webhook
   that keeps failing.** Risking the primary ingestion path on container cold
   starts is not acceptable.
2. **Scale-to-zero is wrong for the worker too, but for a different reason.** The
   worker holds ONNX embedding model weights in memory. Every cold start reloads
   them, adding seconds to the first job and blowing the *"message visible in
   under 10 seconds"* success criterion.

Keeping both warm would run roughly $28/month — about $112 over four months,
which exceeds the $100 credit.

**Decision.** Split by what each job actually needs:

- **Ingest → Vercel serverless functions**, alongside the console. Verify
  signature, insert a `raw_events` row, return 200. No cold-start problem at this
  scale, free, and it's a textbook serverless workload.
- **Worker → Azure Container Apps with `minReplicas: 1`.** Long-running, holds
  the embedding model warm, consumes the queue.

**Why this is better than the original, not just cheaper.** It removes a deployed
service entirely — the console and ingest share one Next.js app and one deploy —
and it puts each workload on infrastructure that matches its shape. Serverless is
genuinely good at "respond instantly to a burst of small requests." Containers
are genuinely good at "hold state in memory and grind through a queue." The
original design had both jobs on the wrong one.

**Cost.** One always-on small worker runs roughly **$10–15/month** beyond
Container Apps' free grant (180,000 vCPU-s and 360,000 GiB-s per month). Across a
project of a few months that's comfortably inside the $100 credit — and it
finally gives the credit a real job, which ADR-004 assumed it wouldn't have.
*Verify with Azure's pricing calculator before committing.*

**Consequences.** Ingest logic lives in the Next.js app, so it must stay
disciplined: **verify, insert, return.** No parsing, no enrichment, no API calls.
The temptation to "just do a little normalization here" is exactly what this
split exists to prevent. Vercel Hobby is also non-commercial-use only — fine for
a student project, worth flagging if iOzera ever runs this for real.

**Rejected:** both services scale-to-zero (webhook loss, slow first job); both
warm (~$28/mo, exceeds the credit); worker on Vercel (serverless timeouts make
queue processing and model loading impractical).

---

## ADR-012 — Hand-written SQL migrations; Drizzle Kit not used

**Status:** Accepted · 2026-07-26 · *Amends `docs/02-ARCHITECTURE.md` §8*

**Context.** §8 originally specified Drizzle Kit for migrations. On 2026-07-26,
`drizzle-kit generate` run against the live database produced a 116-line
migration that would have **disabled row level security on all ten tables,
dropped all ten `tenant_isolation` policies**, and dropped every unique, check
and foreign-key constraint — including the `(channel_id, external_id)`
idempotency guard. It was quarantined, never applied, and the database verified
intact afterwards.

**This is not a Drizzle bug.** `packages/db/src/schema.ts` doesn't model RLS,
policies or check constraints, so the differ correctly concluded the database had
drifted and proposed removing everything the schema doesn't declare. Drizzle did
exactly what it was asked to do.

**Decision.** Migrations are **hand-written SQL** in `packages/db/migrations/`,
applied through Supabase and reviewed as SQL. **Drizzle stays as the ORM** for
typed queries — unaffected, and where its value actually is here (ADR-002, §8).

**Why not just make `schema.ts` faithful.** It's possible — `.enableRLS()`,
`pgPolicy()`, `check()`, explicit constraint names, plus an `auth.users`
definition for the `owner_id` foreign keys. Three reasons not to:

1. **Every expression must match the database textually** or the differ keeps
   emitting diffs forever. Partial fidelity is the worst state: it produces
   *small, plausible-looking* diffs. **A plausible wrong diff is more dangerous
   than an obviously wrong one, because someone will apply it.** The 116-line
   DROP-everything migration was the *safe* version of this failure.
2. **`auth.users` belongs to Supabase.** Modelling a table we don't own, purely
   so a differ won't try to drop our foreign keys, is fighting the platform.
3. **RLS policies are the security boundary of a multi-tenant system.** The blast
   radius of getting this wrong is every tenant reading every other tenant's
   private client communications (ADR-009). Security-critical DDL should be
   reviewed *as SQL*, by a human, not emitted by a differ. Hand-writing it is an
   upgrade here, not a concession.

**Consequences.** Schema changes are written by hand — slower, and the schema
lives in two places (`migrations/` as truth, `schema.ts` as the typed mirror).
That mirror can drift silently, which is the real cost of this decision.

**Mitigations, in order of strength:**

- `drizzle.config.ts` points `out` at a gitignored scratch directory, so a stray
  `generate` cannot drop a destructive file where someone might run it.
- `drizzle-kit pull` introspects the live database for drift-checking. It works
  cleanly — 75 columns, 18 indexes, 20 FKs, 10 policies, 6 check constraints.
- **TODO — add a CI assertion** that all ten tables still report `rowsecurity`,
  `forcerowsecurity`, and at least one policy. Cheap, and it catches this exact
  class of disaster automatically rather than relying on anyone's vigilance.
  This is the mitigation that actually matters; the other two rely on discipline.

**Rejected:** modelling RLS in `schema.ts` (reasons above); keeping `generate`
with a rule to review diffs manually (depends on someone being careful forever,
on the one file where being careless is unrecoverable).

---

## Template for new ADRs

```markdown
## ADR-00N — <decision in one line>

**Status:** Proposed | Accepted | Superseded by ADR-00M · YYYY-MM-DD

**Context.** What forced a choice.
**Decision.** What we're doing.
**Why.** The reasoning, including what we're trading away.
**Consequences.** What this costs us and what it commits us to.
**Rejected:** Alternatives and why not.
```

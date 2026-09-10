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

CAUTION: **e5 models require prefixes:** `"query: "` on searches, `"passage: "` on
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

**CAUTION: The practical user ceiling is OAuth, not the database.** Gmail's restricted
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

**CAUTION: Amendment · 2026-08-02 — the worker needed twice the memory, and the cost
estimate above is now low.**

Phase 4B put the embedding model in the worker, as this ADR always intended.
The revision **crashlooped with exit code 137** — SIGKILL, out of memory — at
the original sizing of **0.25 vCPU / 0.5 GiB**. Loading a 129 MB quantised ONNX
model needs materially more than the model's own size once the runtime, the
session and Node's heap are counted. Resized to **0.5 vCPU / 1.0 GiB**, the
model loads in **5.6 s** and the revision is healthy.

Two things follow, and the second is the important one:

1. **The cost estimate doubles.** This ADR's *"roughly $10–15/month"* was for
   the old sizing. At 0.5 vCPU / 1 GiB expect roughly **$20–30/month**, which
   over four months approaches or exceeds the whole $100 credit. Still the
   credit's correct job, but it is no longer comfortably inside it —
   `docs/03-RESOURCES.md` §1's "expect meaningful headroom left over" should be
   read as spent.
2. **CAUTION: Graceful degradation cannot survive OOM.** `warmEmbedder()` is
   deliberately non-fatal so an image lacking the native ONNX binaries degrades
   to "no semantic search" instead of crashlooping. That design is correct and
   it did not help here: the kernel kills the process, so no `catch` runs and no
   log is written. **Right-sizing memory is a prerequisite, not a mitigation** —
   an error handler cannot protect against SIGKILL. If the worker ever loads a
   second model, size it first.

**Amendment · 2026-08-02 — the worker's ingress is now external.**

This ADR left the worker unreachable from outside, which was right while nothing
outside needed it. Phase 4B changed that: the console must turn a question into
a query vector, and it cannot hold the model itself — 129 MB plus native
binaries in a serverless function is a ~35 s cold start, and a demo's first
question *is* a cold start.

So the worker exposes exactly one route, `POST /embed`, behind a bearer secret
compared timing-safely. It is deliberately the narrowest possible surface: **it
takes text and returns numbers, never touches the database, and has no notion of
a user.** Retrieval stays in the console through `match_chunks` on the user's own
session, so RLS — not this process — decides whose messages are searched. Moving
retrieval into the worker would have put it behind `service_role`, where a wrong
tenant id is a silent cross-tenant leak no policy catches.

Verified from the public internet on 2026-08-02: no token → 401, wrong token →
401, correct token → a 384-dimension vector. An **unset** secret disables the
route rather than opening it.

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

## ADR-013 — `service_role` in the console, confined to ingest routes

**Status:** Accepted · 2026-07-27 · *Amends `docs/02-ARCHITECTURE.md` §6*

**Context.** §6 said the `service_role` key "lives only in the worker's
server-side environment." ADR-011 put the ingest webhooks in the console. Those
two cannot both hold, and building the `raw_events` insert is what forced the
issue: **a Pub/Sub push carries no cookie and no user**, so a client scoped by
RLS sees an empty database and cannot insert. The row it must write also carries
`owner_id` and `channel_id` as NOT NULL, derived from a `channels` lookup the
same client cannot perform.

Credit where due: the builder flagged this rather than quietly redefining a
documented decision. That is the behaviour this file exists to encourage.

**Decision.** The console holds `SUPABASE_SERVICE_ROLE_KEY`, server-side, and
uses it **only** under `app/api/webhooks/`. The rule is enforced by
`apps/console/test/service-client-boundary.test.ts`, which fails if any other
file imports the service client or references a `NEXT_PUBLIC_*SERVICE*`
variable. §6 is amended to match.

**Why.** §6's *intent* — never in a browser bundle — is intact and is now stated
as the actual rule rather than approximated by "only in the worker." The real
hazard was never the key's presence in a server process; it is a future page
using that client for a user-facing query and returning every tenant's rows to
whoever asks. That failure is silent and looks like working code, so **the
guard has to be a test rather than a convention.** A rule nobody checks lasts
until the first person in a hurry.

**Consequences.** A second place in the system can bypass RLS, so the blast
radius of a console bug is larger than it was. Mitigated by the boundary test,
by the key being non-`NEXT_PUBLIC_`, and by ingest being a small, disciplined
surface (ADR-011: verify, insert, return). Adding a channel adds a webhook under
the same allowlisted directory, so the rule does not need revisiting per channel.

**Rejected:**

- **A `security definer` Postgres function called with the publishable key.**
  Genuinely appealing — it would keep `service_role` out of the console
  entirely. Rejected because the publishable key reaches the browser, so the
  function would be callable by anyone: an attacker could forge `raw_events`
  rows against any channel. Gating it with a shared secret argument is a
  service-role key wearing a different hat.
- **Forwarding the notification to the worker over HTTP.** Reintroduces exactly
  the latency and cold-start exposure on the webhook path that ADR-011 exists to
  remove, and adds a second network hop that can fail while Pub/Sub is waiting.
- **Leaving §6 as written and building it anyway.** The option this project
  most needs to refuse. A doc that contradicts the code is worse than either
  one, because the next session trusts it.

---

## ADR-014 — The adapter contract, amended at the Phase 2 checkpoint

**Status:** Accepted · 2026-07-28 · *Amends `docs/02-ARCHITECTURE.md` §2*

**Context.** `docs/04-ROADMAP.md` gives Phase 2 one job — *"the refactor
checkpoint is the actual point of this phase… it's where you find out whether
the abstraction was real or wishful."* Writing the second adapter answered it,
and the answer had two halves.

The abstraction was **real**: WhatsApp is pure push where Gmail is hybrid
push/pull, and the canonical types absorbed the difference without strain. One
`CanonicalMessage`, one `persistMessage`, one timeline, no special cases
anywhere above the adapter.

Three of the interface's five signatures were **wishful**. None of them could be
implemented, which nothing had noticed because **nothing implemented the
interface** — Gmail ships as free functions, so `ChannelAdapter` had been a
comment since Phase 0.

| Signature | Why it could not be implemented |
|---|---|
| `verifyWebhook(headers, rawBody)` | No secret parameter. The only way to get one was reading `process.env` inside a package whose defining property is purity. |
| `parseWebhook(payload): RawEvent[]` | `RawEvent` carries `channelId`. Producing one needs a database lookup — *the* lookup that decides `owner_id`. |
| `normalize(event: RawEvent)` | `RawEvent` exists only at ingest. By normalization time the event has been through the queue and what remains is a stored payload. |

**Decision.** Amend the three signatures to what an adapter can actually
provide, add `InboundRef` as the type a pure parse can honestly produce, move
`NormalizeResult` into `core`, and **have the WhatsApp adapter implement the
interface** so it is checked rather than described.

**Why.** The `channelId` problem is the load-bearing one. Resolving a provider's
account reference to a channel is where `owner_id` is decided, the worker runs
as `service_role`, and no RLS policy will catch a wrong answer — it is the one
step in this system that must not be approximately right. An interface that
required a pure function to produce a `channelId` was quietly inviting an
adapter to do that lookup. `InboundRef` makes the seam explicit: **the adapter
reports what the provider said; ingest decides whose it is.**

The rule that fell out of it is worth more than the signatures: **a stored
payload must be self-sufficient.** WhatsApp's is — `parseWebhook` attaches the
business number and the sender's profile to each message, so `normalize` takes
one argument and the worker needs no second query. Gmail's is not: a Gmail
message resource does not say which mailbox fetched it, so the worker reads
`display_name` from `channels` and passes it in.

**Consequences.** Gmail is **not** retrofitted. It is working in production
against real mail, and rewriting an ingest path for symmetry is a risk taken for
tidiness. The divergence is documented here and in `core/src/adapter.ts` rather
than hidden, and the self-sufficiency rule applies to the next adapter.

`packages/adapters/whatsapp/test/adapter.test.ts` is what keeps this honest: it
implements the contract, so a future edit that drifts back toward the
unimplementable fails there instead of in a code review nobody runs.

**Consequence for the schema.** WhatsApp reports the same number twice —
`phone_number_id` (opaque, stable) and `display_phone_number` (formatted, for
humans) — and one column cannot be both the tenant key and the label. Migration
0006 adds `channels.external_account_id`, unique per channel type. Gmail leaves
it null and keeps resolving on `display_name`.

**Rejected:**

- **Delete `ChannelAdapter` and admit adapters are modules of free functions.**
  Honest, and it was close. Rejected because the contract is what makes "adding
  a channel is one file, not a refactor" true, and the canonical types on the
  other side of it genuinely held up under a structurally different channel. The
  interface was not wrong; three of its signatures were.
- **Leave it and note the divergence.** The option this project most needs to
  refuse — `docs/02-ARCHITECTURE.md` §2 calls the contract "the heart of the
  design", and a heart that cannot be implemented is a comment with ceremony.
- **Retrofit Gmail to a self-sufficient payload in the same pass.** Correct
  eventually, wrong now. It would rewrite the one path currently carrying real
  mail, in the same session that added a second channel, for no behaviour
  change.
- **Let adapters take a database handle.** Would make every signature work and
  end fixture-driven testing the same afternoon. The suite would need
  credentials to run.

---

## ADR-015 — Per-message summaries: their own phase, stored as extractions

**Status:** Accepted · 2026-08-02

**Context.** Summarization was in the **founding request**, not added later. Ms.
Maria, WhatsApp, 00:16 on 2026-07-25 — the message that started this project:

> ***"Do you think you can make a live webapp that can view whatsapp messages
> real time and have ai summarize bebe? Parang admin view"***

Followed at 00:16 by *"we have this project in the loop and isa yan sa
features"*, and at 00:18 by *"lmk if you need help ill try to compile a short
brd or feats you can add"* — a BRD that never arrived, and which Yuri stopped
chasing on 2026-08-03 (R22). It changes nothing about this ADR: the founding
request quoted above is the requirement, and it is verbatim.

Then on 2026-08-01, replying to *"Gmail works, emails pop up on the website"*:

> *"nc bebbb!! dont forget to incorporate an llm din to summarize noo"*

**That second message is a reminder pointing back at the first.** Read alone its
"summarize" has no object, and this ADR briefly recorded it as ambiguous on
2026-08-02 before the original thread surfaced. It is not ambiguous in context:
the object is *the messages*, established in the founding request, and
*"summarize"* sits inside *"view whatsapp messages real time **and have ai
summarize**"*.

CAUTION: **The correction record, because both errors are instructive.** This ADR was
first written from a paraphrase — *"summarize each emails received"* — which
asserted more than the source did. It was then over-corrected to "she probably
just means the AI layer generally", which asserted *less* than the source did.
The fix for both was the same and it was available the whole time: **read the
original.** `docs/00-CONTEXT.md` §2 now carries her verbatim words.

Neither existing phase produces this. Phase 4B answers *questions across the
corpus*; Phase 5 pulls *structured facts* into `extractions`. Neither produces
"what does this one message say", which is what *"view the messages and have ai
summarize"* describes for an **admin view** — a board you look at, with the AI
telling you what each thing says.

**Decision.** A new **Phase 4A**, sequenced **before** the assistant. Summaries
are written by **Groq** (ADR-003) in the worker on ingest, and stored as rows in
**`extractions` with `kind='summary'`**, keyed unique per message.

**Why 4A comes first.** It needs no embeddings, no chunking and no retrieval, so
it is a fraction of the assistant's work — and it exercises the Groq path
against real Taglish mail before Phase 4B's harder problem depends on a provider
this project has never called. It is also the cheapest visible intelligence in
the whole build, which matters for a mentor demo.

**Why `extractions` rather than a column on `messages`.** `messages` is the
record of **what arrived**; a summary is a **machine's opinion about it**.
Keeping them in separate tables means a bad prompt or a model change can never
corrupt the message record, re-running is a delete-and-insert rather than an
UPDATE over the corpus, and `extractions.model` makes *"did the new prompt
help?"* answerable — which it is not if the previous answer was overwritten in
place. ADR-006 already decided this shape for derived data; a summary is derived
data. The cost is a join on the timeline query, and that is the cheaper side.

**Consequences.**

- **Message bodies leave the system for the first time.** Nothing has ever been
  sent to a third party before this. `docs/02-ARCHITECTURE.md` §6 and Q2 in
  `docs/06-OPEN-QUESTIONS.md` gate real *client* data on a consent conversation
  with Ms. Maria, and this raises the stakes of that conversation. Dogfooding on
  Yuri's own accounts remains fine.
- **Message bodies become prompt input**, so prompt injection is now a real
  surface: an email can attempt to dictate its own summary, and the summary is
  shown to a human. Mitigated by delimiting the body as data, by a test fixture
  that tries it, and — most importantly — by the summary never replacing the
  original text on screen.
- Summarization is **non-blocking**. A Groq outage must degrade to "no summary",
  never to "no mail".

**Rejected:**

- **A `summary` column on `messages`.** Simpler to query and it is the obvious
  build. Rejected because it merges the record with an opinion about the record,
  and because re-summarizing then rewrites rows the console treats as immutable
  history.
- **Folding it into Phase 5 extraction.** Same prompt shape and same provider,
  so it looks like the same job. It is not: extraction produces structured rows
  for a "needs attention" view, summaries produce prose shown inline on every
  message. Bundling them would delay something Ms. Maria asked for behind the
  largest phase in the plan.
- **Summarizing in the ingest webhook.** Would put an LLM call on the path that
  must return in milliseconds. ADR-011 exists to prevent exactly this.
- **Showing the summary as the timeline preview line.** Tempting — it is the
  denser list. Rejected outright: the console's headline rule is *whatever the
  message leads with*, and putting a paraphrase where a person's own sentence
  belongs is how a monitoring tool stops being trustworthy.

---

## ADR-016 — The similarity floor cannot carry the refusal; the model must

**Status:** Accepted · 2026-08-02 · *Amends ADR-007 and `docs/02-ARCHITECTURE.md` §4 step 3*

**Context.** ADR-007 specifies the refusal path as a retrieval-side threshold:
*"A similarity floor on retrieval. If nothing clears it, the assistant returns
'I don't have anything about that' **and does not call the model at all**."*
`docs/02-ARCHITECTURE.md` §4 repeats it as step 3, and `docs/04-ROADMAP.md`
says to build it before the happy path.

Built first, as instructed — and measuring it against the real corpus showed it
**does not work.** `apps/worker/scripts/probe-floor.ts`, run over 73 messages
and 394 chunks on 2026-08-02, with five questions the corpus can answer and
five it cannot:

| | top similarity |
|---|---|
| lowest **answerable** — *"what failed in CI?"* | **0.8487** |
| highest **unanswerable** — *"what is the recipe for adobo my grandmother sent?"* | **0.8563** |
| separation | **−0.0076** |

The adobo question, which has no answer anywhere in the corpus, scored *higher*
against a job-advert email than a question with a correct answer scored against
its own answer. **No threshold divides these**, and one chosen by intuition —
0.5, say, which sounds conservative — would admit literally everything.

**Why.** e5 produces L2-normalised embeddings that occupy a narrow cone: any two
pieces of natural language land somewhere around 0.75–0.90. The absolute value
is close to meaningless as a measure of "is this relevant"; what carries signal
is the **ranking within a single query**. And the ranking is genuinely good —
every answerable question's top hit was the correct message ("Meeting",
"Failed production deployment", "You got paid by…"). Retrieval works. The
threshold was the wrong instrument.

**Decision.** Amend the refusal path:

- **The model performs the refusal**, from context it can see, instructed to
  answer strictly from the provided messages and to say it has nothing when they
  do not contain the answer. Enforced by requiring a citation for every claim.
- **A relative floor replaces the absolute one.** Results more than
  `RELATIVE_FLOOR` below *that query's own* top score are dropped. This uses the
  signal that exists (ranking) rather than the one that does not (absolute
  distance), and it stops twelve weakly-related chunks padding the context.
- **A low absolute floor is kept as a backstop only** — it catches an empty or
  near-empty corpus, not an irrelevant question. It is explicitly **not** the
  refusal mechanism, and the constant says so.
- **The eval set is the check**, not the threshold. Questions that must be
  refused are part of it, as ADR-007 and the roadmap already required.

**Why not tune the floor harder.** Because the data says the orderings overlap:
there is no value that admits *"what failed in CI?"* and rejects the adobo
question. Tuning would produce a number that fits five examples and fails the
sixth, while looking principled. The honest reading is that this model cannot
answer "is anything here relevant?" in absolute terms, and pretending otherwise
would make the refusal path decorative — which is worse than not having one,
because ADR-007's whole point is that a monitoring tool must not invent.

**Consequences.**

- **Every question now costs a Gemini call**, including ones that will be
  refused. ADR-007 avoided that. Acceptable: Gemini Flash allows 250K tokens/min
  and refusals are cheap, and the alternative is a refusal that does not work.
- The refusal is only as good as the prompt and the model, so it is now a
  **measured** property rather than a guaranteed one. That is what the eval set
  is for, and why it includes must-refuse cases.
- CAUTION: **Re-run `probe-floor.ts` after any change to the embedding model, the
  chunker, or the e5 prefixes.** All three move the distribution, and the
  relative floor is calibrated against it.

**Rejected:**

- **Keep the absolute floor and pick a number.** It cannot separate the classes;
  any number is a guess dressed as a threshold.
- **A different embedding model with wider spread.** Would trade the multilingual
  property for a metric convenience. ADR-003 requires multilingual because the
  corpus is Taglish, and that is load-bearing — this same probe showed a Tagalog
  message out-scoring an English one on an English query.
- **A cross-encoder re-ranker.** The right answer at scale, and genuinely more
  discriminating. Rejected for now as a second model to load, hold in memory and
  deploy, for a corpus of 73 messages — `docs/04-ROADMAP.md`'s "prefer boring,
  working technology" applies. Revisit if the eval shows the prompt-side refusal
  failing.

---

## ADR-017 — The eval was scoring two correct refusals as failures

**Status:** Accepted · 2026-08-02 · *Amends ADR-016's consequences and closes Q9*

**Context.** `docs/04-ROADMAP.md` and Q9 both recorded the assistant as
over-refusing two answerable questions — *"do I have any upcoming meetings?"* and
*"summarise what needs my attention"* — and both prescribed the same fix: soften
the prompt and re-measure. The working hypothesis was that these are **broad,
aggregate** questions where the answer is spread across several messages, and
that a prompt telling the model to assume the retrieved list may be entirely
irrelevant was refusing them wrongly.

The hypothesis was tested before it was acted on, with a new zero-cost
instrument: `apps/worker/scripts/probe-context.ts` prints exactly what reaches
the model for every eval question. It costs **no quota at all** — embeddings are
local and `match_chunks` is Postgres — which is what made it affordable to look
before spending half a day's tokens tuning.

**It is half right, and the half that is wrong matters more.**

*"Summarise what needs my attention."* The eight messages selected were a
Deepgram welcome, a Coursera announcement, a Huawei promotion, two ScreenPal
mails, a Nike drop and a job alert. **None of the CI failures, deploy failures or
the Supabase pause was in the context at all.** This is not a synthesis failure —
the model cannot summarise messages it was never given. e5 has no representation
of *importance*, so the nearest neighbours to "needs my attention" are prose that
sounds urgent. No prompt wording reaches this.

*"Do I have any upcoming meetings?"* Retrieval is fine — four of six selected
messages are meetings. But **every meeting in the corpus is dated 27–28 July**,
and three of the five have bodies reading only "YURI" or "Meeting". The single
message naming a time, *"Meeting at 9pm tonight"*, was sent at 19:59 on 2 August.
The eval was run at 22:40. Shown four six-day-old fragments and told today's
date, **the model's refusal is correct** — and the eval scored it as a failure.

Worse, the case's expected outcome **depended on the wall clock**: answerable at
3pm, correctly refused at 10pm. An instrument that changes its verdict by the
hour cannot be tuned against.

**Decision.**

1. **Eval cases carry a three-way expectation** — `answer`, `refuse`, or
   `known-gap` — instead of a boolean `mustRefuse`. Known gaps are still asked
   and their output still printed on every run, but they are **not scored as
   logic failures**, and each carries the measured reason and what would close
   it. The summary reports `answerable: n/n` and `must-refuse: n/n` **separately,
   never as one number.**
2. **Both failing cases are recorded as `known-gap`, and both are Phase 5.**
   `docs/01-PRODUCT-SPEC.md` US-7 (extracted meetings) and US-9 (a digest of what
   needs attention) already own them, and R14 already settled that "upcoming
   meetings" come from **extraction**, not from semantic retrieval.
3. **The prompt's decision becomes three-way**, which is the part of the original
   hypothesis that survived. "Nothing here is about this" (refuse) is separated
   from "several things here are about this, none individually decisive"
   (synthesise and cite each). The discriminator is stated as *are these messages
   about the question's **subject***, not *does any one settle it*.
4. **A synthesis case retrieval can actually serve replaces the unservable one**
   — *"what kinds of roles have I been sent job alerts about?"*. Measured: all 20
   retrieved rows are genuine job alerts, none individually the answer.
5. **A provider failure is counted separately from a logic failure.** `groq rate
   limit` is the daily token cap, not a regression, and a run that lost cases to
   quota must not read as a run that got worse.
6. **The cases live in one file** (`apps/worker/scripts/eval-cases.ts`), shared
   by the eval and the probe, so the thing that diagnoses cannot drift from the
   thing that scores.
7. **`--only` runs a subset.** A full run is fifteen calls ≈ half the day's
   measured token allowance, so "re-run after every change" previously afforded
   about two iterations. It takes a **list**, because the useful narrow run is
   never one case — it is the case a change should move plus the refusals that
   must not move with it.

**Why not just soften the prompt to 7/7.** Because it would be **fabrication with
a passing score.** The corpus contains no upcoming meeting; making the model
answer that question means making it assert one from four six-day-old emails
reading "YURI". That is the exact failure ADR-007 exists to prevent, and it is
demonstrably reachable — the earlier prompt scored 7/7 answerable and **3/8
refusals**, citing all eight retrieved messages for a question about a submarine.
A target number is not a goal when the honest answer is below it.

**Consequences.**

- The reported score changes shape and **is not comparable to the old one.** It
  is not "5/7 became 6/6"; it is that two cases were never measurable.
- Ms. Maria's example question does not work well today, and the assistant's
  suggestion list has been reordered so measured-answering questions lead —
  its own docstring already required that, and the two most prominent
  suggestions were the two guaranteed to disappoint.
- **The fix for that question is Phase 5, not a prompt.** For a demo before then,
  one mail naming a genuinely future date makes it real.
- The relative floor was found to cut the most decision-relevant message for the
  meetings question by **0.0039**, on a smooth distribution with no cliff. It is
  **left unchanged** — widening it would not have altered that question's correct
  answer, so moving it would be tuning against a case it does not decide, which
  ADR-016 already identifies as how a threshold ends up fitting five examples and
  failing the sixth. Recorded in `RELATIVE_FLOOR`'s comment with the numbers.
- `packages/ai/src/assistant.ts` gained the unit tests it never had. 356 tests
  and **not one** touched `selectContext` or `parseAnswer`, the two pure
  functions carrying the refusal contract.

**Rejected:**

- **Deleting the two cases.** They are real product goals and one of them is the
  mentor's own example. Deleting them would lose the requirement along with the
  failure.
- **Marking them `mustRefuse: true`.** It would score green and enshrine the
  wrong behaviour: the product is *supposed* to answer both, eventually.
- **Inserting a synthetic future-dated meeting into `messages`.** It would make
  the case pass immediately. Rejected outright — `messages` is the record of
  **what arrived** (ADR-006, ADR-015), and writing a machine-authored row into it
  to make a test pass corrupts the one table in the system that must only ever
  contain things that really happened. A real mail from Yuri is the honest
  version of the same fix.
- **Computing the expectation from the corpus at run time.** Genuinely tempting —
  it would make the meetings case self-correcting. Rejected as more machinery
  than the problem: it needs date extraction from message text, which *is* Phase
  5, so the eval would be reimplementing the feature in order to test it.

---

## ADR-018 — Citations link to a message route, not into the timeline

**Status:** Accepted · 2026-08-02 · *Amends `docs/02-ARCHITECTURE.md` §4 step 6 and §6*

**Context.** `docs/02-ARCHITECTURE.md` §4 step 6 specifies the console showing
*"each citation as a clickable chip that jumps to the message in the timeline"*,
and `docs/04-ROADMAP.md` carries the same wording. Phase 4B shipped the citations
as static cards: sender, date and an excerpt, linking nowhere.

**Decision.** Citations link to **`/messages/[id]`**, a new signed-in,
RLS-scoped route that renders one message in full.

**Why not the timeline jump the doc specified.** The timeline is capped at the
newest **50** messages and says so. A citation to anything older would scroll to
nothing — and **a citation that silently fails to resolve is worse than no link
at all.** It produces exactly the "the assistant invented that source"
impression ADR-007 exists to prevent, except arriving through the UI rather than
the model. The cap is not incidental either: it exists because the timeline
serialises every body into the page.

A route also resolves any message regardless of age, survives being opened in a
new tab or shared, and is what the code already anticipated — the note on
`BODY_LIMIT` in `lib/timeline.ts` reads *"When Phase 3 adds a message route, that
route reads the whole body and this ceiling stays where it is: it bounds the
list, not the record."* **Phase 5 needs it independently**: ADR-010 requires the
source message shown beside every meeting proposal.

**CAUTION: This amends the "bodies render in exactly one place" rule**, stated in
`message-row.tsx` and in the UX brief. The rule's *intent* — private content is
not scattered across the app — is intact: this is one deliberate route, behind
the session gate, scoped by RLS, whose entire purpose is showing one message to
the person who owns it. The rule is amended here rather than quietly broken,
because a doc that contradicts the code is worse than either (ADR-013).

**Consequences.**

- A second place message bodies render. Both are now enumerable and both are
  named in §6.
- **A message that is not yours and a message that does not exist are the same
  `notFound()`.** RLS makes them indistinguishable, and that is correct rather
  than a limitation: confirming which ids exist in another tenant's mailbox is a
  leak even without the content.
- The route renders the **whole** body, not `BODY_LIMIT`. Truncating a record
  view would make a citation resolve to a partial quote, which is the opposite of
  what a citation is for.
- `prefetch={false}` on the chips: these are private message bodies and the
  reader has not asked for them yet.
- `Citation.channelId` is removed. It was always `''` — a field that always lies
  is worse than no field.

**Rejected:**

- **`/?message=<id>` scrolling the timeline.** What §4 specified. Broken for any
  cited message outside the newest 50, and silently so.
- **Raising the timeline cap so the jump always works.** Trades a correct,
  documented performance boundary for a worse version of the same feature.
- **A modal over the assistant.** No URL, so a citation could not be shared,
  bookmarked or opened in a tab — and the audience for this feature is someone
  checking a claim, who wants to keep the answer and the source both.

---

## ADR-019 — Extraction records that it ran, in its own table

**Status:** Accepted · 2026-08-03 · *Migration 0011*

**Context.** Phase 4A could ask *"is this message already summarised?"* because
migration 0008 gave `extractions` a partial unique index on `(message_id) where
kind = 'summary'`. Exactly one summary per message, so the row's presence **is**
the answer, and `apps/worker/src/summarize.ts` reads it before spending a
request.

Phase 5's kinds are deliberately the opposite. One message can carry two
commitments, a meeting and a question, so there is no unique key to conflict on
— and the part that actually bites: **a message that legitimately yields nothing
is indistinguishable from one that was never processed.** Most of a real mailbox
is newsletters, receipts and notifications; "no rows" is the ordinary outcome,
not a failure.

Without a marker, every Pub/Sub redelivery, every Meta retry (seven days of
them) and every backfill run re-sends those messages to Groq to be told nothing
again. `summarize.ts` already names that cost precisely: *"Paying for the same
summary twice is the mild outcome; exhausting a 14,400/day allowance on work
already done is the real one."*

**Decision.** A separate table, `message_extraction_runs` — `message_id` as the
primary key, plus `owner_id`, `model`, `rows_written` and `created_at`. RLS
enabled, forced, one policy carrying USING **and** WITH CHECK, exactly like
every other table (ADR-009). `extractMessage` reads it before the API call and
writes it **inside the same transaction** as the rows.

**Why a table rather than a row in `extractions`.**

`extractions` means *"something a model found"*. This means *"a model looked"*.
Those are different facts, and a marker row in `extractions` would put a row in
that table which is not an extraction — so every query over it (the timeline's
PostgREST embed, `search_messages`'s LEFT join, the "needs attention" view)
grows a filter whose only job is to exclude bookkeeping. One of them eventually
forgets it, and this project has already shipped that exact class of bug twice
in one migration (0010's LEFT-join traps).

It also makes re-running with a better prompt a clean operation: delete the runs
for a model, delete that model's rows, re-run. As a marker kind those two
deletes are the same statement, and getting it wrong deletes real extractions.

**`rows_written` is not decoration.** Zero is the common case, and recording it
is what separates *"extraction ran and this message contains no commitments"*
from *"extraction has not run"*. Without it the table answers half the question
it exists to answer.

**Consequences.**

- **An eleventh table, and `packages/db/scripts/assert-rls.ts` fails until it is
  listed there.** That is the guard working as designed (ADR-012): the script
  rejects any table in `public` it does not recognise, so a new tenant-data
  table cannot slip past the boundary check. Updated in the same commit, and
  negative-controlled — RLS disabled on the new table, the check exits 1 and
  names it; re-enabled, all eleven pass.
- The rows and the run record must be written in **one transaction**. Rows
  without a run mean the next pass doubles every proposal; a run without its
  rows means the message is marked done and its real commitments are lost with
  no way to notice.
- **A failure records nothing.** A rate limit, an outage or an unparseable
  response leaves the message outstanding, which is what makes the backfill
  resumable and what makes "stop the batch on a retryable failure" safe.

**Rejected:**

- **Guard on `exists(select 1 from extractions where message_id = X)`.** Zero
  schema change, and wrong for the majority case: every message that correctly
  yields nothing is re-sent on every redelivery and every backfill run.
- **A marker `kind` in `extractions`.** Reasons above.
- **A column on `messages`.** `messages` is the record of **what arrived**
  (ADR-006, ADR-015). Derived processing state does not belong in it, and the
  console treats those rows as immutable history.

---

## ADR-020 — Should the assistant read `extractions` as well as `message_chunks`?

**Status:** **ACCEPTED in the narrow form, 2026-08-03, by Yuri** · built behind
`ASSISTANT_GROUND_EXTRACTIONS`, **default off pending a full measured run**

> ### The decision, and the condition attached to it
>
> Yuri accepted the **narrow version only** — a date-window lookup for questions
> that are explicitly about scheduled time — and attached one condition: **fix
> the extraction coverage hole first.** That was the right call and it was based
> on a measurement taken the same day. `extractions` was missing **four of the
> last five substantive messages**, because extraction runs last of the three AI
> steps, meets an exhausted 6,000 tokens/minute window, records nothing by
> design, and **nothing was scheduled to come back for it**. Grounding the
> assistant in a source that silently drops most of a day's mail would have made
> it *less* reliable while looking like an improvement — a confident *"you have
> no upcoming meetings"* drawn from a table that never saw the meeting.
>
> Fixed first (`apps/worker/src/extract-catchup.ts`, a 15-minute sweep that runs
> only when the queue is empty), backfilled to **0 outstanding**, and only then
> was this built.
>
> **CAUTION: It ships OFF, and the default is the decision, not an oversight.** This
> ADR requires the refusal to be re-measured on both numbers. The daily token
> cap allows roughly one full eval a day, and 2026-08-03's run is the baseline:
> **answerable 6/6, must-refuse 7/7** — the first complete score this project has
> ever had. Turning the flag on by default would have spent that baseline and
> left the change unmeasurable, which is exactly what ADR-017 was written about.
> The flag makes before and after one experiment instead of two unrelated runs.
>
> **To close this properly:** run the full unfiltered eval with
> `ASSISTANT_GROUND_EXTRACTIONS=1` on a day the assistant has not been used, and
> compare **both** numbers against 6/6 and 7/7. The must-refuse score is the one
> that matters — none of its eight cases is a time question, so they should be
> bit-identical, and a move there means `isTimeQuestion` is leaking rather than
> that the model got worse.
>
> **Measured so far (2 cases, 2026-08-03):** the meetings question answered
> correctly with two detected items in context; the Jakarta refusal did not take
> the path and still refused. That is plumbing verified, **not** a score.
>
> ### What was built, and four things not to reverse
>
> - **The merge runs AFTER `selectContext`, never inside it.** An extraction has
>   no similarity, and there is no correct number to invent: at 1.0 it becomes
>   the best hit, `RELATIVE_FLOOR` then measures every real message against it
>   and drops them all, and time questions get answered from extractions alone
>   with the corpus silently discarded. A test asserts that exact failure.
> - **The explanation lives in the USER turn, not `ASSISTANT_SYSTEM_PROMPT`.** A
>   system-prompt edit would change all sixteen eval cases and the eight refusals
>   would stop being a control. A non-time question now gets a byte-identical
>   prompt to the one measured.
> - **Context stays capped at `MAX_CONTEXT_MESSAGES`.** Extractions displace
>   retrieved messages rather than adding to them, so a time question does not
>   quietly cost more tokens against a ~30-question day.
> - **Blocks are labelled `DETECTED` and carry the verbatim `quote`, never the
>   title.** The title is the part the model composed; the quote was checked
>   against the body before it was stored. This is the answer to objection 1
>   below.
>
> **`isTimeQuestion` is narrow, and a test reads the real eval case list** to
> prove no must-refuse case takes the path. It earned itself immediately:
> `schedule|scheduled` matched *"When is the submarine delivery **scheduled**?"*
> — a refusal case, which would have had a different prompt in the treatment run
> than in the baseline and quietly broken the comparison. Dropped, along with
> `call`/`booking` and `do i have`. **Under-triggering is the safe direction**:
> it falls back to today's behaviour, and today's behaviour scores 6/6.

*Original proposal, kept as written because the reasoning is what was decided on:*

**Status when raised:** PROPOSED — not accepted, not built · 2026-08-03 · *For Yuri*

**Context.** `docs/04-ROADMAP.md` names this as *"the natural follow-on once
extraction exists"*, and adds the condition it is being honoured by: *"That is a
design decision worth an ADR, not a quiet addition — it changes what the
assistant is grounded in."* Phase 5 shipped, so the question is live.

Today the assistant is grounded in exactly one thing: chunks of message text,
retrieved by cosine similarity, cited back to their message. ADR-016 put the
whole refusal on the model reading that context, and ADR-017 established that
its two known gaps are not prompt problems:

- *"Summarise what needs my attention"* — semantic search returns newsletters,
  because importance is not a direction in embedding space. **Now answered by
  `/attention`**, which reads `extractions` directly.
- *"Do I have any upcoming meetings?"* — answerable today only because a real
  future-dated mail exists in the mailbox, and **that mail expires on 8 August**.
  Extraction now holds the same fact as a structured row with a parsed
  `starts_at`, which does not expire and does not depend on retrieval.

**The proposal.** Before retrieval, check `extractions` for rows whose
`starts_at` or `due_at` falls in a window the question implies, and put them in
the context alongside the retrieved chunks — each still carrying its
`message_id`, so every citation still resolves to a real message.

**Why it is not simply obviously right.**

1. **It changes what "grounded" means.** Every claim the assistant makes today
   traces to text somebody actually wrote. An extraction row is a *model's
   reading* of that text. Citing one is citing an inference — and the citation
   chip would look identical to a citation of a real sentence. The `quote` field
   makes this recoverable (it is verbatim, and verified against the body), but
   it has to be deliberate: the answer must be built from the quote, not the
   title.
2. **It reopens the refusal.** ADR-016 moved the entire refusal onto the model
   reading its context. Handing it a *pre-filtered, structured* set changes the
   distribution that decision is made against, and the refusal is the property
   the product is judged on. **It would have to be re-measured**, and the eval's
   eight must-refuse cases are the instrument — which today cannot be run
   reliably on a day the assistant has also been used.
3. **It is not needed for the thing it was proposed for.** US-9 is now a screen.
   The remaining gap is narrow: *the assistant* answering a meetings question
   durably rather than by luck of the corpus.

**Recommendation.** Take the narrow version, if any: a date-window lookup for
questions that are explicitly about time, feeding the model the extraction's
**quote** and its parsed date, cited to the source message — and re-run the full
eval, both numbers, before and after. Not a general merge of the two sources.

**Do not build this without Yuri's decision**, and not on a day the eval cannot
be run — a change to grounding that cannot be measured is exactly what ADR-017
warned about.

**Rejected already:**

- **Quietly adding `extractions` to the retrieval query.** What the roadmap
  explicitly asked not to happen, and the change would be invisible in a diff of
  the prompt.
- **Fixing the meetings question in the prompt instead.** Measured and ruled out
  (ADR-017). The previous attempt cost the refusals: 7/7 answerable at 3/8
  refusals, citing all eight retrieved messages for a question about a submarine.

---

## ADR-021 — Cards leave the attention board by archiving, never by deleting

**Status:** Accepted · 2026-08-09 · *Migration 0013*

**Context.** The "needs attention" board accumulates. Done is the only column
nothing ever leaves, and the board also collects genuine noise: two of the ten
live cards were extracted out of marketing email, one of them quoting a
promotional tracking URL. Yuri proposed a delete button. Ms. Maria asked for an
archive instead.

The disagreement looks like a matter of taste and is not. It turns on a fact
about this schema:

**Migration 0011 records, per message, that the extraction pass has run.** That
table exists so a Pub/Sub redelivery, a Meta retry or a backfill never re-pays
Groq for work already done, and `extractMessage` reads it before spending a
request. The consequence for deletion is the part that decides this ADR: **a
deleted extraction is never re-extracted.** The worker will skip that message
forever. Delete here is not "it comes back on the next sync" — it is permanent
loss of a row quoting somebody's real correspondence, with no record that it
existed.

There is a second reason, weaker but real. These rows are a model's readings of
somebody's mail. Keeping them is what makes "what did the model find, and what
did the human do with it?" answerable, which is the beginning of measuring
extraction quality. A delete erases the evidence along with the noise.

**Decision.** One nullable column, `extractions.archived_at`. Null means the card
is on the board. Nothing in the console issues a DELETE against `extractions`.

Archiving is available from **all three columns**, not only Done. Done is the
obvious case; Not started is the valuable one, because clearing noise before
ever touching it is most of what stops the board reading as a pile.

**Why not a fourth `status` value.** `status = 'archived'` is the obvious move
and it fails on restore: the card's column would have been overwritten, so
putting it back would drop everything into Not started regardless of where it
came from. Archiving is orthogonal to which column a card is in. Leaving
`status` untouched makes restore a single `archived_at = null`, returns the card
exactly where it was, and lets the archived view state which column each item
will go back to before the reader clicks.

**Why no confirmation dialog.** The action is reversible and the way back is
never hidden: the page header always shows the archived count as a link, and
every archived card has Restore. A confirm step on a reversible action teaches
people to click through confirm steps, which is what makes the next irreversible
one dangerous. **If this ever becomes a real delete, that reasoning inverts.**

**Consequences.**

- Every board read carries `archived_at is null`. **CAUTION: express that as
  `is('archived_at', null)`, never `eq(..., null)`** — PostgREST turns `eq` into
  `= null`, which is NULL rather than true in SQL, so the filter matches nothing
  and the board renders empty with no error anywhere.
- `fetchAttention` defaults to `scope: 'board'`. That default is load-bearing:
  `fetchMessageExtractions` calls through it for the proposal on
  `/messages/[id]`, and a card somebody archived must not reappear there.
- Bulk "Archive all" on Done is scoped by `status = 'done'` in the WHERE clause,
  never by a list of ids from the client. A client-supplied list is a list
  somebody can edit; deriving the set on the server means the action cannot be
  persuaded to archive unfinished work.
- No index. The query is bounded to 100 rows for one owner and already filtered
  by `kind`; Postgres will not use one to answer it, and it would be write cost
  on the ingest path. Revisit past a few thousand rows per tenant.

**Rejected.** Deleting the row (permanent, per the context above). A fourth
status (breaks restore). Auto-archiving Done after N days — never hide somebody's
data on a timer without them asking; the bulk action gives the same relief and
is a decision they made.

**Open.** Distinguishing *"I handled this"* from *"the model should not have
surfaced this"*. The second is feedback about extraction quality rather than
about the work, and recording it would make "how often is the pass right?"
answerable. Not built; one archive action is the proportionate version.

---

## ADR-022 — The timeline defaults to the split layout, not the merged record

**Status:** Accepted · 2026-08-09 · *Yuri's call, and it costs something*

**Context.** `Timeline` renders one ordered record across every channel. That is
not a layout preference — it is the product's central claim, the thing the name
means, and what `docs/01-PRODUCT-SPEC.md` frames the whole console around. It is
also what Ms. Maria reviewed and approved on 2026-08-05.

On 2026-08-06, with both channels finally connected, Yuri asked for Gmail on the
left and WhatsApp on the right: *"they are separate and all."*

There is a real argument for it beyond preference. Two channels arriving at very
different rates interleave badly — forty newsletters between two chat messages
buries the chat thread, and "read what this person said, in sequence" is a task
the merged view answers poorly.

**Decision.** Both layouts exist, the choice lives in the URL (`?view=merged`),
and **split is the default.**

**What it gives up, stated plainly.** In split, you can no longer see at a glance
that the client answered on WhatsApp forty minutes after their colleague emailed,
or which came first. That is the one thing the merged view is for. Defaulting to
split puts the product's own claim one click away from the first screen anybody
opens.

That was Yuri's call as chief and it is recorded as such. **The merged record is
the view to open for a demo or a defence**, because it is the one that
demonstrates what the product is for.

**Consequences.**

- Channel identity is still named in words in both layouts, satisfying the
  WCAG 1.4.1 rule the console has enforced since Phase 1. In merged that is
  `channelChangePoints`; in split it is the column heading, which is strictly
  better — every row sits under a heading naming its line. `showChannel` is
  therefore off on every row in split; a per-row badge under a heading that
  already says "Gmail" is noise.
- Days are still grouped, per column. A flat list of fifty rows with no date
  structure is worse than either layout.
- Messages whose channel row failed to load go into a visible "Unknown line"
  column rather than being dropped. Dropping them would make a loading failure
  look like missing mail.
- The layout switch and the channel filter live in the same GET form, so
  changing one preserves the other. Two separate links would each have to
  rebuild the whole query string, and the first time a third filter is added one
  of them forgets it.

**Rejected.** Split-only (throws away the product's claim). Merged-only (ignores
a direct instruction and a real reading problem). Remembering the choice per user
in the database — the URL already survives a reload and is shareable, and a
stored preference is a migration plus a write path for something a query string
does for free.

---

## Template for new ADRs

```markdown
## ADR-023 — Voice runs on Vapi, and the browser microphone was removed

**Date:** 2026-09-11 · **Status:** Accepted

**Context.** Ms. Maria asked for voice on the switchboard: a circular interface,
chat and voice in one room, detailed answers when typed and short ones when
spoken, English only for now.

Two things were built, a day apart. First a browser-native version: record with
`MediaRecorder`, transcribe through Groq Whisper, answer aloud through the
browser's own `speechSynthesis`. It was free, private, and shipped nothing to a
new vendor. Then Yuri found **Vapi**, which hosts the whole call.

**Decision.** Vapi carries the voice layer. The browser microphone was removed
from `/assistant` entirely.

**Why.** Measured, not preferred:

| | Browser | Vapi |
|---|---|---|
| End to end | ~2.1–3.4s estimated | **~1,900ms measured** |
| Interruption | none — record, stop, wait | real barge-in |
| Transcript | none | live, both speakers |
| Cost | free | ~$0.09/min |

Two microphones on one screen is not two options — it is a question the reader
has to answer before they can start. And the one that lost was losing on the
requirement Ms. Maria actually stated, which was responsiveness.

**What was deliberately kept.** The *server-side* voice path is untouched and
still tested: `askAssistant` takes `mode: 'voice'`, `VOICE_BREVITY_NOTE` shortens
a spoken answer, `GROQ_VOICE_MODEL` routes one to a separate quota bucket. Vapi
bills per minute and this project has no budget; if credits run out before a
demo, the free path is a component away rather than a rewrite.

**What this costs.** A vendor now sits in the middle of a voice conversation
about private messages. That is a real change to the trust boundary and it is
the reason ADR-024 exists.

---

## ADR-024 — A caller has no session, so the tenant comes from a row we wrote

**Date:** 2026-09-11 · **Status:** Accepted

**Context.** Every read in the console knows whose data it is looking at,
because a session cookie arrives and RLS does the rest. **A Vapi tool webhook
arrives with no cookie and no user.** It is a machine caller, like Pub/Sub and
Meta.

So it runs as `service_role`, where every policy in migration 0002 is inert —
making it the third place in this system where a cross-tenant leak is possible
by application bug. `docs/04-ROADMAP.md`'s risk register rates that **Critical**,
and correctly: one tenant's private mail read aloud down a phone line to another
is not a bug you recover from.

**Decision.** Never take an owner from the payload. Match a claim against a row
this application wrote.

1. Starting a call writes `voice_call_sessions` — `(vapi_call_id, owner_id,
   expires_at)` — from a page where a real session exists.
2. The webhook reads `message.call.id` and looks it up **there**.
3. No row, or expired → every tool in the batch is refused.

**Why this shape.** It is not new. `docs/02-ARCHITECTURE.md` §2 already says an
adapter never resolves a tenant — it reports what the provider *claimed*, and
ingest matches that against `channels`. Migration 0006 added
`external_account_id` to make that lookup possible for WhatsApp. Migration 0014
is the same idea for a phone call.

**Consequences.**

- The tools in `lib/voice/tools.ts` are **separate functions**, not reuses of
  `fetchAttention`, `searchMessages` or `fetchContactDetail`. Those take no owner
  argument and rely entirely on RLS; calling them with a service client returns
  every tenant's rows. The duplication is deliberate — two paths with opposite
  security models must not share code, because sharing is how one inherits the
  other's assumptions.
- `searchMessagesForVoice` does not use the `search_messages` RPC, which is
  `SECURITY INVOKER` and takes no owner argument. An owner-filtered `ilike` is
  less clever and correct.
- A refused call says *"this call is not linked to an account"*, never *"you have
  no messages"*. The second is a lie that sounds like an answer, and the caller
  acts on it with no screen to check.

**Rejected:** passing `owner_id` in the tool arguments. The model composes those
from speech. It would have made a spoken sentence into an authorisation.

---

## ADR-025 — Transcription runs on Groq Whisper, not Gemini

**Date:** 2026-09-10 · **Status:** Accepted

**Context.** The meeting note records *"Yuri is utilizing Gemini for
audio-to-text transcription"*, and an earlier log entry found Gemini 3.8 better
than 3.5 chirp on Taglish audio. That comparison was between two Gemini models
and did not include Groq.

**Decision.** `whisper-large-v3-turbo` on Groq.

**Why.** Verified from published documentation on 2026-09-10:

| | Groq Whisper | Gemini 2.5 Flash |
|---|---|---|
| Free tier | 20 req/min · **2,000/day** · 28,800 audio-seconds/day | **~20 requests/day** (measured 2026-08-02) |
| Published? | yes | **no longer** — deferred to per-account values in AI Studio |

Twenty spoken sentences would exhaust Gemini. The Groq key already exists in
this project, and Whisper is a **different model bucket** from the assistant's
`llama-3.3-70b-versatile`, so transcription can never starve the answers — the
same failure-isolation argument ADR-003 makes, applied again.

**⚠ This is the third time a Gemini quota has moved under this project.** ADR-003
routed the assistant to Gemini on 250 requests/day and was amended when the real
number turned out to be 20. Google no longer publishes free-tier limits at all.
Treat any Gemini number in these docs as unverifiable until re-measured.

**Note.** The Vapi call does not use this. Vapi runs its own transcriber
(Sonix). Groq Whisper serves `/api/voice/transcribe`, which is the browser path
kept as the free fallback under ADR-023, and `/voice-lab`.

---

## ADR-00N — <decision in one line>

**Status:** Proposed | Accepted | Superseded by ADR-00M · YYYY-MM-DD

**Context.** What forced a choice.
**Decision.** What we're doing.
**Why.** The reasoning, including what we're trading away.
**Consequences.** What this costs us and what it commits us to.
**Rejected:** Alternatives and why not.
```

# 07 — Diagrams for the presentation

*Mermaid, so they live in the repo and cannot drift out of sync with the system
the way an exported PNG does. GitHub renders these inline; so does VS Code's
markdown preview.*

**Everything here reflects the system as deployed on 2026-08-03.** If you change
the architecture, change these in the same commit — `AGENTS.md` §4 applies to
diagrams too.

---

## 1. The system, one slide

The diagram to open with. The story it tells: **messages come in from two very
different channels, become one canonical shape, and everything downstream reads
that one shape.**

```mermaid
flowchart TB
    subgraph sources[" "]
        direction LR
        GM["📧 Gmail<br/><small>Pub/Sub push + history pull</small>"]
        WA["💬 WhatsApp<br/><small>Cloud API webhook</small>"]
    end

    subgraph vercel["▲ Vercel — serverless"]
        direction TB
        INGEST["<b>Ingest routes</b><br/><small>verify signature · insert · 200</small><br/><small>and nothing else</small>"]
        CONSOLE["<b>Console</b><br/><small>timeline · search · contacts</small><br/><small>attention · assistant</small>"]
    end

    subgraph supa["🐘 Supabase — Postgres + pgvector"]
        QUEUE[("raw_events<br/><small>the queue</small>")]
        DATA[("messages · contacts<br/>message_chunks<br/>extractions")]
    end

    subgraph azure["☁️ Azure Container Apps — always warm"]
        WORKER["<b>Worker</b><br/><small>normalize → summarise</small><br/><small>→ embed → extract</small>"]
        ONNX["<small>ONNX embedding model<br/>held in memory, 129 MB</small>"]
    end

    GROQ["🤖 Groq<br/><small>70B assistant · 8B summaries+extraction</small>"]
    CAL["📅 Google Calendar<br/><small>WRITE — user-confirmed only</small>"]
    BLOB["🗄️ Azure Blob<br/><small>attachments</small>"]

    GM -->|webhook| INGEST
    WA -->|webhook| INGEST
    INGEST -->|one row per message| QUEUE
    QUEUE -->|FOR UPDATE SKIP LOCKED| WORKER
    WORKER --- ONNX
    WORKER -->|service_role| DATA
    WORKER -.->|prompts| GROQ
    WORKER -.-> BLOB
    DATA -->|Realtime push| CONSOLE
    CONSOLE -->|user's own session · RLS| DATA
    CONSOLE -.->|questions| GROQ
    CONSOLE ==>|"on Confirm only"| CAL

    classDef edge fill:#fff5f5,stroke:#c92a2a,stroke-width:1px
    class CAL edge
```

**The three lines worth saying out loud over this slide:**

1. **Ingest does the absolute minimum.** Verify, insert, return 200. Every
   provider retries a slow webhook and eventually *disables* it, so all the slow
   work happens after the queue. This is the single most important structural
   decision in the system.
2. **The worker is warm on purpose.** It holds a 129 MB embedding model in
   memory. Serverless cannot do that, and a cold-starting container drops
   webhooks — which is exactly why the two halves live on different
   infrastructure.
3. **The red arrow is the only thing that writes outward**, and it only ever
   fires on an explicit human confirmation (ADR-010).

---

## 2. What happens to one message

The slide for *"but what actually happens when mail arrives?"* — and the one
that explains why a summary can be missing without anything being broken.

```mermaid
sequenceDiagram
    autonumber
    participant G as Gmail
    participant I as Ingest (Vercel)
    participant Q as raw_events
    participant W as Worker
    participant D as Postgres
    participant U as Console

    G->>I: push notification
    I->>I: verify OIDC token
    I->>D: look up channel → owner_id
    I->>Q: insert raw_event
    I-->>G: 200 (in milliseconds)

    W->>Q: claim (SKIP LOCKED)
    W->>G: history.list + fetch message
    W->>W: normalize → CanonicalMessage
    W->>D: upsert message + contact identity
    D-->>U: Realtime → appears on screen

    Note over W: the three AI steps, in this order
    W->>W: 1. summarise
    W->>W: 2. chunk + embed
    W->>W: 3. extract commitments/meetings
    W->>Q: mark done
```

**⚠ None of steps 11–13 can fail the event.** A summary, an embedding and an
extraction are all *additive* — if Groq is down, the mail still arrives, still
appears, still searches. That is a requirement, not a nicety.

**⚠ The order is deliberate.** Extraction runs last because summaries and
extraction share one 6,000 tokens/minute budget, and if that budget runs out
mid-batch the right thing to lose is the one nobody is looking at yet. The
consequence — that extraction is therefore the step that gets dropped — is why
`extract-catchup.ts` exists to come back for it.

---

## 3. How the assistant answers

The slide behind the demo's step 6. The point to land: **it can only say what
your messages say, and it shows you which ones.**

```mermaid
flowchart LR
    Q["Question"] --> E["Embed<br/><small>worker, local model</small>"]
    E --> M["match_chunks<br/><small>pgvector, RLS-scoped</small>"]
    M --> S["selectContext<br/><small>relative floor, top 8</small>"]
    S --> P["Build prompt"]
    P --> L["Groq 70B"]
    L --> A{"cited<br/>anything?"}
    A -->|no| R["<b>Refusal</b><br/><small>'I don't have anything<br/>about that'</small>"]
    A -->|yes| ANS["Answer + citation chips<br/><small>→ /messages/[id]</small>"]

    X[["extractions<br/><small>date window</small>"]] -.->|"ADR-020<br/>time questions only<br/><b>flag, default off</b>"| P

    classDef refusal fill:#fff5f5,stroke:#c92a2a
    class R refusal
```

**⚠ The refusal is the model's job, not a similarity threshold — and that is a
measured finding, not a preference.** ADR-007 originally specified an absolute
floor. Measured on the real corpus, the lowest *answerable* score (0.8487) sat
**below** the highest *unanswerable* one (0.8563): *"recipe for adobo"*
out-scored *"what failed in CI?"*. No threshold separates them. **ADR-016.**

**The number to quote:** the full eval on 2026-08-03 scored **answerable 6/6,
must-refuse 7/7**. Two scores, never one — a combined figure reads identically
for a prompt that refuses everything and one that answers everything.

---

## 4. Multi-tenancy, if anyone asks

The slide for the "is this actually a real system?" question — demo step 8.

```mermaid
flowchart TB
    subgraph t1["Tenant A"]
        A1["Gmail channel"] --> A2[("messages<br/>owner_id = A")]
    end
    subgraph t2["Tenant B"]
        B1["their own channels"] --> B2[("messages<br/>owner_id = B")]
    end

    RLS{{"Row Level Security<br/><small>enabled AND forced on all 11 tables</small><br/><small>USING and WITH CHECK</small>"}}

    A2 --> RLS
    B2 --> RLS
    RLS --> V["Console<br/><small>queries with the user's own session</small>"]

    W["Worker<br/><small>service_role — BYPASSES RLS</small>"] -.->|"owner_id taken from the<br/>CHANNEL, never the payload"| A2

    classDef danger fill:#fff5f5,stroke:#c92a2a,stroke-width:2px
    class W danger
```

**RLS is the security boundary, not defence in depth.** Every table denies by
default and permits only `owner_id = auth.uid()`.

**⚠ The worker is the one place a leak is possible**, because `service_role`
bypasses RLS entirely — so `owner_id` is derived from the channel being
processed and never from anything a provider sent. A CI job asserts the boundary
on every push, and it is negative-controlled: disable RLS on any table and it
exits 1 naming that table.

---

*Last updated 2026-08-03. Diagrams describe the deployed system on that date:
worker revision `--0000015`, migrations at 0011, 496 tests.*

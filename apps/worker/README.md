# apps/worker

Containerized Node → **Azure Container Apps, `minReplicas: 1`**.

Consumes `raw_events` with `SELECT ... FOR UPDATE SKIP LOCKED`, then per event:
normalize → resolve contact identity → upsert `messages` → chunk and embed →
LLM extraction.

**Deliberately not scale-to-zero.** It holds ONNX embedding weights in memory;
reloading them on every cold start would blow the "visible in under 10 seconds"
target. This is the one component that genuinely needs always-on compute, and it
is what the Azure credit pays for (~$10–15/mo, ADR-011).

⚠ **This is the one place a cross-tenant leak is possible.** The worker uses
`service_role`, which bypasses RLS entirely. Derive `owner_id` from the channel
being processed, **never** from anything in the provider payload — no policy will
catch a mistake here.

Scaffolded in Phase 0 (`docs/04-ROADMAP.md`) — currently a placeholder.

-- 0008_summary_extractions
--
-- Phase 4A: one AI-written summary per message (ADR-015).
--
-- ⭐ This is in Ms. Maria's founding request, not an addition — *"a live webapp
-- that can view whatsapp messages real time AND HAVE AI SUMMARIZE"*, 2026-07-25,
-- repeated 2026-08-01. `docs/00-CONTEXT.md` §2a carries her words verbatim.
--
-- ── Why summaries live in `extractions` and not on `messages` ────────────────
--
-- `messages` is the record of **what arrived**. A summary is a **machine's
-- opinion about it**. ADR-006 already settled that shape for derived data and
-- ADR-015 applies it here, for three consequences that all matter:
--
--   · a bad prompt can never corrupt the message record
--   · re-summarising is a delete-and-insert, not an UPDATE sweeping the corpus
--   · `extractions.model` makes "did the new prompt help?" answerable, which it
--     is not once the previous answer has been overwritten in place
--
-- The cost is a join on the timeline query. That is the cheaper side.
--
-- Applied by hand. ⚠ `drizzle-kit generate` is NOT used on this project — run
-- against the live database it proposed disabling RLS on all ten tables and
-- dropping every tenant_isolation policy. See packages/db/drizzle.config.ts.

-- ── The kind ────────────────────────────────────────────────────────────────
--
-- Dropped and recreated rather than altered: Postgres has no "add a value to a
-- CHECK" — the constraint is replaced wholesale. Named explicitly so this is
-- reversible by name rather than by hunting a generated identifier.
--
-- `not valid` is deliberately NOT used. The table holds 0 rows today and every
-- future write goes through this constraint; validating now costs nothing and
-- an unvalidated constraint is a trap for whoever reads `\d extractions` later
-- and believes it.

alter table extractions
  drop constraint if exists extractions_kind_check;

alter table extractions
  add constraint extractions_kind_check
  check (kind in ('summary', 'commitment', 'meeting', 'action_item', 'question'));

comment on column extractions.kind is
  'summary  — one per message, Phase 4A, prose shown in the opened row. '
  'commitment | meeting | action_item | question — Phase 5, structured rows '
  'feeding the "needs attention" view. A summary is not an extraction of '
  'structure; it is a paraphrase. Same table because both are derived data '
  'that may be recomputed or discarded (ADR-006).';

-- ── One summary per message ─────────────────────────────────────────────────
--
-- ⚠ Without this key, re-running summarisation writes a SECOND summary rather
-- than replacing the first, and the timeline would render both. Redelivery and
-- re-ingest are routine on this pipeline: Pub/Sub redelivers, Meta retries for
-- up to 7 days, and the backfill script exists to be run more than once.
--
-- Partial, because Phase 5's kinds are deliberately many-per-message — one
-- message can carry two commitments and a meeting. Only `summary` is singular,
-- so only `summary` is constrained.
--
-- ⚠ This index is also what makes `on conflict` legal for the upsert in
-- apps/worker/src/summarize.ts. Dropping it does not just relax a rule; it
-- breaks the write path with an "no unique or exclusion constraint matching
-- the ON CONFLICT specification" error.

create unique index if not exists extractions_message_summary_key
  on extractions (message_id)
  where kind = 'summary';

-- No RLS change. Policies are per-table and per-row on owner_id; a new
-- constraint and index inherit them. `packages/db/scripts/assert-rls.ts` still
-- has to pass, and it is what proves that on every push rather than this
-- comment.

-- 0011_extraction_runs
--
-- Phase 5: the record that a message has been through extraction (US-7, US-9).
--
-- ── The problem this exists to solve ────────────────────────────────────────
--
-- Phase 4A could ask "is this message already summarised?" because migration
-- 0008 gave `extractions` a partial unique index on (message_id) where
-- kind = 'summary'. Exactly one summary per message, so the row's presence IS
-- the answer.
--
-- Phase 5's kinds are deliberately the opposite: one message can carry two
-- commitments, a meeting and a question. There is no unique key to conflict on,
-- and — the part that actually bites — **a message that legitimately yields
-- nothing is indistinguishable from one that was never processed.** Most
-- messages in a real mailbox contain no commitment and no meeting, so "no rows"
-- is the ordinary outcome, not a failure.
--
-- Without a marker, every Pub/Sub redelivery, every Meta retry (7 days of them)
-- and every backfill run re-sends those messages to Groq to be told nothing
-- again. `apps/worker/src/summarize.ts` names that cost precisely: paying twice
-- is the mild outcome; exhausting a shared daily allowance on work already done
-- is the real one.
--
-- ── Why a table rather than a row in `extractions` ──────────────────────────
--
-- A marker `kind` was considered — widen 0008's CHECK, write one row per
-- message. Rejected: it puts a row in `extractions` that is not an extraction,
-- so every query over that table (the timeline embed, `search_messages`'s join,
-- the "needs attention" view) grows a filter whose only job is to exclude
-- bookkeeping, and one of them will eventually forget it. `extractions` means
-- "something a model found". This means "a model looked". They are different
-- facts and they get different tables.
--
-- It also makes re-running with a better prompt a clean operation: delete the
-- runs for a model, delete that model's rows, re-run. With a marker kind those
-- two deletes are the same statement and easy to get wrong.
--
-- ⚠⚠ ADDING A TABLE TO `public` MAKES CI RED UNTIL `EXPECTED_TABLES` IS
--    UPDATED. `packages/db/scripts/assert-rls.ts` fails on any table in the
--    schema it does not recognise — deliberately, so a new tenant-data table
--    cannot slip past the boundary check unnoticed (ADR-012). It is updated in
--    the same commit as this migration.
--
-- Applied by hand. ⚠ `drizzle-kit generate` is NOT used on this project — run
-- against the live database it proposed disabling RLS on all ten tables and
-- dropping every tenant_isolation policy. See packages/db/drizzle.config.ts.

create table if not exists message_extraction_runs (
  -- One run per message, so the primary key IS the idempotency guard. A second
  -- pass is an upsert, not a duplicate.
  message_id   uuid        primary key references messages(id) on delete cascade,

  -- ⚠ Carried even though only the worker writes this table, exactly as
  -- `sync_state` carries it: every table in this schema has the same RLS shape
  -- and none is a special case. A table exempted "because nothing user-facing
  -- reads it" is a table nobody checks the day something does.
  --
  -- The worker runs as `service_role` and bypasses RLS, so this value is set by
  -- application logic — derived from the message row, which took it from the
  -- channel. Never from a provider payload.
  owner_id     uuid        not null references auth.users(id) on delete cascade,

  -- Which model looked. Same reason `extractions.model` exists (ADR-006):
  -- "did the new prompt help?" is unanswerable once the previous answer has
  -- been overwritten with no record of what produced it.
  model        text        not null,

  -- How many rows that pass produced. Zero is the COMMON case and recording it
  -- is the point: it separates "extraction ran and this message contains no
  -- commitments" from "extraction has not run". Without it the table answers
  -- only half the question it exists to answer.
  rows_written integer     not null default 0 check (rows_written >= 0),

  created_at   timestamptz not null default now()
);

-- RLS policies filter on owner_id on every row of every query, so the column
-- wants an index for the same reason every other table's does.
create index if not exists message_extraction_runs_owner_idx
  on message_extraction_runs (owner_id);

comment on table message_extraction_runs is
  'One row per message that has been through the Phase 5 extraction pass. '
  'Presence means "the pass has run", which is NOT the same as "the pass found '
  'something" — rows_written = 0 is the ordinary outcome for most mail. This '
  'is what stops a redelivery or a backfill re-paying Groq for work already '
  'done; `extractions` cannot answer it because Phase 5 kinds are '
  'many-per-message by design (0008).';

-- ── RLS — the same shape as every other table (ADR-009, migration 0002) ─────
--
-- `force` matters: without it the policies do not apply to the table owner
-- role, which is a hole that only shows up under a role you did not test with.
--
-- `(select auth.uid())` rather than a bare `auth.uid()` is not cosmetic — the
-- bare call is evaluated once PER ROW, the subselect once per query.
--
-- Both USING and WITH CHECK: a policy missing WITH CHECK leaves writes
-- unrestricted while reading, from the outside, exactly like "RLS is on".
-- `assert-rls.ts` checks for both.

alter table message_extraction_runs enable row level security;
alter table message_extraction_runs force row level security;

create policy tenant_isolation on message_extraction_runs
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

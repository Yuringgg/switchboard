-- 0012_extraction_status
--
-- The "needs attention" queue becomes a board (Ms. Maria, 2026-08-05).
--
-- Her words: *"pag diyan okay din siya pero siguro palitan na lang yung way ng
-- UI niya mismo… kanban… so meron kang not started, in progress, done. So it's
-- similar to Trello."* The screen already had the right rows in the right
-- order; what it did not have was any notion of a person having *dealt with*
-- one of them.
--
-- ── ⚠ Why this is a new column and not derived from what is already here ─────
--
-- `extractions` already carries `confirmed_at` and `calendar_event_id`, and the
-- obvious cheap move is to read a confirmed meeting as "done". That is wrong,
-- and wrong in the direction that loses work: putting a meeting on a calendar
-- is the moment it becomes REAL, not the moment it stops needing attention. A
-- meeting confirmed for Friday is squarely "in progress" all week. The two
-- facts are independent and they get independent columns — the board shows
-- both, and a confirmed card still says so wherever it sits.
--
-- Deriving from `kind` is worse still: three of the four kinds are open work by
-- definition and the fourth is a question. Nothing in the row says whether a
-- human has acted.
--
-- ── ⚠ Why not a separate table ──────────────────────────────────────────────
--
-- Migration 0011 argued the opposite way for `message_extraction_runs`, so the
-- difference is worth stating. That table records **a fact about the pipeline**
-- — a model looked — which is not an extraction and would pollute every query
-- over this table with a filter that exists only to exclude bookkeeping.
--
-- This is a fact **about the extraction itself**: this particular proposal has
-- or has not been dealt with. It is one value, it is one-to-one with the row,
-- it is read by the only screen that reads these rows anyway, and a join table
-- for a single enum is a join nobody wants to write and everybody will forget
-- to make a LEFT one.
--
-- ⚠ No new table, so `packages/db/scripts/assert-rls.ts` needs no change and CI
-- stays green — unlike 0011, which added a table and made CI red until
-- `EXPECTED_TABLES` was updated in the same commit. A column inherits the
-- table's policies; `assert-rls` still proves that on every push.
--
-- Applied by hand. ⚠ `drizzle-kit generate` is NOT used on this project — run
-- against the live database it proposed disabling RLS on all ten tables and
-- dropping every tenant_isolation policy. See packages/db/drizzle.config.ts.

-- ── The column ──────────────────────────────────────────────────────────────
--
-- `not null default 'not_started'` rather than nullable, so there is exactly
-- one representation of "nobody has touched this". A nullable status invites
-- `status is null or status = 'not_started'` at every call site and one of them
-- will eventually be written as just the second half, quietly hiding every row
-- that predates this migration.
--
-- The default also backfills every existing row in one statement, which is the
-- correct starting state: nothing on this board has ever been acted on, because
-- until today there was no way to.

alter table extractions
  add column if not exists status text not null default 'not_started';

-- Dropped and recreated rather than altered: Postgres has no "add a value to a
-- CHECK". Named explicitly so this is reversible by name rather than by hunting
-- a generated identifier — the same shape migration 0008 used for
-- `extractions_kind_check`.
alter table extractions
  drop constraint if exists extractions_status_check;

alter table extractions
  add constraint extractions_status_check
  check (status in ('not_started', 'in_progress', 'done'));

comment on column extractions.status is
  'Which column of the "needs attention" board this proposal sits in. '
  'Set only by a person, never by the worker — the extraction pass writes rows '
  'and stops (ADR-010), exactly as it does for calendar events. '
  'MEANINGLESS for kind = ''summary'': those rows carry the default and no '
  'screen reads it. Independent of confirmed_at — a meeting that is on the '
  'calendar is real, which is not the same as finished.';

-- ── When it last moved ──────────────────────────────────────────────────────
--
-- The Done column needs an order, and `created_at` is the wrong one: it is when
-- the MODEL wrote the row, so a proposal extracted last week and finished this
-- morning would sort under one extracted this morning and finished a minute
-- ago. What a person wants from a Done column is "what did I just clear", which
-- is this.
--
-- Nullable, and null means "never moved". Distinct from `created_at` on
-- purpose: back-filling this to the creation time would assert that every
-- pre-existing row was moved into Not started by somebody, and nobody moved
-- anything before this migration existed.

alter table extractions
  add column if not exists status_changed_at timestamptz;

comment on column extractions.status_changed_at is
  'When a person last moved this card. NULL means never moved — which is not '
  'the same as created_at, and back-filling it to that would claim somebody '
  'acted on every row that predates migration 0012.';

-- ── Index ───────────────────────────────────────────────────────────────────
--
-- Deliberately none.
--
-- The board reads every attention row for one owner in a single query — it is
-- 100 rows at a hard limit, already filtered by `owner_id` through RLS and by
-- `kind` through an `in`, and it groups into columns in TypeScript. Postgres
-- will not use an index on `status` to answer that and adding one is pure write
-- cost on the ingest path, which is the one path in this system that must stay
-- cheap. Stated rather than left as an omission, so nobody adds it later
-- believing it was overlooked.

-- No RLS change. Policies are per-table and per-row on `owner_id`; a new column
-- inherits them, including WITH CHECK — so an UPDATE that tried to move
-- somebody else's card is rejected by the same policy that hides it from the
-- read. `packages/db/scripts/assert-rls.ts` proves that on every push rather
-- than this comment.

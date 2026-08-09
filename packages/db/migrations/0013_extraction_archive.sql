-- 0013_extraction_archive
--
-- Taking a card off the board without destroying it (Ms. Maria, 2026-08-09).
--
-- Yuri proposed a delete button — the board accumulates and reads as a pile.
-- Ms. Maria asked for archive instead, and she is right for a reason that is
-- specific to this schema rather than a general preference for soft deletes:
--
-- ⚠⚠ **A DELETED EXTRACTION DOES NOT COME BACK.** Migration 0011 records, per
--    message, that the extraction pass has run — precisely so a redelivery or a
--    backfill never re-pays Groq for work already done. So deleting a row here
--    is not "it will be re-extracted next time". The worker will skip that
--    message forever, and a commitment somebody deleted by accident is gone
--    with no record that it ever existed.
--
-- Archiving is also the honest shape for what these rows are. They are a
-- model's readings of somebody's mail, and the value of keeping them is that
-- "what did the model find, and what did the human do with it?" stays
-- answerable. A delete erases the evidence along with the noise.
--
-- ── ⚠ Why this is ONE nullable column and not a fourth status ────────────────
--
-- The obvious move is `status = 'archived'`. It is wrong, and it fails on
-- restore: the card's column would have been overwritten, so putting it back
-- would drop everything into "Not started" regardless of where it came from.
--
-- Archiving is orthogonal to which column a card is in — you can archive an
-- item you finished, and equally one the model should never have surfaced
-- (there are two promotional emails on the live board right now that produced
-- action items). Leaving `status` untouched means restore is a single
-- `archived_at = null` and the card returns exactly where it was.
--
-- ⚠ No new table, so `packages/db/scripts/assert-rls.ts` needs no change and CI
-- stays green. A column inherits the table's policies, including WITH CHECK —
-- so an UPDATE trying to archive somebody else's card is rejected by the same
-- policy that hides it from the read.
--
-- Applied by hand. ⚠ `drizzle-kit generate` is NOT used on this project — run
-- against the live database it proposed disabling RLS on all ten tables and
-- dropping every tenant_isolation policy. See packages/db/drizzle.config.ts.

alter table extractions
  add column if not exists archived_at timestamptz;

comment on column extractions.archived_at is
  'When a person took this card off the "needs attention" board. NULL means it '
  'is still on the board. Set only by a person, never by the worker — the same '
  'rule ADR-010 fixes for calendar events and 0012 for status. '
  'Deliberately independent of `status`: archiving does not overwrite which '
  'column the card was in, so restoring puts it back where it came from.';

-- ── Index ───────────────────────────────────────────────────────────────────
--
-- Deliberately none, and this is a closer call than 0012's was.
--
-- Every board read now carries `archived_at is null`, so a partial index looks
-- attractive. It is not worth it at this size: the query is already bounded to
-- 100 rows for one owner and filtered by `kind`, and Postgres will not choose
-- an index to answer that. Revisit if a single tenant's `extractions` ever
-- passes a few thousand rows — until then it is write cost on the ingest path,
-- which is the one path in this system that must stay cheap.

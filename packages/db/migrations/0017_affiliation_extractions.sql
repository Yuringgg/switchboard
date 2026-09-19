-- 0017_affiliation_extractions
--
-- Who somebody is — company, relationship, role, and whether they decide.
-- Ms. Maria's "Meeting Brief Protocols" research task (Phase 7B).
--
-- ── Why this is an extraction and not a column on `contacts` ────────────────
--
-- Because a `contacts.relationship` column can say "client" and can never say
-- **why**. The first time it is wrong there is nothing to check it against, and
-- nothing to show the reader.
--
-- This project's whole claim is that every answer points at a sentence somebody
-- actually wrote — ADR-007's asymmetry and ADR-010's "the user must see what
-- the model read before agreeing with it". An affiliation stored here earns a
-- `quote` and goes through the same hallucination check as every other item:
-- `validateExtractions` DROPS any row whose quote is not in the message body.
--
-- The per-person view is a ROLL-UP of these rows. The evidence survives it.
--
-- ⚠ It follows that one person accumulates MANY affiliation rows over time,
-- and that they can disagree — somebody changes jobs, or a first impression
-- was wrong. That is a feature: the rows are dated and quoted, so the roll-up
-- can prefer the recent one and still show the older one. Do not add a unique
-- constraint per contact; it would throw away exactly the history that makes
-- this worth storing.
--
-- ── ⚠ The constraint is the real authority ─────────────────────────────────
--
-- `EXTRACTION_KINDS` in packages/ai/src/extract.ts and this CHECK must stay in
-- step. A value in one and not the other is rejected at insert — the safe
-- direction, but a deploy-time failure rather than a compile-time one, and it
-- surfaces as "extraction silently wrote nothing" rather than as a type error.
--
-- ⚠ 0008 already replaced the original 0001 constraint to add 'summary'. This
-- replaces 0008's. The name is unchanged and was verified against the live
-- database before writing, for the same reason 0016 verified
-- `channels_type_check`: `drop constraint if exists` under a wrong name is a
-- SILENT no-op that leaves the old constraint in place.
--
-- Applied by hand. ⚠ `drizzle-kit generate` is NOT used on this project.

alter table extractions drop constraint if exists extractions_kind_check;

alter table extractions add constraint extractions_kind_check
  check (kind in (
    'summary',
    'commitment',
    'meeting',
    'action_item',
    'question',
    'affiliation'
  ));

comment on column extractions.kind is
  'summary | commitment | meeting | action_item | question | affiliation. '
  'The first five are events found IN a message. `affiliation` is a fact about '
  'a PERSON — company, relationship (client/partner/investor/broker), role, '
  'and decision-maker — stored per-message anyway so it keeps a quote and can '
  'be checked. Kept in step with EXTRACTION_KINDS in packages/ai/src/extract.ts.';

-- The attention board reads `kind` and filters archived rows, and the
-- per-person roll-up will read every affiliation for one owner. Both are
-- owner-scoped, so the existing owner index carries them; this partial index
-- is for the roll-up specifically, which is the only query that wants ALL of
-- one kind across every message.
--
-- ⚠ Partial rather than a plain index on `kind`: affiliations are expected to
-- be a small minority of rows, and an index over the whole table to find them
-- would be mostly pages of the other five kinds.
create index if not exists extractions_affiliation_idx
  on extractions (owner_id, created_at desc)
  where kind = 'affiliation';

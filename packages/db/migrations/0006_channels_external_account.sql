-- 0006_channels_external_account
--
-- WhatsApp ingest needs to answer one question in one indexed lookup: "which
-- channel — and therefore which TENANT — does this `phone_number_id` belong
-- to?" Gmail answers the equivalent question with `display_name`, because a
-- mailbox address is both the provider's identifier and the thing a human wants
-- to read. WhatsApp has two different values and they cannot be the same column:
--
--   metadata.phone_number_id      106540352242922   opaque, stable, the real key
--   metadata.display_phone_number +63 917 000 0001  formatted, for humans
--
-- Putting the id in `display_name` would print `106540352242922` on /channels as
-- the name of a connected account. Putting the display number there and looking
-- up on it would key tenant resolution on a formatted string — and Meta
-- documents that field as a display value, not an identifier. The one place
-- this system must never be approximately right is the step that decides
-- `owner_id`: the worker runs as `service_role`, so RLS is inert and no policy
-- will catch a wrong answer.
--
-- So the two jobs get two columns.
--
-- Gmail is deliberately NOT backfilled. Its lookup on `display_name` is already
-- exact, it is working in production against real mail, and a migration that
-- changes a working ingest path to tidy up a column is a risk taken for
-- symmetry. When Gmail next needs touching, `external_account_id` is where the
-- address should go.
--
-- Applied by hand. ⚠ `drizzle-kit generate` is NOT used on this project — run
-- against the live database it proposed disabling RLS on all ten tables and
-- dropping every tenant_isolation policy. See packages/db/drizzle.config.ts.

alter table channels
  add column if not exists external_account_id text;

comment on column channels.external_account_id is
  'The provider''s own identifier for this account: phone_number_id for WhatsApp. '
  'Nullable — Gmail resolves on display_name. This is a tenant lookup key: ingest '
  'matches it and takes owner_id from the row it finds, never from the payload.';

-- Globally unique per channel type, NOT per owner.
--
-- A WhatsApp business number belongs to exactly one tenant. Scoping this to
-- (owner_id, ...) would let two owners both register the same phone_number_id,
-- and the ingest lookup — which runs before any owner is known, because finding
-- the owner is its whole purpose — would then match two rows and have to pick.
-- There is no correct way to pick. The constraint makes the ambiguity
-- impossible instead of making the code choose.
--
-- Partial: Gmail channels leave this null, and NULLs are never equal in a
-- unique index, so any number of them coexist.
create unique index if not exists channels_type_external_account_key
  on channels (type, external_account_id)
  where external_account_id is not null;

-- No RLS change. Policies are per-table and per-row on owner_id; a new column
-- inherits them. `packages/db/scripts/assert-rls.ts` still has to pass, and it
-- is what proves that claim on every push rather than trusting this comment.

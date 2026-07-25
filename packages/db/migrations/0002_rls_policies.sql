-- 0002_rls_policies
--
-- ⚠ THIS FILE IS THE SECURITY BOUNDARY OF THE ENTIRE SYSTEM. ADR-009.
--
-- Not defense in depth — the boundary. Every table denies by default and
-- permits only rows the signed-in user owns. There is no application-level
-- check behind this to catch a mistake.
--
-- Every table gets the identical shape, deliberately:
--
--   alter table X enable row level security;
--   alter table X force row level security;
--   create policy tenant_isolation on X for all
--     using ((select auth.uid()) = owner_id)
--     with check ((select auth.uid()) = owner_id);
--
-- `force` matters: without it the policies do not apply to the table owner
-- role, which is a hole that only shows up under a role you didn't test with.
--
-- `(select auth.uid())` rather than a bare `auth.uid()` is not cosmetic. The
-- bare call is evaluated once PER ROW; wrapped in a subselect Postgres hoists
-- it to an InitPlan and evaluates it once per query. On a timeline scan that is
-- the difference between one call and tens of thousands.
--
-- ⚠ NONE OF THIS CONSTRAINS THE WORKER. The `service_role` key carries the
--   BYPASSRLS attribute, so the worker sees every row in every table. It must
--   set owner_id correctly itself, derived from the channel being processed and
--   never from the provider payload. The two-tenant isolation test exists
--   because this file cannot protect against that class of bug.

-- ── channels ────────────────────────────────────────────────────────────────
alter table channels enable row level security;
alter table channels force row level security;

create policy tenant_isolation on channels
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ── contacts ────────────────────────────────────────────────────────────────
alter table contacts enable row level security;
alter table contacts force row level security;

create policy tenant_isolation on contacts
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ── contact_identities ──────────────────────────────────────────────────────
alter table contact_identities enable row level security;
alter table contact_identities force row level security;

create policy tenant_isolation on contact_identities
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ── conversations ───────────────────────────────────────────────────────────
alter table conversations enable row level security;
alter table conversations force row level security;

create policy tenant_isolation on conversations
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ── messages ────────────────────────────────────────────────────────────────
alter table messages enable row level security;
alter table messages force row level security;

create policy tenant_isolation on messages
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ── message_chunks ──────────────────────────────────────────────────────────
alter table message_chunks enable row level security;
alter table message_chunks force row level security;

create policy tenant_isolation on message_chunks
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ── attachments ─────────────────────────────────────────────────────────────
alter table attachments enable row level security;
alter table attachments force row level security;

create policy tenant_isolation on attachments
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ── extractions ─────────────────────────────────────────────────────────────
alter table extractions enable row level security;
alter table extractions force row level security;

create policy tenant_isolation on extractions
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ── raw_events ──────────────────────────────────────────────────────────────
alter table raw_events enable row level security;
alter table raw_events force row level security;

create policy tenant_isolation on raw_events
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ── sync_state ──────────────────────────────────────────────────────────────
alter table sync_state enable row level security;
alter table sync_state force row level security;

create policy tenant_isolation on sync_state
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

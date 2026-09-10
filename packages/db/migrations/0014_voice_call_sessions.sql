-- 0014_voice_call_sessions
--
-- Which tenant is on the phone (voice V2, the Vapi agent).
--
-- ── ⚠⚠ THE PROBLEM THIS EXISTS TO SOLVE, STATED PLAINLY ─────────────────────
--
-- Every other read in the console knows whose data it is looking at, because a
-- session cookie arrives with the request and RLS does the rest. **A Vapi tool
-- webhook arrives with no cookie and no user.** It is a machine caller, like
-- Google's Pub/Sub push and Meta's webhook.
--
-- So the route has to run as `service_role`, which bypasses every policy in
-- 0002. That makes it the third place in this system where a cross-tenant leak
-- is possible by application bug — and `docs/04-ROADMAP.md`'s risk register
-- rates that Critical, correctly: one tenant's private mail read aloud down a
-- phone line to another tenant is not a bug you recover from.
--
-- ── The rule this table enforces ────────────────────────────────────────────
--
-- **Never take an owner from the payload. Match a claim against a row we wrote
-- ourselves.**
--
-- That is not a new rule — it is exactly what `docs/02-ARCHITECTURE.md` §2 says
-- about adapters: *"An adapter never resolves a tenant. It reports accountRef —
-- what the provider CLAIMED. Ingest matches that against `channels` and takes
-- owner_id from the row it finds."* Migration 0006 added
-- `channels.external_account_id` to make that lookup possible for WhatsApp.
-- This table is the same idea for a phone call.
--
--   1. Switchboard starts a Vapi call for a signed-in user, and writes a row
--      here: (vapi_call_id, owner_id, expires_at).
--   2. Vapi POSTs a tool call carrying `message.call.id`.
--   3. The route looks that id up HERE and takes owner_id from the row it
--      finds. Nothing in the request body can influence the answer.
--   4. No row, or expired → the tool call is refused.
--
-- ⚠ Step 4 is the whole security property. An unknown call id must fail
-- CLOSED — refusing a legitimate call is an inconvenience, answering an
-- illegitimate one is a breach.
--
-- ── Why the id is the primary key ───────────────────────────────────────────
--
-- Vapi's call id is unique and is the only stable thing shared between the
-- call and this database. Making it the key means a second insert for the same
-- call is an upsert rather than a duplicate, and — more importantly — that the
-- lookup in step 3 is a single indexed equality on the primary key, which is
-- what a webhook on a latency budget needs.
--
-- ── Why rows expire ─────────────────────────────────────────────────────────
--
-- A call id is a bearer token by another name: anyone who learns one and can
-- reach the webhook could replay it. HMAC signing (see the route) is the real
-- control, but an unbounded grant is still wrong — a row that never expires
-- means a leaked call id is valid forever. Calls last minutes; the window is
-- deliberately small and enforced in SQL rather than trusted to the caller.
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

create table if not exists voice_call_sessions (
  -- Vapi's own call id, from `message.call.id` on every tool-call webhook.
  -- Text rather than uuid: it is an opaque identifier belonging to another
  -- system, and parsing someone else's id format is a dependency on a detail
  -- they never promised to keep.
  vapi_call_id text        primary key,

  -- ⚠ THE ANSWER TO "WHOSE MESSAGES?" — and the only place the webhook may
  -- get it. Written while a real session existed; read by a route that has
  -- none.
  owner_id     uuid        not null references auth.users(id) on delete cascade,

  -- ⚠ Checked on every lookup. A call id past this point resolves to nothing
  -- and the tool call is refused. Short by design: see the note above.
  expires_at   timestamptz not null,

  created_at   timestamptz not null default now(),

  -- Bookkeeping, not authorisation. Useful for answering "did this call ever
  -- actually use a tool?" without keeping any transcript.
  last_tool_at timestamptz,

  -- An already-expired row is a row that can never do anything but be deleted,
  -- so it is a mistake worth rejecting at write time rather than debugging as
  -- a call whose every tool refuses.
  constraint voice_call_sessions_expiry_ahead check (expires_at > created_at)
);

-- The sweep query ("delete everything expired") and nothing else. The lookup
-- on the hot path uses the primary key.
create index if not exists voice_call_sessions_expires_idx
  on voice_call_sessions (expires_at);

-- RLS policies filter on owner_id on every row of every query, so the column
-- wants an index for the same reason every other table's does.
create index if not exists voice_call_sessions_owner_idx
  on voice_call_sessions (owner_id);

comment on table voice_call_sessions is
  'Maps a Vapi call id to the tenant who started it. The ONLY sanctioned way '
  'for the voice tool webhook to learn whose messages to read — it arrives '
  'with no session, runs as service_role, and must never take an owner from '
  'the request body. Same rule as channels.external_account_id for WhatsApp '
  '(0006, ADR-014): match a claim against a row we wrote, never trust the '
  'payload. Rows expire; an unknown or stale id fails closed.';

comment on column voice_call_sessions.owner_id is
  'Set while a real signed-in session existed. Read by a route that has none. '
  'A wrong value here reads one tenant''s private mail aloud to another.';

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
--
-- ⚠ These policies do NOT protect the webhook path — service_role ignores
-- them. They are here because every table in this schema has the same shape
-- and none is a special case, and because the console writes these rows
-- through the user's own session, where they do apply.

alter table voice_call_sessions enable row level security;
alter table voice_call_sessions force row level security;

create policy tenant_isolation on voice_call_sessions
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

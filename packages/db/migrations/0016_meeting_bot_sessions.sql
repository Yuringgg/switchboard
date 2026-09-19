-- 0016_meeting_bot_sessions
--
-- Meetings become a third channel, and the tenant boundary that makes their
-- webhook safe (Phase 7, ADR-026).
--
-- ── Two things happen here, and they belong together ────────────────────────
--
--   1. `channels.type` accepts 'meeting'.
--   2. `meeting_bot_sessions` maps a Recall.ai bot id to the tenant who sent it.
--
-- They are one migration because neither is useful alone: a meeting channel
-- nobody can safely deliver into is dead weight, and a session table pointing
-- at a channel type the constraint rejects cannot be written.
--
-- ── ⚠⚠ THE SAME PROBLEM AS VOICE, WITH THE SAME ANSWER ──────────────────────
--
-- A Recall.ai webhook arrives with **no cookie and no user**. It is a machine
-- caller, exactly like Vapi's tool webhook (0014), Google's Pub/Sub push, and
-- Meta's. So the route runs as `service_role`, where every policy in 0002 is
-- inert, and a wrong owner means one tenant's private meeting transcript is
-- filed into another tenant's inbox.
--
-- The rule is not new and is not being re-derived here:
--
--   **Never take an owner from the payload. Match a claim against a row we
--   wrote ourselves.**
--
-- `docs/02-ARCHITECTURE.md` §2 states it for adapters. Migration 0006 made it
-- possible for WhatsApp via `channels.external_account_id`. Migration 0014 did
-- it for a phone call via `voice_call_sessions`. This is the third instance,
-- and by now it is a pattern rather than a decision:
--
--   1. Switchboard sends a bot for a signed-in user, and writes a row here:
--      (recall_bot_id, owner_id, channel_id, expires_at).
--   2. Recall POSTs an event carrying `data.bot.id`.
--   3. The route looks that id up HERE and takes owner_id from the row it
--      finds. Nothing in the request body can influence the answer.
--   4. No row, or expired → the event is refused and nothing is written.
--
-- ⚠ Step 4 is the whole security property. An unknown bot id must fail CLOSED.
--
-- ── ⚠ `last_event_type` exists on day one, on purpose ───────────────────────
--
-- Migration 0015 added `voice_call_sessions.last_tool_name` **after** three
-- wrong guesses about why every Vapi tool was failing. The cause was a payload
-- shape that differed from the published documentation, and it was invisible
-- because a malformed request and a database outage were refused identically.
-- One column made it obvious on the first call.
--
-- Recall's payloads are equally unverified against reality here — read from
-- their docs, not from a delivery we have received. So the instrument is built
-- in before it is needed rather than after.
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

-- ── 1. Meetings are a channel ───────────────────────────────────────────────
--
-- ⚠ The constraint name is NOT guessed. `channels.type` was declared with an
-- inline CHECK in 0001, so Postgres auto-named it `<table>_<column>_check`.
-- Verified against the live database on 2026-09-18:
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.channels'::regclass and contype = 'c';
--   → channels_type_check | CHECK ((type = ANY (ARRAY['gmail'…,'whatsapp'…])))
--
-- This matters more than it looks. `drop constraint if exists` under a wrong
-- name is a SILENT no-op — the ADD would then succeed under a new name and the
-- ORIGINAL constraint would still be there, still rejecting 'meeting'. The
-- failure would surface much later as "meeting channel won't insert", nowhere
-- near this file.
alter table channels drop constraint if exists channels_type_check;

alter table channels add constraint channels_type_check
  check (type in ('gmail', 'whatsapp', 'meeting'));

comment on column channels.type is
  'gmail | whatsapp | meeting. Kept in step with CHANNEL_TYPES in '
  'packages/core/src/adapter.ts — a value in one and not the other is rejected '
  'at insert, which is the safe direction but is a deploy-time failure rather '
  'than a compile-time one.';

-- ── 2. Which tenant sent the bot ────────────────────────────────────────────

create table if not exists meeting_bot_sessions (
  -- Recall's own bot id, from `data.bot.id` on every webhook. A uuid in their
  -- API, but stored as text for the same reason 0014 stores Vapi's call id as
  -- text: it is an opaque identifier belonging to another system, and parsing
  -- someone else's id format is a dependency on a detail they never promised
  -- to keep.
  recall_bot_id   text        primary key,

  -- ⚠ THE ANSWER TO "WHOSE MEETING?" — and the only place the webhook may get
  -- it. Written while a real session existed; read by a route that has none.
  owner_id        uuid        not null references auth.users(id) on delete cascade,

  -- The 'meeting' channel this bot's output belongs in. Carried here so the
  -- webhook never has to look one up — and so it can never accidentally look
  -- up somebody else's. `raw_events.channel_id` is NOT NULL, so without this
  -- the webhook would have to resolve a channel itself, which is one more
  -- place to get a tenant wrong.
  channel_id      uuid        not null references channels(id) on delete cascade,

  -- What the bot was asked to join. Diagnostic only — never used to resolve a
  -- tenant, and never to be trusted from a payload.
  meeting_url     text,

  -- ⚠ Checked on every lookup. A bot id past this point resolves to nothing
  -- and the event is refused.
  --
  -- Longer than a voice call's hour: a meeting runs for hours and the
  -- transcript event arrives after it ends, so a short window would refuse the
  -- one delivery that carries the payload we actually want.
  --
  -- ⚠ Scheduled bots (`join_at` in the future) need this derived from the join
  -- time, not from now(). Ad-hoc only for Phase 7A.
  expires_at      timestamptz not null,

  created_at      timestamptz not null default now(),

  -- Bookkeeping and diagnosis, not authorisation. See the note at the top:
  -- these two exist before the first delivery, not after three wrong guesses.
  last_event_at   timestamptz,
  last_event_type text,

  -- An already-expired row can never do anything but be deleted, so it is a
  -- mistake worth rejecting at write time rather than debugging as a bot whose
  -- every event is refused.
  constraint meeting_bot_sessions_expiry_ahead check (expires_at > created_at)
);

-- The sweep query ("delete everything expired") and nothing else. The lookup
-- on the hot path uses the primary key.
create index if not exists meeting_bot_sessions_expires_idx
  on meeting_bot_sessions (expires_at);

-- RLS policies filter on owner_id on every row of every query, so the column
-- wants an index for the same reason every other table's does.
create index if not exists meeting_bot_sessions_owner_idx
  on meeting_bot_sessions (owner_id);

comment on table meeting_bot_sessions is
  'Maps a Recall.ai bot id to the tenant who sent it. The ONLY sanctioned way '
  'for /api/webhooks/recall to learn whose meeting it is reading — that route '
  'arrives with no session, runs as service_role, and must never take an owner '
  'from the request body. Same rule as channels.external_account_id for '
  'WhatsApp (0006, ADR-014) and voice_call_sessions for Vapi (0014, ADR-024): '
  'match a claim against a row we wrote, never trust the payload. Rows expire; '
  'an unknown or stale id fails closed.';

comment on column meeting_bot_sessions.owner_id is
  'Set while a real signed-in session existed. Read by a route that has none. '
  'A wrong value here files one tenant''s private meeting transcript into '
  'another tenant''s inbox.';

comment on column meeting_bot_sessions.last_event_type is
  'The event name as RECEIVED, recorded before it is interpreted. Exists from '
  'day one rather than added after a failure — see 0015, where the equivalent '
  'column found a payload-shape mismatch on its first delivery after three '
  'wrong guesses.';

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

alter table meeting_bot_sessions enable row level security;
alter table meeting_bot_sessions force row level security;

create policy tenant_isolation on meeting_bot_sessions
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

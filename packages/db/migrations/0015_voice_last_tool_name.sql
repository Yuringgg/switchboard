-- 0015_voice_last_tool_name
--
-- Which tool the agent actually asked for.
--
-- ── Why this exists ─────────────────────────────────────────────────────────
--
-- On the first evening of real calls, the agent kept saying it could not reach
-- the messages. Everything checkable said it should work: the deployment was
-- current, the secret was present, the call session resolved to the right
-- tenant, `last_tool_at` was stamped, the data was there, and the foreign-key
-- name the query embeds was correct.
--
-- The one fact nobody could see was **what name Vapi sent**. A tool the route
-- does not recognise and a tool that errors produce the same spoken sentence,
-- and the only record of the difference was a log line in someone else's
-- dashboard.
--
-- ⚠ This is the same lesson `/api/health/config` was built for: when two very
-- different causes present identically, the fix is an instrument, not more
-- guessing. `docs/03-RESOURCES.md` has a whole section on a limit that was
-- invisible in headers for exactly this reason.
--
-- ── What it deliberately does NOT store ─────────────────────────────────────
--
-- The tool NAME only. Never its arguments, never its result. Arguments carry
-- what somebody said out loud and results carry message content, and neither
-- belongs in a table that exists for debugging. `docs/02-ARCHITECTURE.md` §6:
-- log message IDs, never bodies.
--
-- A column rather than a new table, so `assert-rls.ts` needs no change and the
-- column inherits the table's policies (0013 made the same call for the same
-- reason).
--
-- Applied by hand. ⚠ `drizzle-kit generate` is NOT used on this project.

alter table voice_call_sessions
  add column if not exists last_tool_name text;

comment on column voice_call_sessions.last_tool_name is
  'The name of the most recent tool the voice agent asked this route to run — '
  'including one it does not recognise, which is the case this column exists '
  'to make visible. NAME ONLY: never arguments, never results. A tool the '
  'route rejects and a tool that fails sound identical to the caller, and '
  'without this the difference lives only in the provider''s dashboard.';

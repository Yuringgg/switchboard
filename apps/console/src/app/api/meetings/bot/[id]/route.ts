import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { isPlausibleBotId, recallApiBase } from '@/lib/meetings/bot-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What is that bot doing right now? (Phase 7A)
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * Recall's webhooks cannot be created on this account — their dashboard's Svix
 * portal does nothing and there is no webhook path in the public API. So the
 * console cannot be TOLD when a bot joins, records or finishes. It has to ask.
 *
 * A webhook is Recall telling us; polling is us asking. The answer is the same,
 * and `GET /bot/{id}` is public at 300/min. `/meetings` polls this while a bot
 * is still running and stops the moment it reaches a terminal state.
 *
 * ── ⚠⚠ THE TENANT CHECK IS THE WHOLE POINT OF THIS FILE ────────────────────
 *
 * A bot id is a uuid in somebody else's system. Anyone signed in could type one
 * into this URL. **So the id is never forwarded to Recall until a row in
 * `meeting_bot_sessions` says this tenant owns it.**
 *
 * That lookup runs through the user's own session, so RLS scopes it — a bot
 * belonging to another tenant returns no row and this route 404s, which is the
 * same answer a bot that never existed gets. Not 403: telling a stranger that
 * an id is real but not theirs is an enumeration oracle for nothing.
 *
 * ⚠ Rejected: taking the owner from the session and filtering by hand with the
 * service client. That would work and would move the guarantee out of Postgres
 * into this file. `/api/meetings/` has a session, so it uses it. ADR-026, and
 * the same reasoning as the POST route next door.
 */

interface RecallStatusChange {
  code?: unknown;
  created_at?: unknown;
}

/** What the page needs, and nothing else Recall happens to return. */
interface BotStatus {
  botId: string;
  code: string;
  at: string | null;
  /** True once nothing further will happen, so the page can stop polling. */
  finished: boolean;
  /** A recording exists. The transcript is a separate, later step. */
  recordings: number;
}

/**
 * Terminal states. Polling past one of these only burns rate limit.
 *
 * ⚠ `media_expired` is terminal and is NOT a failure — Recall deletes media
 * after its retention window. A bot can reach it having worked perfectly.
 */
const FINISHED = new Set([
  'done',
  'fatal',
  'media_expired',
  'analysis_done',
  'analysis_failed',
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const apiKey = process.env.RECALL_API_KEY;

  // Unset config means the feature is DISABLED, the same rule the POST route
  // and every webhook in this app follow.
  if (!apiKey) return new NextResponse('Not found', { status: 404 });

  const { id } = await params;

  // Cheap and first: a malformed id is refused before a session lookup, let
  // alone a request to a third party.
  if (!isPlausibleBotId(id)) return new NextResponse('Not found', { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  /*
   * ⚠ THE LINE THAT MAKES THIS SAFE. RLS scopes this to the signed-in user, so
   * another tenant's bot id simply is not here. No `owner_id` filter, because
   * adding one to an RLS-scoped query would imply the policy might not hold —
   * the opposite of the rule on `lib/voice/tools.ts`, which runs as
   * `service_role` where no policy applies at all.
   */
  const { data: session } = await supabase
    .from('meeting_bot_sessions')
    .select('recall_bot_id')
    .eq('recall_bot_id', id)
    .maybeSingle();

  if (!session) return new NextResponse('Not found', { status: 404 });

  let bot: Record<string, unknown>;
  try {
    // ⚠ No `Bearer`. Recall's own examples use the bare key and the prefix
    // produces a 401 that reads exactly like a wrong key.
    const response = await fetch(`${recallApiBase()}/bot/${id}/`, {
      headers: { authorization: apiKey, accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('[recall] status lookup failed', { status: response.status });
      return NextResponse.json({ error: 'Could not reach the meeting service.' }, { status: 502 });
    }

    bot = (await response.json()) as Record<string, unknown>;
  } catch {
    console.error('[recall] status lookup did not complete');
    return NextResponse.json({ error: 'Could not reach the meeting service.' }, { status: 502 });
  }

  /*
   * ⚠ The LAST status change, not a `status` field.
   *
   * `GET /bot/{id}` returns `status_changes` as an append-only history and has
   * no single current-status field. Reading `bot.status` returns undefined,
   * which would render as "unknown" forever on a bot that is working fine.
   * Read off a real bot on 2026-09-20, not from documentation.
   */
  const changes = Array.isArray(bot.status_changes)
    ? (bot.status_changes as RecallStatusChange[])
    : [];

  const latest = changes.at(-1);
  const code = typeof latest?.code === 'string' ? latest.code : 'unknown';

  const status: BotStatus = {
    botId: id,
    code,
    at: typeof latest?.created_at === 'string' ? latest.created_at : null,
    finished: FINISHED.has(code),
    recordings: Array.isArray(bot.recordings) ? bot.recordings.length : 0,
  };

  return NextResponse.json(status);
}

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The notetakers this tenant has sent.
 *
 * ⚠ RLS-scoped, so there is no `owner_id` filter and adding one would imply
 * migration 0016's policy might not be doing its job. That is the rule for
 * everything reached through `lib/supabase/server`, and the exact opposite of
 * the rule in `lib/voice/tools.ts`, which runs as `service_role` where no
 * policy applies at all. The two paths look similar and have opposite security
 * models; do not copy a query between them.
 */

export interface BotSessionRow {
  recall_bot_id: string;
  meeting_url: string | null;
  created_at: string;
  expires_at: string;
  last_event_at: string | null;
  last_event_type: string | null;
}

/**
 * Recent first, and bounded.
 *
 * ⚠ `expires_at` is NOT a filter here. An expired row can no longer accept a
 * webhook — that check lives on the ingest path — but it is still a true record
 * that a bot was sent, and hiding it would make the list disagree with what the
 * person remembers doing. The page marks it instead.
 */
export async function fetchBotSessions(
  supabase: SupabaseClient,
  { limit = 20 }: { limit?: number } = {},
): Promise<{ sessions: BotSessionRow[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('meeting_bot_sessions')
      .select('recall_bot_id, meeting_url, created_at, expires_at, last_event_at, last_event_type')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return { sessions: [], error: error.message };

    return { sessions: (data ?? []) as BotSessionRow[], error: null };
  } catch (cause) {
    // Same contract as `fetchChannels`: this is handed around as an unawaited
    // promise, and a rejection with no `await` yet attached is an unhandled
    // rejection that takes down the request.
    return {
      sessions: [],
      error: cause instanceof Error ? cause.message : 'Meetings are unavailable.',
    };
  }
}

/**
 * A meeting link, shortened for display.
 *
 * ⚠⚠ THE QUERY STRING IS DROPPED, AND THAT IS A SECURITY DECISION.
 *
 * A Zoom link carries its password in `?pwd=…`. Rendering the raw URL puts a
 * live meeting password on screen, into a screenshot, and into any recording of
 * a demo. `api/meetings/bot/route.ts` already redacts it out of error logs for
 * the same reason; this is the screen half of that.
 *
 * Host and path only, which is enough to tell two meetings apart.
 */
export function displayMeetingUrl(url: string | null): string {
  if (!url) return 'Unknown link';

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.host}${path}`;
  } catch {
    // Never render an unparseable string back to the page — it reached the
    // database before this function existed, and its shape is not guaranteed.
    return 'Unknown link';
  }
}

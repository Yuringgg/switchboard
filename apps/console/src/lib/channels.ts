import { CHANNEL_TYPES, type ChannelType } from '@switchboard/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Presentation metadata for each channel.
 *
 * Keyed by `ChannelType` from `@switchboard/core`, so adding a third channel to
 * the canonical union makes this object fail to typecheck until the console
 * accounts for it. That is the intent — a channel the UI silently can't render
 * is worse than a build error.
 */
export const CHANNEL_META: Record<
  ChannelType,
  { label: string; dotClass: string }
> = {
  gmail: { label: 'Gmail', dotClass: 'bg-channel-gmail' },
  whatsapp: { label: 'WhatsApp', dotClass: 'bg-channel-whatsapp' },
};

export const CHANNELS = CHANNEL_TYPES.map((type) => ({
  type,
  ...CHANNEL_META[type],
}));

export interface ChannelRow {
  id: string;
  type: string;
  display_name: string;
  status: string;
  last_error: string | null;
  created_at: string;
}

/**
 * Every page in the console needs the channel list: the sidebar legend reads
 * `type` and `status`, the timeline reads `id` and `type` to label each row,
 * and /channels reads all of it.
 *
 * ⚠ Fetch it ONCE per request and pass the promise down. This used to be
 * queried in the page AND again inside `AppShell`, and because the shell only
 * renders after the page's awaits resolve, the second query was a whole extra
 * sequential round trip to Singapore for data the page already had in hand.
 *
 * Returns rather than throws, because the result is handed around as an
 * unawaited promise: a rejection with no `await` yet attached is an unhandled
 * rejection, and the failure of a sidebar legend should not take down the page.
 */
export async function fetchChannels(
  supabase: SupabaseClient,
): Promise<{ channels: ChannelRow[]; error: string | null }> {
  try {
    // RLS scopes this to the signed-in user, so there is no owner_id filter —
    // adding one would imply the policy might not be doing its job.
    const { data, error } = await supabase
      .from('channels')
      .select('id, type, display_name, status, last_error, created_at')
      .order('created_at', { ascending: true });

    if (error) return { channels: [], error: error.message };

    return { channels: (data ?? []) as ChannelRow[], error: null };
  } catch (cause) {
    // supabase-js normally reports transport failures in `error`, but the
    // "never rejects" contract above has to hold for every path, not most of
    // them — an unawaited promise that throws takes down the request.
    return {
      channels: [],
      error: cause instanceof Error ? cause.message : 'Channels are unavailable.',
    };
  }
}

import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { Timeline, TimelineEmpty } from '@/components/timeline';
import { createClient } from '@/lib/supabase/server';
import { fetchTimeline } from '@/lib/timeline';

export default async function TimelinePage() {
  const supabase = await createClient();

  // Middleware already gates this route. Checked again here on purpose: the
  // page should not render a console for an unauthenticated request even if
  // middleware is ever misconfigured or bypassed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  /*
   * ⚠ NO DIRECTION FILTER — see lib/timeline.ts.
   *
   * The milestone email is one you send yourself, which is `outbound`. An
   * inbound-only query would hide it and make a working pipeline look broken.
   */
  const [{ messages, error }, { data: channels }] = await Promise.all([
    fetchTimeline(supabase),
    supabase.from('channels').select('id, type'),
  ]);

  // Channel type per message, so each row can show which platform it came from.
  const channelTypeById = new Map(
    (channels ?? []).map((c) => [c.id as string, c.type as string]),
  );

  return (
    <AppShell
      title="Timeline"
      description="Every message, every channel, in order."
      userEmail={user.email ?? 'Signed in'}
      activeHref="/"
    >
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Could not load messages: {error}
        </p>
      )}

      {messages.length > 0 ? (
        <Timeline messages={messages} channelTypeById={channelTypeById} />
      ) : (
        <TimelineEmpty connectedChannels={channels?.length ?? 0} />
      )}
    </AppShell>
  );
}

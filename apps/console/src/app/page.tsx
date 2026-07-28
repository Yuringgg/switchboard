import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AppShell } from '@/components/app-shell';
import { Callout } from '@/components/callout';
import { Timeline, TimelineEmpty, TimelineSkeleton } from '@/components/timeline';
import { fetchChannels, type ChannelRow } from '@/lib/channels';
import { createClient } from '@/lib/supabase/server';
import { fetchTimeline, type TimelineMessage } from '@/lib/timeline';

export const metadata: Metadata = { title: 'Timeline · Switchboard' };

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
   *
   * Neither promise is awaited here, on purpose. Both requests are already in
   * flight while the shell renders and streams; the message column arrives
   * behind its <Suspense> boundary. Awaiting them here would put the whole
   * frame behind another round trip to Singapore for no gain — the header and
   * the sidebar do not depend on either result.
   */
  const channels = fetchChannels(supabase);
  const timeline = fetchTimeline(supabase);

  return (
    <AppShell
      title="Timeline"
      description="Every message, every channel, in order."
      userEmail={user.email ?? 'Signed in'}
      userId={user.id}
      activeHref="/"
      channels={channels}
    >
      <Suspense fallback={<TimelineSkeleton />}>
        <TimelineSection timeline={timeline} channels={channels} />
      </Suspense>
    </AppShell>
  );
}

/**
 * Everything that has to wait for the database. Kept as its own component so
 * the boundary above it is a real streaming boundary — a `<Suspense>` whose
 * child is not async suspends on nothing.
 */
async function TimelineSection({
  timeline,
  channels,
}: {
  timeline: Promise<{ messages: TimelineMessage[]; error: string | null }>;
  channels: Promise<{ channels: ChannelRow[]; error: string | null }>;
}) {
  const [{ messages, error }, { channels: rows, error: channelsError }] =
    await Promise.all([timeline, channels]);

  // Channel type per message, so each row can show which line it came in on.
  const channelTypeById = new Map(rows.map((c) => [c.id, c.type]));

  return (
    <>
      {(error || channelsError) && (
        <Callout tone="error" role="alert" className="mb-5">
          {error
            ? `Could not load messages: ${error}`
            : 'Could not load channels, so some messages may not show which line they came in on.'}
        </Callout>
      )}

      {messages.length > 0 ? (
        <Timeline messages={messages} channelTypeById={channelTypeById} />
      ) : (
        <TimelineEmpty connectedTypes={rows.map((c) => c.type)} />
      )}
    </>
  );
}

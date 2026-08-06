import { CHANNEL_TYPES } from '@switchboard/core';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AppShell } from '@/components/app-shell';
import { Callout } from '@/components/callout';
import {
  Timeline,
  TimelineEmpty,
  TimelineSkeleton,
  TimelineSplit,
} from '@/components/timeline';
import { TimelineFilter } from '@/components/timeline-filter';
import { fetchChannels, type ChannelRow } from '@/lib/channels';
import { createClient } from '@/lib/supabase/server';
import { fetchTimeline, parseChannelFilter } from '@/lib/timeline';

export const metadata: Metadata = { title: 'Timeline · Switchboard' };

type TimelineResult = ReturnType<typeof fetchTimeline>;
type ChannelsResult = Promise<{ channels: ChannelRow[]; error: string | null }>;

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{
    /** `?channel=gmail`, repeatable. See `parseChannelFilter` in lib/timeline.ts. */
    channel?: string | string[];
    /** `?view=merged` — anything else, including absent, is the split layout. */
    view?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  // Middleware already gates this route. Checked again here on purpose: the
  // page should not render a console for an unauthenticated request even if
  // middleware is ever misconfigured or bypassed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // `/welcome`, matching `proxy.ts` — the root's unauthenticated destination is
  // the landing page in both guards, so the two cannot disagree about what a
  // stranger sees.
  if (!user) redirect('/welcome');

  /*
   * ⚠ NO DIRECTION FILTER — see lib/timeline.ts.
   *
   * The milestone email is one you send yourself, which is `outbound`. An
   * inbound-only query would hide it and make a working pipeline look broken.
   *
   * The CHANNEL filter is a different thing and is new (Ms. Maria, 2026-08-05):
   * it is asked for explicitly, it is stated in the URL, and the empty state
   * says which empty it is. Hiding a whole direction silently is what is
   * forbidden — narrowing the view on request is not.
   */
  const selectedTypes = parseChannelFilter(params.channel, CHANNEL_TYPES);

  /*
   * ⚠ SPLIT IS THE DEFAULT, and that is a decision worth flagging to whoever
   * reads this next.
   *
   * The merged record is this product's central claim — many lines in, one
   * operator's view out — and it is what Ms. Maria reviewed. Defaulting to two
   * columns puts that claim one click away rather than on screen. Yuri asked
   * for it directly on 2026-08-06 ("left side is gmail, right side is
   * whatsapp… they are separate and all") and it is the chief's call, but the
   * merged view is the one to open for a demo. `?view=merged`.
   *
   * Read permissively: only the exact string `merged` selects it, so a typo or
   * a stale link lands on the default rather than on a blank screen.
   */
  const view: 'merged' | 'split' = params.view === 'merged' ? 'merged' : 'split';

  const channels = fetchChannels(supabase);

  /*
   * ⚠ The unfiltered query starts HERE, unawaited, exactly as it always has —
   * in flight beside `channels` while the shell renders and streams.
   *
   * A filtered one cannot: the URL carries channel *types* and `messages` is
   * keyed by channel *id*, so the filter has to wait for `fetchChannels` to
   * resolve one into the other. That is one extra sequential round trip to
   * Singapore, and it is why this is a branch rather than one tidy code path —
   * the common case is the unfiltered timeline and it must not pay for a
   * feature it is not using.
   */
  const unfiltered: TimelineResult | null =
    selectedTypes.length === 0 ? fetchTimeline(supabase) : null;

  return (
    <AppShell
      title="Timeline"
      description="Every message, every channel, in order."
      userEmail={user.email ?? 'Signed in'}
      userId={user.id}
      activeHref="/"
      channels={channels}
    >
      {/*
        Outside the message column's boundary and in one of its own: the filter
        depends only on the channel list, which resolves well before the
        messages do. Inside, it would appear at the same moment as the results
        it is meant to control.
      */}
      <Suspense fallback={<FilterFallback />}>
        <Filter channels={channels} selectedTypes={selectedTypes} view={view} />
      </Suspense>

      {/*
        ⚠ Keyed on the filter. Without a key React reuses this boundary across
        the navigation, so switching lines keeps showing the PREVIOUS list until
        the new query lands rather than the skeleton — which reads as the filter
        having done nothing for as long as the round trip takes.
      */}
      <Suspense key={selectedTypes.join()} fallback={<TimelineSkeleton />}>
        <TimelineSection
          supabase={supabase}
          channels={channels}
          selectedTypes={selectedTypes}
          unfiltered={unfiltered}
          view={view}
        />
      </Suspense>
    </AppShell>
  );
}

/** The chips. Needs the channel list and nothing else. */
async function Filter({
  channels,
  selectedTypes,
  view,
}: {
  channels: ChannelsResult;
  selectedTypes: string[];
  view: 'merged' | 'split';
}) {
  const { channels: rows } = await channels;

  return (
    <TimelineFilter
      selected={selectedTypes}
      connectedTypes={[...new Set(rows.map((c) => c.type))]}
      view={view}
    />
  );
}

/** Holds the filter row's height so the list below does not jump when it lands. */
function FilterFallback() {
  return <div className="mb-6 h-[26px]" aria-hidden />;
}

/**
 * Everything that has to wait for the database. Kept as its own component so
 * the boundary above it is a real streaming boundary — a `<Suspense>` whose
 * child is not async suspends on nothing.
 */
async function TimelineSection({
  supabase,
  channels,
  selectedTypes,
  unfiltered,
  view,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  channels: ChannelsResult;
  selectedTypes: string[];
  /** Already in flight when no filter is applied; null when one is. */
  unfiltered: TimelineResult | null;
  view: 'merged' | 'split';
}) {
  const { channels: rows, error: channelsError } = await channels;

  const { messages, truncated, error } = await (unfiltered ??
    fetchTimeline(supabase, {
      // ⚠ May legitimately be empty — filtering to a channel the reader has not
      // connected. `fetchTimeline` returns nothing for that rather than
      // treating it as "no filter"; see the note there.
      channelIds: rows.filter((c) => selectedTypes.includes(c.type)).map((c) => c.id),
    }));

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
        view === 'split' ? (
          <TimelineSplit
            messages={messages}
            channelTypeById={channelTypeById}
            truncated={truncated}
          />
        ) : (
          <Timeline
            messages={messages}
            channelTypeById={channelTypeById}
            truncated={truncated}
          />
        )
      ) : (
        <TimelineEmpty
          connectedTypes={[...new Set(rows.map((c) => c.type))]}
          filteredTo={selectedTypes}
        />
      )}
    </>
  );
}

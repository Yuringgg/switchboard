import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { Callout } from '@/components/callout';
import { ChannelList, ChannelListSkeleton } from '@/components/channel-list';
import { PageFrame } from '@/components/page-frame';
import { fetchChannels, type ChannelRow } from '@/lib/channels';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Channels · Switchboard' };

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/channels');

  // The sidebar's legend has its own copy (the layout's). Not awaited here — the
  // header does not depend on it, so it should not wait for it.
  const channels = fetchChannels(supabase);

  return (
    <PageFrame
      title="Channels"
      description="Connect an account and its messages flow into the timeline."
    >
      {connected && (
        <Callout tone="success" role="status" className="mb-5">
          Connected <span className="font-mono">{connected}</span>. Mail lands in
          the <Link href="/">timeline</Link> within seconds of arriving.
        </Callout>
      )}

      {error && (
        <Callout tone="error" role="alert" className="mb-5">
          {error}
        </Callout>
      )}

      <Suspense fallback={<ChannelListSkeleton />}>
        <ChannelSection channels={channels} />
      </Suspense>
    </PageFrame>
  );
}

/**
 * Kept as its own async component so the boundary above it is a real streaming
 * boundary — a `<Suspense>` whose child is not async suspends on nothing.
 */
async function ChannelSection({
  channels,
}: {
  channels: Promise<{ channels: ChannelRow[]; error: string | null }>;
}) {
  const { channels: rows, error } = await channels;
  return <ChannelList rows={rows} error={error} />;
}

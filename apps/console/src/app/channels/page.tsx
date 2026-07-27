import { CHANNEL_TYPES } from '@switchboard/core';
import { Plug } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AppShell } from '@/components/app-shell';
import { CHANNELS, fetchChannels, type ChannelRow } from '@/lib/channels';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

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

  // One query, shared with the shell's channel legend. Not awaited here — the
  // frame does not depend on it, so it should not wait for it.
  const channels = fetchChannels(supabase);

  return (
    <AppShell
      title="Channels"
      description="Connect an account and its messages flow into the timeline."
      userEmail={user.email ?? 'Signed in'}
      userId={user.id}
      activeHref="/channels"
      channels={channels}
    >
      {connected && (
        <p
          role="status"
          className="mb-5 rounded-md border border-border bg-panel px-3 py-2 text-sm"
        >
          Connected <span className="font-mono">{connected}</span>. Messages will
          appear in the timeline shortly.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <Suspense fallback={<ChannelListSkeleton />}>
        <ChannelList channels={channels} />
      </Suspense>
    </AppShell>
  );
}

async function ChannelList({
  channels,
}: {
  channels: Promise<{ channels: ChannelRow[]; error: string | null }>;
}) {
  const { channels: rows, error } = await channels;

  return (
    <>
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Could not load channels.
        </p>
      )}

      <ul className="space-y-2.5">
        {CHANNEL_TYPES.map((type) => {
          const meta = CHANNELS.find((c) => c.type === type);
          const connectedChannels = rows.filter((c) => c.type === type);
          const isGmail = type === 'gmail';

          return (
            <li
              key={type}
              className="rounded-lg border border-border bg-panel px-4 py-3.5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    meta?.dotClass,
                    connectedChannels.length === 0 && 'opacity-30',
                  )}
                  aria-hidden
                />
                <span className="text-sm font-medium">{meta?.label ?? type}</span>

                {isGmail ? (
                  <a
                    href="/api/auth/google/start"
                    className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    <Plug className="size-3.5" aria-hidden />
                    {connectedChannels.length > 0 ? 'Reconnect' : 'Connect'}
                  </a>
                ) : (
                  <span className="ml-auto font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
                    Admin-provisioned
                  </span>
                )}
              </div>

              {connectedChannels.length > 0 ? (
                <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                  {connectedChannels.map((channel) => (
                    <li
                      key={channel.id}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {channel.display_name}
                      </span>
                      <span
                        className={cn(
                          'font-mono text-[10px] tracking-[0.12em] uppercase',
                          channel.status === 'active'
                            ? 'text-muted-foreground/70'
                            : 'text-destructive',
                        )}
                      >
                        {channel.status}
                      </span>
                      {channel.last_error && (
                        <span className="text-xs text-destructive">
                          {channel.last_error}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {isGmail
                    ? 'Not connected. Reads your inbox; nothing is ever sent.'
                    : 'Numbers belong to the business, so these are assigned rather than self-connected.'}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ChannelListSkeleton() {
  return (
    <ul className="space-y-2.5" aria-hidden>
      {CHANNEL_TYPES.map((type) => (
        <li
          key={type}
          className="rounded-lg border border-border bg-panel px-4 py-3.5"
        >
          <div className="flex animate-pulse items-center gap-3">
            <span className="size-2 shrink-0 rounded-full bg-muted-foreground/20" />
            <span className="h-3.5 w-20 rounded bg-muted-foreground/15" />
            <span className="ml-auto h-8 w-24 rounded-md bg-muted-foreground/10" />
          </div>
          <span className="mt-3 block h-3 w-2/3 animate-pulse rounded bg-muted-foreground/10" />
        </li>
      ))}
    </ul>
  );
}

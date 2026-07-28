import { CHANNEL_TYPES } from '@switchboard/core';
import { Plug } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AppShell } from '@/components/app-shell';
import { Callout } from '@/components/callout';
import { CHANNELS, fetchChannels, type ChannelRow } from '@/lib/channels';
import { createClient } from '@/lib/supabase/server';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Channels · Switchboard' };

/**
 * What each channel is and how it gets here.
 *
 * Written from the reader's side of the screen, not the system's. WhatsApp's
 * row used to say "Admin-provisioned", which is the shape of the database
 * record rather than anything a person can act on — the useful facts are that
 * you cannot connect one yourself and why.
 */
const COPY: Record<string, { does: string; unconnected: string }> = {
  gmail: {
    does: 'Reads your inbox. Nothing is ever sent on your behalf.',
    unconnected: 'Connect an account and its mail starts arriving in the timeline.',
  },
  whatsapp: {
    does: 'Receives messages sent to a business number.',
    unconnected:
      'Numbers belong to the business, so an admin assigns one to you rather than you connecting it here.',
  },
};

/** `channels.status` is a database enum. This is what a person should read. */
const STATUS: Record<string, { label: string; tone: 'ok' | 'bad' }> = {
  active: { label: 'Connected', tone: 'ok' },
  paused: { label: 'Paused', tone: 'ok' },
  error: { label: 'Needs attention', tone: 'bad' },
};

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
        <Callout tone="error" role="alert" className="mb-5">
          Could not load your channels. Reload the page to try again.
        </Callout>
      )}

      <ul className="space-y-3">
        {CHANNEL_TYPES.map((type) => {
          const meta = CHANNELS.find((c) => c.type === type);
          const connectedChannels = rows.filter((c) => c.type === type);
          const copy = COPY[type];
          const isGmail = type === 'gmail';

          return (
            <li
              key={type}
              className="overflow-hidden rounded-lg border border-border bg-panel"
            >
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-4">
                <span
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    connectedChannels.length === 0 ? 'bg-faint' : meta?.dotClass,
                  )}
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                  <h2 className="text-subject font-medium">{meta?.label ?? type}</h2>
                  <p className="mt-1 max-w-[52ch] text-note text-muted-foreground">
                    {connectedChannels.length > 0 ? copy?.does : copy?.unconnected}
                  </p>
                </div>

                {isGmail ? (
                  // A real navigation, not a fetch: this hands the browser to
                  // Google's consent screen.
                  <a
                    href="/api/auth/google/start"
                    className={buttonClass({
                      variant: connectedChannels.length > 0 ? 'subtle' : 'primary',
                      size: 'sm',
                    })}
                  >
                    <Plug className="size-3.5" aria-hidden />
                    {connectedChannels.length > 0 ? 'Reconnect' : 'Connect'}
                  </a>
                ) : (
                  <span className={cn(LABEL, 'mt-1.5')}>Assigned by an admin</span>
                )}
              </div>

              {connectedChannels.length > 0 && (
                <ul className="border-t border-border">
                  {connectedChannels.map((channel) => {
                    const status = STATUS[channel.status] ?? {
                      label: channel.status,
                      tone: 'bad' as const,
                    };

                    return (
                      <li
                        key={channel.id}
                        className="px-4 py-3 [&:not(:last-child)]:border-b"
                      >
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="min-w-0 truncate font-mono text-meta">
                            {channel.display_name}
                          </span>
                          <span
                            className={cn(
                              'ml-auto font-mono text-label uppercase',
                              status.tone === 'bad'
                                ? 'text-destructive'
                                : 'text-muted-foreground',
                            )}
                          >
                            {status.label}
                          </span>
                        </div>

                        {/*
                          The renewal sweep writes the reason here when a watch
                          fails, and this is the only screen it surfaces on —
                          so it gets stated plainly rather than tucked in as a
                          red fragment at the end of a row.
                        */}
                        {channel.last_error && (
                          <p className="mt-2 text-note text-destructive">
                            {channel.last_error}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
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
    <ul className="space-y-3" aria-hidden>
      {CHANNEL_TYPES.map((type) => (
        <li key={type} className="rounded-lg border border-border bg-panel px-4 py-4">
          <div className="flex animate-pulse items-start gap-3">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-faint" />
            <div className="min-w-0 flex-1">
              <span className="block h-3.5 w-24 rounded bg-faint/60" />
              <span className="mt-2.5 block h-3 w-3/5 rounded bg-faint/40" />
            </div>
            <span className="h-8 w-24 rounded-md bg-faint/40" />
          </div>
        </li>
      ))}
      <span className="sr-only">Loading channels</span>
    </ul>
  );
}

import { CHANNEL_TYPES } from '@switchboard/core';
import { Plug } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { CHANNELS } from '@/lib/channels';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Channels · Switchboard' };

interface ChannelRow {
  id: string;
  type: string;
  display_name: string;
  status: string;
  last_error: string | null;
  created_at: string;
}

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

  // RLS scopes this to the signed-in user; no owner_id filter is needed, and
  // adding one would imply the policy might not be doing its job.
  const { data, error: queryError } = await supabase
    .from('channels')
    .select('id, type, display_name, status, last_error, created_at')
    .order('created_at', { ascending: true });

  const channels = (data ?? []) as ChannelRow[];

  return (
    <AppShell
      title="Channels"
      description="Connect an account and its messages flow into the timeline."
      userEmail={user.email ?? 'Signed in'}
      activeHref="/channels"
    >
      {connected && (
        <p
          role="status"
          className="mb-5 rounded-md border border-border bg-card px-3 py-2 text-sm"
        >
          Connected <span className="font-medium">{connected}</span>. Messages will
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

      {queryError && (
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
          const connectedChannels = channels.filter((c) => c.type === type);
          const isGmail = type === 'gmail';

          return (
            <li
              key={type}
              className="rounded-lg border border-border px-4 py-3.5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={cn('size-2 shrink-0 rounded-full', meta?.dotClass)}
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
                  <span className="ml-auto text-xs text-muted-foreground">
                    Admin-provisioned
                  </span>
                )}
              </div>

              {connectedChannels.length > 0 ? (
                <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                  {connectedChannels.map((channel) => (
                    <li key={channel.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{channel.display_name}</span>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[11px]',
                          channel.status === 'active'
                            ? 'bg-accent text-accent-foreground'
                            : 'bg-destructive/10 text-destructive',
                        )}
                      >
                        {channel.status}
                      </span>
                      {channel.last_error && (
                        <span className="text-xs text-destructive">{channel.last_error}</span>
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
    </AppShell>
  );
}

import { CHANNEL_TYPES } from '@switchboard/core';
import { Plug } from 'lucide-react';

import { Callout } from '@/components/callout';
import { CHANNELS, type ChannelRow } from '@/lib/channels';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The channel list.
 *
 * Lives here rather than inside `app/channels/page.tsx` so the design preview
 * can render it too. It was the one screen in the console nobody could look at
 * without signing in AND having connected an account — which is exactly the
 * screen you cannot design blind, since it holds the Connect button and every
 * error the ingest pipeline surfaces to a person.
 */

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

export function ChannelList({
  rows,
  error,
}: {
  rows: ChannelRow[];
  error: string | null;
}) {
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
          const connected = rows.filter((c) => c.type === type);
          const copy = COPY[type];
          const isGmail = type === 'gmail';

          return (
            <li
              key={type}
              className="overflow-hidden rounded-lg border border-border bg-panel"
            >
              <div className="flex flex-wrap items-start gap-x-3 gap-y-3 px-4 py-4">
                <span
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    connected.length === 0 ? 'bg-faint' : meta?.dotClass,
                  )}
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                  <h2 className="text-subject font-medium">{meta?.label ?? type}</h2>
                  <p className="mt-1 max-w-[52ch] text-note text-muted-foreground">
                    {connected.length > 0 ? copy?.does : copy?.unconnected}
                  </p>
                </div>

                {isGmail ? (
                  // A real navigation, not a fetch: this hands the browser to
                  // Google's consent screen.
                  <a
                    href="/api/auth/google/start"
                    className={buttonClass({
                      variant: connected.length > 0 ? 'subtle' : 'primary',
                      size: 'sm',
                    })}
                  >
                    <Plug className="size-3.5" aria-hidden />
                    {connected.length > 0 ? 'Reconnect' : 'Connect'}
                  </a>
                ) : (
                  <span className={cn(LABEL, 'mt-1.5')}>Assigned by an admin</span>
                )}
              </div>

              {connected.length > 0 && (
                <ul className="border-t border-border">
                  {connected.map((channel) => {
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
                          fails, and this is the only screen it surfaces on — so
                          it gets stated plainly rather than tucked in as a red
                          fragment at the end of a row.
                        */}
                        {channel.last_error && (
                          <Callout tone="error" role="status" className="mt-2.5">
                            {channel.last_error}
                          </Callout>
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

export function ChannelListSkeleton() {
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

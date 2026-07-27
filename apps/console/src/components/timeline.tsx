import { Inbox } from 'lucide-react';

import { CHANNELS } from '@/lib/channels';
import { groupByDay, preview, type TimelineMessage } from '@/lib/timeline';
import { cn } from '@/lib/utils';

/**
 * The timeline.
 *
 * Renders BOTH directions — see lib/timeline.ts for why filtering to inbound
 * would hide the demo message.
 */
export function Timeline({
  messages,
  channelTypeById,
}: {
  messages: TimelineMessage[];
  channelTypeById: Map<string, string>;
}) {
  const days = groupByDay(messages);

  return (
    <div className="space-y-7">
      {days.map((day) => (
        <section key={day.date}>
          <h2 className="mb-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <time dateTime={day.date}>{formatDay(day.date)}</time>
          </h2>

          <ul className="space-y-1.5">
            {day.messages.map((message) => {
              const channelType = channelTypeById.get(message.channel_id);
              const channel = CHANNELS.find((c) => c.type === channelType);
              const outbound = message.direction === 'outbound';

              return (
                <li
                  key={message.id}
                  className="rounded-lg border border-border px-3.5 py-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span
                      className={cn('size-1.5 shrink-0 self-center rounded-full', channel?.dotClass)}
                      aria-hidden
                    />
                    <span className="text-sm font-medium">
                      {outbound
                        ? 'You'
                        : (message.sender?.display_name ??
                          message.sender?.external_id ??
                          'Unknown sender')}
                    </span>

                    {/* Direction is shown, never filtered on. A self-sent
                        message is outbound and must still appear. */}
                    {outbound && (
                      <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] tracking-wide text-accent-foreground uppercase">
                        Sent
                      </span>
                    )}

                    <time
                      dateTime={message.sent_at}
                      className="ml-auto shrink-0 text-xs text-muted-foreground"
                    >
                      {formatTime(message.sent_at)}
                    </time>
                  </div>

                  <p className="mt-1.5 text-sm">
                    {message.subject ?? (
                      <span className="text-muted-foreground italic">No subject</span>
                    )}
                  </p>

                  {preview(message.body_text) && (
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {preview(message.body_text)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Empty state that says WHICH empty it is.
 *
 * The previous version looked identical whether a channel was connected and
 * working or nothing was connected at all — which cost a real debugging
 * session, because "no messages" reads as "broken" when you have just
 * connected an account and sent yourself mail.
 */
export function TimelineEmpty({ connectedChannels }: { connectedChannels: number }) {
  const connected = connectedChannels > 0;

  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border border-border">
        <Inbox className="size-5 text-muted-foreground" aria-hidden />
      </div>

      <h2 className="mt-4 text-base font-medium">
        {connected ? 'Waiting for messages' : 'No messages yet'}
      </h2>

      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        {connected
          ? 'Your channel is connected and listening. New mail appears here within a few seconds of arriving.'
          : 'Connect a channel and everything you receive lands here in one timeline, whichever app it came from.'}
      </p>

      {!connected && (
        <a
          href="/channels"
          className="mt-5 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          Connect a channel
        </a>
      )}
    </div>
  );
}

function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));

  const todayIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  if (isoDate === todayIso) return 'Today';

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

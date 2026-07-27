import { Inbox } from 'lucide-react';
import Link from 'next/link';

import { NewMessages } from '@/components/live';
import { CHANNELS } from '@/lib/channels';
import { groupByDay, preview, type TimelineMessage } from '@/lib/timeline';
import { cn } from '@/lib/utils';

/**
 * The timeline.
 *
 * ── The one idea this screen is built on ─────────────────────────────────────
 *
 * A cross-channel console has exactly one job the individual apps don't do:
 * show messages from different places as a single ordered record, without
 * losing track of which line each one came in on. So the day's messages hang
 * off a continuous line, and each message is a lamp on it, coloured by its
 * channel. Channel identity is carried by the structure rather than by a badge
 * bolted onto the row, which means it survives being skimmed.
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
    <div>
      {/* Takes no height: an arrival must never move what you are reading. */}
      <NewMessages />

      <div className="space-y-6">
        {days.map((day) => (
          <section key={day.date}>
            <h2 className="sticky top-0 z-10 -mx-1 mb-2.5 flex items-center gap-3 bg-background px-1 py-2">
              <time
                dateTime={day.date}
                className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase"
              >
                {formatDay(day.date)}
              </time>
              <span className="h-px flex-1 bg-border" aria-hidden />
              {/* Zero-padded: a ledger column that doesn't reflow at ten. */}
              <span
                className="font-mono text-[10px] text-muted-foreground/60"
                aria-label={`${day.messages.length} messages`}
              >
                {String(day.messages.length).padStart(2, '0')}
              </span>
            </h2>

            <ul>
              {day.messages.map((message) => {
                const channelType = channelTypeById.get(message.channel_id);
                const channel = CHANNELS.find((c) => c.type === channelType);
                const outbound = message.direction === 'outbound';

                const name = outbound ? 'You' : (message.sender?.display_name ?? null);
                const address = message.sender?.external_id ?? null;
                const line = preview(message.body_text);

                return (
                  <li key={message.id} className="group relative flex gap-3.5">
                    {/* The line, and this message's lamp on it. */}
                    <span
                      className="relative flex w-2 shrink-0 justify-center"
                      aria-hidden
                    >
                      <span className="absolute top-0 bottom-0 w-px bg-border group-last:bottom-auto group-last:h-5" />
                      <span
                        className={cn(
                          'absolute top-[7px] size-[7px] rounded-full ring-[3px] ring-background',
                          channel?.dotClass ?? 'bg-muted-foreground/40',
                        )}
                      />
                    </span>

                    <div className="min-w-0 flex-1 pb-5">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-[13.5px] font-medium">
                          {name ?? address ?? 'Unknown sender'}
                        </span>

                        {name && address && (
                          <span className="hidden truncate font-mono text-[11px] text-muted-foreground/70 sm:inline">
                            {address}
                          </span>
                        )}

                        {/* Direction is shown, never filtered on. A self-sent
                            message is outbound and must still appear. */}
                        {outbound && (
                          <span className="shrink-0 font-mono text-[9.5px] tracking-[0.14em] text-muted-foreground uppercase">
                            sent
                          </span>
                        )}

                        <time
                          dateTime={message.sent_at}
                          className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground"
                        >
                          {formatTime(message.sent_at)}
                        </time>
                      </div>

                      <p className="mt-1 text-[14px] leading-snug">
                        {message.subject ?? (
                          <span className="text-muted-foreground italic">No subject</span>
                        )}
                      </p>

                      {line && (
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                          {line}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * Empty state that says WHICH empty it is.
 *
 * The previous version looked identical whether a channel was connected and
 * working or nothing was connected at all — which cost a real debugging
 * session, because "no messages" reads as "broken" when you have just
 * connected an account and sent yourself mail. The two must never converge:
 * one of them means wait, the other means act.
 */
export function TimelineEmpty({ connectedTypes }: { connectedTypes: string[] }) {
  const connected = connectedTypes.length > 0;

  const names = CHANNELS.filter((c) => connectedTypes.includes(c.type)).map(
    (c) => c.label,
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      {connected ? (
        <span
          className="flex size-11 items-center justify-center rounded-xl border border-border bg-panel"
          aria-hidden
        >
          <span className="animate-lamp size-2 rounded-full bg-live" />
        </span>
      ) : (
        <span
          className="flex size-11 items-center justify-center rounded-xl border border-border bg-panel"
          aria-hidden
        >
          <Inbox className="size-5 text-muted-foreground" />
        </span>
      )}

      <h2 className="mt-4 text-[15px] font-medium">
        {connected ? 'Listening' : 'No messages yet'}
      </h2>

      <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-balance text-muted-foreground">
        {connected
          ? `${formatList(names)} ${names.length === 1 ? 'is' : 'are'} connected. New mail appears here within seconds of arriving — you won't need to refresh.`
          : 'Connect a channel and everything you receive lands here in one timeline, whichever app it came from.'}
      </p>

      {!connected && (
        <Link
          href="/channels"
          className="mt-5 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          Connect a channel
        </Link>
      )}
    </div>
  );
}

/**
 * What the shell shows while the messages are still in flight.
 *
 * Deliberately the same geometry as a real row — line, lamp, three bars. A
 * skeleton whose shape doesn't match what replaces it produces a visible jump,
 * which costs back the calm the streaming was for.
 */
export function TimelineSkeleton() {
  return (
    <div aria-hidden>
      <div className="mb-2.5 flex items-center gap-3 py-2">
        <span className="h-2.5 w-14 rounded bg-muted-foreground/15" />
        <span className="h-px flex-1 bg-border" />
      </div>

      <ul>
        {[0, 1, 2].map((i) => (
          <li key={i} className="group relative flex gap-3.5">
            <span className="relative flex w-2 shrink-0 justify-center">
              <span className="absolute top-0 bottom-0 w-px bg-border group-last:bottom-auto group-last:h-5" />
              <span className="absolute top-[7px] size-[7px] rounded-full bg-muted-foreground/20 ring-[3px] ring-background" />
            </span>

            <div className="flex-1 animate-pulse pb-5">
              <div className="flex items-baseline gap-2">
                <span className="h-3 w-28 rounded bg-muted-foreground/15" />
                <span className="ml-auto h-3 w-10 rounded bg-muted-foreground/10" />
              </div>
              <span className="mt-2 block h-3.5 w-2/3 rounded bg-muted-foreground/15" />
              <span className="mt-1.5 block h-3 w-1/2 rounded bg-muted-foreground/10" />
            </div>
          </li>
        ))}
      </ul>

      <span className="sr-only">Loading messages</span>
    </div>
  );
}

/** "Gmail" · "Gmail and WhatsApp" — no serial comma needed at two channels. */
function formatList(items: string[]): string {
  if (items.length === 0) return 'Nothing';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
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

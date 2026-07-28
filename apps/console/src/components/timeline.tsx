import { Inbox, Radio } from 'lucide-react';
import Link from 'next/link';

import { NewMessages } from '@/components/live';
import { MessageRow } from '@/components/message-row';
import { CHANNELS } from '@/lib/channels';
import { channelChangePoints, groupByDay, type TimelineMessage } from '@/lib/timeline';
import { buttonClass, LABEL } from '@/lib/ui';
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
 * channel — many lines in, one operator's view out, which is the name and the
 * whole design.
 *
 * Channel identity is carried by the structure rather than by a badge bolted
 * onto every row, which means it survives being skimmed. It is *also* carried
 * in words the moment the line changes, because a colour on its own is not
 * something every reader can see — `channelChangePoints` in lib/timeline.ts
 * explains that at length and it is the more important half.
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

  // Computed over the flat ordered list, before grouping: a day boundary is
  // not a change of channel.
  const changePoints = channelChangePoints(messages, channelTypeById);

  return (
    <div>
      {/* Takes no height: an arrival must never move what you are reading. */}
      <NewMessages />

      <div className="space-y-7">
        {days.map((day) => (
          <section key={day.date}>
            {/*
              Sticky, and inset wider than the content so the lamp's background
              ring scrolls under it cleanly rather than clipping at the column
              edge.
            */}
            <h2 className="sticky top-0 z-10 -mx-3 mb-3 flex items-center gap-3 bg-background px-3 py-2">
              <time dateTime={day.date} className={LABEL}>
                {formatDay(day.date)}
              </time>
              <span className="h-px flex-1 bg-border" aria-hidden />
              {/* Zero-padded: a ledger column that doesn't reflow at ten. */}
              <span
                className="font-mono text-meta text-muted-foreground"
                aria-label={`${day.messages.length} messages`}
              >
                {String(day.messages.length).padStart(2, '0')}
              </span>
            </h2>

            <ul>
              {day.messages.map((message, index) => {
                const channelType = channelTypeById.get(message.channel_id);
                const channel = CHANNELS.find((c) => c.type === channelType);

                return (
                  <MessageRow
                    key={message.id}
                    message={message}
                    channelLabel={channel?.label ?? null}
                    dotClass={channel?.dotClass ?? 'bg-faint'}
                    showChannel={changePoints.has(message.id)}
                    isLast={index === day.messages.length - 1}
                  />
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
 * one of them means wait, the other means act. So one is a lit lamp with no
 * action on it, and the other is an unlit inbox with the single action that
 * changes the situation.
 */
export function TimelineEmpty({ connectedTypes }: { connectedTypes: string[] }) {
  const connected = connectedTypes.length > 0;

  const names = CHANNELS.filter((c) => connectedTypes.includes(c.type)).map(
    (c) => c.label,
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <span
        className={cn(
          'flex size-12 items-center justify-center rounded-xl border',
          connected ? 'border-live/30 bg-live/8' : 'border-border bg-panel',
        )}
        aria-hidden
      >
        {connected ? (
          <span className="relative flex size-5 items-center justify-center">
            <Radio className="size-5 text-live" />
            <span className="animate-lamp absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-live" />
          </span>
        ) : (
          <Inbox className="size-5 text-muted-foreground" />
        )}
      </span>

      <h2 className="mt-4 text-heading font-semibold">
        {connected ? 'Listening' : 'No messages yet'}
      </h2>

      <p className="mt-2 max-w-[34ch] text-row text-balance text-muted-foreground">
        {connected
          ? `${formatList(names)} ${names.length === 1 ? 'is' : 'are'} connected. New mail appears here within seconds of arriving — you won't need to refresh.`
          : 'Connect a channel and everything you receive lands here in one timeline, whichever app it came from.'}
      </p>

      {!connected && (
        <Link href="/channels" className={buttonClass({ className: 'mt-5' })}>
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
      <div className="mb-3 flex items-center gap-3 py-2">
        <span className="h-2.5 w-14 rounded bg-faint/50" />
        <span className="h-px flex-1 bg-border" />
        <span className="h-2.5 w-4 rounded bg-faint/50" />
      </div>

      <ul>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="relative flex gap-3.5">
            <span className="relative flex w-2 shrink-0 justify-center">
              <span
                className={cn(
                  'absolute top-0 w-px bg-border',
                  i === 3 ? 'h-5' : 'bottom-0',
                )}
              />
              <span className="absolute top-[9px] size-[7px] rounded-full bg-faint ring-[3px] ring-background" />
            </span>

            <div className="flex-1 animate-pulse pb-4 pt-1">
              <div className="flex items-baseline gap-2">
                <span className="h-3 w-28 rounded bg-faint/60" />
                <span className="ml-auto h-3 w-9 rounded bg-faint/40" />
              </div>
              <span className="mt-2 block h-3.5 w-2/3 rounded bg-faint/60" />
              <span className="mt-1.5 block h-3 w-1/2 rounded bg-faint/40" />
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

/**
 * Today and Yesterday are named; everything older gets its weekday, because
 * "Monday" is how someone actually remembers when a message arrived.
 */
function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));

  const inManila = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const now = new Date();
  if (isoDate === inManila.format(now)) return 'Today';
  if (isoDate === inManila.format(new Date(now.getTime() - 86_400_000))) {
    return 'Yesterday';
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
}

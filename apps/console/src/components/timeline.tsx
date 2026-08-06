import { Filter, Inbox, Radio } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { NewMessages } from '@/components/live';
import { MessageRow } from '@/components/message-row';
import { TimelineKeys } from '@/components/timeline-keys';
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
  truncated = false,
}: {
  messages: TimelineMessage[];
  channelTypeById: Map<string, string>;
  /** More messages exist than were fetched. Said out loud, never implied. */
  truncated?: boolean;
}) {
  const days = groupByDay(messages);

  // Computed over the flat ordered list, before grouping: a day boundary is
  // not a change of channel.
  const changePoints = channelChangePoints(messages, channelTypeById);

  return (
    <div>
      {/* Takes no height: an arrival must never move what you are reading. */}
      <NewMessages />
      <TimelineKeys />

      <div className="space-y-10">
        {days.map((day) => (
          <section key={day.date}>
            {/*
              Sticky, and inset wider than the content so the lamp's background
              ring scrolls under it cleanly rather than clipping at the column
              edge.
            */}
            <h2 className="sticky top-0 z-10 -mx-3 mb-4 flex items-center gap-3 bg-background px-3 py-2.5">
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

      <TimelineFoot count={messages.length} truncated={truncated} />
    </div>
  );
}

/**
 * The same record, one column per line (Yuri, 2026-08-06).
 *
 * ── ⚠ What this gives up, stated because it is the product's own thesis ──────
 *
 * `Timeline` above exists to prove one claim: messages from different places
 * are ONE ordered record. Splitting them puts that claim down. What you can no
 * longer see at a glance is the thing the merged view is for — that the client
 * answered on WhatsApp forty minutes after their colleague emailed, and which
 * came first.
 *
 * It is still worth having, and the reason is not aesthetic. Two channels
 * arriving at very different rates interleave badly: forty newsletters between
 * two chat messages buries the chat thread, and "read what this person said, in
 * sequence" is a real task the merged view answers poorly. So both exist, the
 * choice is in the URL, and neither is hidden.
 *
 * ── What carries over, and must ──────────────────────────────────────────────
 *
 * ⚠ **Channel identity is still named in words.** In the merged view that is
 * `channelChangePoints`; here it is the column heading, which is strictly
 * better — every row is under a heading that says which line it is. The rule
 * (WCAG 1.4.1, and the one question this console exists to answer) is met
 * either way, and `showChannel` is therefore off on every row: a per-row badge
 * under a heading that already says "Gmail" is noise.
 *
 * ⚠ **Days are still grouped, per column.** A flat list of fifty rows with no
 * date structure is worse than either view.
 */
export function TimelineSplit({
  messages,
  channelTypeById,
  truncated = false,
}: {
  messages: TimelineMessage[];
  channelTypeById: Map<string, string>;
  truncated?: boolean;
}) {
  const byType = new Map<string, TimelineMessage[]>();

  for (const message of messages) {
    // ⚠ `unknown` is a real bucket, not a fallback to hide. A message whose
    // channel row failed to load has to appear SOMEWHERE — dropping it would
    // make a loading failure look like missing mail, which is the one shape of
    // wrong this console keeps paying for.
    const type = channelTypeById.get(message.channel_id) ?? 'unknown';
    const bucket = byType.get(type);
    if (bucket) bucket.push(message);
    else byType.set(type, [message]);
  }

  const columns = [
    ...CHANNELS.map((c) => ({
      key: c.type,
      label: c.label,
      dotClass: c.dotClass,
      messages: byType.get(c.type) ?? [],
    })),
    ...(byType.has('unknown')
      ? [
          {
            key: 'unknown',
            label: 'Unknown line',
            dotClass: 'bg-faint',
            messages: byType.get('unknown')!,
          },
        ]
      : []),
  ];

  return (
    <div>
      <NewMessages />
      <TimelineKeys />

      {/*
        ⚠ Stacked below `lg`, never side-scrolled. Two 300px columns on a phone
        is two unreadable columns; one after the other is two readable ones.
        `min-w-0` on each track for the same reason the board needs it — a long
        unbreakable subject would otherwise widen its column and shove the
        other one off the screen.
      */}
      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-2">
        {columns.map((column) => (
          <section key={column.key} className="min-w-0">
            <h2 className="flex items-center gap-2 border-b border-border pb-2.5">
              <span
                className={cn('size-1.5 shrink-0 rounded-full', column.dotClass)}
                aria-hidden
              />
              <span className={cn(LABEL, 'text-foreground')}>{column.label}</span>
              <span className="ml-auto font-mono text-meta text-muted-foreground">
                {String(column.messages.length).padStart(2, '0')}
              </span>
            </h2>

            {column.messages.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-8 text-center text-note text-muted-foreground">
                Nothing on this line yet.
              </p>
            ) : (
              <div className="mt-5 space-y-8">
                {groupByDay(column.messages).map((day) => (
                  <section key={day.date}>
                    <h3 className="mb-3 flex items-center gap-3">
                      <time dateTime={day.date} className={LABEL}>
                        {formatDay(day.date)}
                      </time>
                      <span className="h-px flex-1 bg-border" aria-hidden />
                    </h3>

                    <ul>
                      {day.messages.map((message, index) => (
                        <MessageRow
                          key={message.id}
                          message={message}
                          channelLabel={column.label}
                          dotClass={column.dotClass}
                          // The column heading already names the line.
                          showChannel={false}
                          isLast={index === day.messages.length - 1}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <TimelineFoot count={messages.length} truncated={truncated} />
    </div>
  );
}

/**
 * The end of the record.
 *
 * Two jobs in one line, and they belong together — this is the moment you have
 * reached the bottom, which is exactly when "is that everything?" and "is
 * there a faster way through this?" are the questions you have.
 *
 * The limit is stated rather than implied. A console promising "every message,
 * every channel, in order" that silently shows the newest fifty is wrong in
 * the one way it must not be: a message you have received, cannot see, and are
 * not told is being withheld.
 *
 * The shortcut hint lives here instead of behind a `?` dialog because a hint
 * nobody finds teaches nobody, and a dialog is a lot of focus-trapping
 * machinery for eleven characters. At the foot of the list it is out of the
 * way until you are done reading, which is when you would want it.
 */
function TimelineFoot({ count, truncated }: { count: number; truncated: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-4">
      <p className={LABEL}>
        {truncated ? `Latest ${count} messages` : `${count} message${count === 1 ? '' : 's'}`}
      </p>

      <p className={cn(LABEL, 'ml-auto flex items-center gap-1.5')} aria-label="Keyboard shortcuts: J and K move between messages, Enter opens one, G returns to the top">
        <Key>j</Key>
        <Key>k</Key>
        <span aria-hidden>move</span>
        <Key>↵</Key>
        <span aria-hidden>open</span>
        <Key>g</Key>
        <span aria-hidden>top</span>
      </p>
    </div>
  );
}

/** A keycap. Same mono voice as everything else the machine says. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd
      aria-hidden
      className="rounded border border-border bg-background px-1 py-px font-mono text-label text-muted-foreground"
    >
      {children}
    </kbd>
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
 *
 * ⚠ The channel filter added a THIRD empty, and it is the one most likely to be
 * misread: an empty screen because the reader narrowed to a line they have not
 * connected. It looks exactly like a broken pipeline and it is the filter
 * working correctly, so it is handled first and names the way out.
 */
export function TimelineEmpty({
  connectedTypes,
  filteredTo = [],
}: {
  connectedTypes: string[];
  /** Channel types the reader has narrowed to. Empty means no filter. */
  filteredTo?: string[];
}) {
  const connected = connectedTypes.length > 0;

  const names = CHANNELS.filter((c) => connectedTypes.includes(c.type)).map(
    (c) => c.label,
  );

  if (filteredTo.length > 0) {
    const filteredNames = CHANNELS.filter((c) => filteredTo.includes(c.type)).map(
      (c) => c.label,
    );
    const anyConnected = filteredTo.some((type) => connectedTypes.includes(type));

    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <span
          className="flex size-12 items-center justify-center rounded-xl border border-border bg-panel"
          aria-hidden
        >
          <Filter className="size-5 text-muted-foreground" />
        </span>

        <h2 className="mt-4 text-heading font-semibold">
          Nothing on {formatList(filteredNames)}
        </h2>

        <p className="mt-2 max-w-[38ch] text-row text-balance text-muted-foreground">
          {anyConnected
            ? `The filter is showing ${formatList(filteredNames)} only, and there are no messages on ${filteredNames.length === 1 ? 'that line' : 'those lines'} yet.`
            : `${formatList(filteredNames)} ${filteredNames.length === 1 ? 'is' : 'are'} not connected, so there is nothing to show on ${filteredNames.length === 1 ? 'that line' : 'those lines'}.`}
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/" className={buttonClass({ variant: 'subtle' })}>
            Show both lines
          </Link>
          {!anyConnected && (
            <Link href="/channels" className={buttonClass()}>
              Connect a channel
            </Link>
          )}
        </div>
      </div>
    );
  }

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

            {/* Same geometry as a real row, avatar included — a skeleton whose
                shape doesn't match what replaces it produces a visible jump. */}
            <div className="flex flex-1 animate-pulse gap-2.5 pb-4 pt-1">
              <span className="mt-0.5 size-5 shrink-0 rounded-md bg-faint/50" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="h-3 w-28 rounded bg-faint/60" />
                  <span className="ml-auto h-3 w-9 rounded bg-faint/40" />
                </div>
                <span className="mt-2 block h-3.5 w-2/3 rounded bg-faint/60" />
                <span className="mt-1.5 block h-3 w-1/2 rounded bg-faint/40" />
              </div>
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

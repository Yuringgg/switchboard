import { CalendarCheck, Inbox, ListChecks } from 'lucide-react';
import Link from 'next/link';

import {
  itemWhen,
  KIND_LABEL,
  sortForAttention,
  type AttentionItem,
} from '@/lib/attention';
import { CHANNEL_META, type ChannelRow } from '@/lib/channels';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The "needs attention" queue (US-9).
 *
 * ── The rule this screen is built on ─────────────────────────────────────────
 *
 * **Every item shows the sentence it came from.** Not on hover, not behind a
 * disclosure — on the row. These are a model's readings of somebody's mail, and
 * a queue of confident-looking claims with no way to check them is precisely
 * the thing ADR-007 and ADR-010 exist to prevent. The quote is what turns "the
 * system says you promised something" into "here is where you said it".
 *
 * It is also why the quote is in the *human* voice (the sender's own words, in
 * Instrument Sans) while the title above it is in the machine register: the
 * console's two-voice split, doing the work it was designed for.
 */
export function AttentionList({
  items,
  channels,
  now,
}: {
  items: AttentionItem[];
  channels: ChannelRow[];
  /**
   * Passed in rather than read here so the server renders a stable order and
   * the "overdue" boundary is one instant for the whole page. A `new Date()`
   * per row would put two items either side of a millisecond.
   */
  now: Date;
}) {
  const channelTypeById = new Map(channels.map((c) => [c.id, c.type]));
  const sorted = sortForAttention(items, now);

  return (
    <ul className="border-t border-border">
      {sorted.map((item) => {
        const when = itemWhen(item);
        const overdue = when !== null && new Date(when).getTime() < now.getTime();
        const channelType = channelTypeById.get(item.message.channelId);
        const channel = channelType
          ? CHANNEL_META[channelType as keyof typeof CHANNEL_META]
          : undefined;

        return (
          <li key={item.id} className="border-b border-border py-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={cn(LABEL, 'text-foreground')}>{KIND_LABEL[item.kind]}</span>

              {when && (
                /*
                 * ⚠ Overdue is stated in WORDS as well as colour.
                 *
                 * The console's rule since the design pass: colour is never the
                 * only carrier (WCAG 1.4.1). "Passed" is the word; the tint is
                 * the reinforcement. This is also the only place outside a real
                 * error that is allowed to go red.
                 */
                <span
                  className={cn(
                    LABEL,
                    overdue ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {overdue ? 'passed · ' : ''}
                  {formatWhen(when)}
                </span>
              )}

              {!when && <span className={LABEL}>no date given</span>}

              {item.confirmedAt && (
                <span className={cn(LABEL, 'inline-flex items-center gap-1')}>
                  <CalendarCheck className="size-3" aria-hidden />
                  on your calendar
                </span>
              )}
            </div>

            <p className="mt-1 text-row font-medium text-balance">{item.title}</p>

            {/*
              The sender's own words. Quoted, in the human voice, never
              paraphrased — this is the evidence, and evidence that has been
              reworded is not evidence.
            */}
            <blockquote className="mt-1.5 border-l-2 border-border pl-3 text-note text-muted-foreground">
              {item.quote}
            </blockquote>

            <p className={cn(LABEL, 'mt-2 flex flex-wrap items-center gap-x-2 gap-y-1')}>
              {channel && (
                <span className={cn('size-1 rounded-full', channel.dotClass)} aria-hidden />
              )}
              <span>{channel?.label ?? 'Unknown channel'}</span>
              <span aria-hidden>·</span>
              <span>{item.message.senderName ?? item.message.senderRef ?? 'Unknown sender'}</span>
              <span aria-hidden>·</span>
              {/*
                ⚠ Every item links to its source message. ADR-010 requires the
                source shown beside a meeting proposal, and `/messages/[id]` is
                the route ADR-018 built for exactly that. `prefetch={false}`
                because these are private message bodies and the reader has not
                asked for them yet.
              */}
              <Link
                href={`/messages/${item.message.id}`}
                prefetch={false}
                className="focus-ring rounded underline underline-offset-2 hover:text-foreground"
              >
                {item.kind === 'meeting' && !item.confirmedAt
                  ? 'Review and add to calendar'
                  : 'Open message'}
              </Link>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Nothing extracted yet, versus nothing to do.
 *
 * ⚠ These must never converge, and this console has already paid for that once:
 * a timeline that looked identical whether the pipeline worked or nothing was
 * connected cost a full debugging session. The same rule, third time applied.
 */
export function AttentionEmpty({ extracted }: { extracted: boolean }) {
  if (!extracted) {
    return (
      <div className="border-t border-border py-12 text-center">
        <ListChecks className="mx-auto size-5 text-faint" aria-hidden />
        <p className="mt-3 text-row font-medium">Nothing has been read yet</p>
        <p className="mx-auto mt-1 max-w-[46ch] text-note text-muted-foreground">
          The worker looks through each message as it arrives and pulls out meetings,
          commitments, requests and questions. Nothing has been through that pass yet.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-border py-12 text-center">
      <Inbox className="mx-auto size-5 text-faint" aria-hidden />
      <p className="mt-3 text-row font-medium">Nothing needs your attention</p>
      <p className="mx-auto mt-1 max-w-[46ch] text-note text-muted-foreground">
        Your messages have been read and none of them contains a meeting, a commitment,
        a request or an open question. That is the ordinary result for most mail.
      </p>
    </div>
  );
}

/**
 * "Fri 7 Aug, 15:00" — Manila, and never a bare date.
 *
 * PH is UTC+8 with no DST, so a fixed zone is correct rather than a shortcut.
 * The weekday is included because a queue is scanned, and "Fri" answers "is
 * that this week?" faster than a numeral does.
 */
function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

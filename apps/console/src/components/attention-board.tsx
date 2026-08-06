import { CalendarCheck, Inbox, ListChecks } from 'lucide-react';
import Link from 'next/link';

import { MoveCard } from '@/components/attention-move';
import {
  groupForBoard,
  itemWhen,
  KIND_LABEL,
  neighbourStatus,
  STATUS_LABEL,
  type AttentionItem,
} from '@/lib/attention';
import { CHANNEL_META, type ChannelRow } from '@/lib/channels';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The "needs attention" board (US-9, re-shaped 2026-08-05).
 *
 * ── What changed and why ─────────────────────────────────────────────────────
 *
 * This was a single ordered list. Ms. Maria's note: *"okay din siya pero siguro
 * palitan na lang yung way ng UI niya mismo… kanban… meron kang not started, in
 * progress, done. So it's similar to Trello."*
 *
 * She was right about something the list could not do. The rows were correctly
 * ordered by *when the thing happens*, which answers "what is next" — and
 * answers nothing at all about "what have I already dealt with". A queue that
 * cannot be worked through is a queue you re-read from the top every morning.
 * Three columns give each card somewhere to go.
 *
 * ── ⚠ What did NOT change, and must not ──────────────────────────────────────
 *
 * **Every card still shows the sentence it came from.** Not on hover, not
 * behind a disclosure — on the card. These are a model's readings of somebody's
 * mail, and a board of confident-looking claims with no way to check them is
 * precisely the thing ADR-007 and ADR-010 exist to prevent. It is what turns
 * "the system says you promised something" into "here is where you said it".
 *
 * It is also why the quote stays in the *human* voice — the sender's own words,
 * in the sans face — while the labels above it stay in the machine register.
 * That two-voice split is the console's, doing the job it was designed for.
 *
 * **Ordering is still the feature**, inside each column. See `groupForBoard`
 * for why Done sorts differently from the other two.
 *
 * ── ⚠ Why there is no drag and drop ──────────────────────────────────────────
 *
 * Trello's columns are the idea worth taking; its drag handles are not. HTML5
 * drag-and-drop is keyboard-hostile without a parallel control built anyway, it
 * needs pointer events this project's environment cannot even test, and a
 * pointer-driven reorder is the one interaction that fails silently on a touch
 * screen. Two arrows per card are operable by mouse, keyboard, touch and screen
 * reader, they work before hydration, and they say out loud where the card is
 * going. `components/attention-move.tsx` has the rest.
 */
export function AttentionBoard({
  items,
  channels,
  now,
}: {
  items: AttentionItem[];
  channels: ChannelRow[];
  /**
   * Passed in rather than read here so the server renders a stable order and
   * the "overdue" boundary is one instant for the whole page. A `new Date()`
   * per card would put two items either side of a millisecond.
   */
  now: Date;
}) {
  const channelTypeById = new Map(channels.map((c) => [c.id, c.type]));
  const columns = groupForBoard(items, now);

  return (
    /*
     * Three columns on a wide screen, stacked on a phone.
     *
     * ⚠ Stacked, never horizontally scrolled. A board that scrolls sideways on
     * a 375px screen hides two of its three columns behind an edge with nothing
     * saying so — the exact failure the mobile dock was criticised for, and the
     * one this console has already paid to fix once.
     */
    <div className="grid gap-x-5 gap-y-8 md:grid-cols-3">
      {columns.map((column) => (
        /*
         * ⚠ `min-w-0`. A grid track's default `min-width: auto` refuses to
         * shrink below its content, so one unbreakable string — a promotional
         * URL in a quoted sentence, which is exactly what a real mailbox is
         * full of — pushed its column wider than its share and drew straight
         * across the two beside it. Reported as "overlapping bugs" on
         * 2026-08-06, and it is this, not a z-index or a position problem.
         *
         * `min-w-0` lets the track shrink; the wrapping rules on the card below
         * are what then break the string. Both halves are needed — either one
         * alone still overflows.
         */
        <section
          key={column.status}
          aria-labelledby={`col-${column.status}`}
          className="min-w-0"
        >
          {/*
            The column heading is a heading, not a coloured bar. This board
            takes Trello's columns and not its chrome: a tinted header strip per
            column would spend colour on "which column" when this product spends
            it on "which channel" and "is the board live", and those two
            meanings are the ones a 7px dot has to carry.
          */}
          <h3
            id={`col-${column.status}`}
            className="flex items-baseline gap-2 border-b border-border pb-2.5"
          >
            <span className={cn(LABEL, 'text-foreground')}>{column.label}</span>
            {/* Zero-padded, like the timeline's day counts: a ledger column
                that does not reflow when it reaches ten. */}
            <span className="ml-auto font-mono text-meta text-muted-foreground">
              {String(column.items.length).padStart(2, '0')}
            </span>
          </h3>

          {column.items.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-7 text-center text-note text-muted-foreground">
              {column.status === 'done'
                ? 'Nothing cleared yet.'
                : 'Nothing in this column.'}
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {column.items.map((item) => (
                <Card
                  key={item.id}
                  item={item}
                  channelType={channelTypeById.get(item.message.channelId)}
                  now={now}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function Card({
  item,
  channelType,
  now,
}: {
  item: AttentionItem;
  channelType: string | undefined;
  now: Date;
}) {
  const when = itemWhen(item);
  const overdue = when !== null && new Date(when).getTime() < now.getTime();
  const channel = channelType
    ? CHANNEL_META[channelType as keyof typeof CHANNEL_META]
    : undefined;

  const back = neighbourStatus(item.status, -1);
  const forward = neighbourStatus(item.status, 1);

  return (
    /*
     * ⚠ A border OR a shadow, never both. The 1px-border-plus-wide-soft-shadow
     * card is the generated-UI signature this design pass exists to get rid of,
     * and Ms. Maria's note was that the console looked generated. The card is
     * separated from the column by a hairline and a surface step, which is the
     * same device the whole console uses for frame-versus-record.
     */
    <li className="min-w-0 overflow-hidden rounded-lg border border-border bg-panel p-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn(LABEL, 'text-foreground')}>{KIND_LABEL[item.kind]}</span>

        {when && (
          /*
           * ⚠ Overdue is stated in WORDS as well as in colour (WCAG 1.4.1).
           * "Passed" is the word; the tint reinforces it. This is one of only
           * two places outside a real error allowed to go red.
           *
           * ⚠ And it is suppressed in Done. Everything finished is eventually
           * "passed", so flagging it there would fill the column a person just
           * cleared with red warnings about work they completed — which reads
           * as failure and is the opposite of true.
           */
          <span
            className={cn(
              LABEL,
              overdue && item.status !== 'done'
                ? 'text-destructive'
                : 'text-muted-foreground',
            )}
          >
            {overdue && item.status !== 'done' ? 'passed · ' : ''}
            {formatWhen(when)}
          </span>
        )}

        {!when && <span className={LABEL}>no date given</span>}
      </div>

      {/*
        ⚠ `[overflow-wrap:anywhere]` on both, not `break-words`.
        `break-word` only breaks a word that would overflow *on its own line*;
        a 120-character tracking URL sitting after two normal words is not that
        case, so it happily runs off the card. `anywhere` also lets the browser
        count the break opportunity when it computes min-content width, which is
        what stops the grid track from being widened by it in the first place.
      */}
      <p className="mt-1.5 text-row font-medium text-pretty [overflow-wrap:anywhere]">
        {item.title}
      </p>

      {/*
        The sender's own words. Quoted, in the human voice, never paraphrased —
        this is the evidence, and evidence that has been reworded is not
        evidence.

        ⚠ Which is also why it is not truncated. A quote cut short is a quote
        whose meaning cannot be checked, and checking it is the entire job of
        this line. Long ones wrap and make the card tall; that is the correct
        trade on a board whose whole premise is that the evidence is on screen.
      */}
      <blockquote className="mt-2 border-l-2 border-border pl-3 text-note text-muted-foreground text-pretty [overflow-wrap:anywhere]">
        {item.quote}
      </blockquote>

      <p className={cn(LABEL, 'mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1')}>
        {channel && (
          <span className={cn('size-1 rounded-full', channel.dotClass)} aria-hidden />
        )}
        <span>{channel?.label ?? 'Unknown channel'}</span>
        <span aria-hidden>·</span>
        <span className="min-w-0 truncate">
          {item.message.senderName ?? item.message.senderRef ?? 'Unknown sender'}
        </span>
      </p>

      {item.confirmedAt && (
        <p className={cn(LABEL, 'mt-1.5 flex items-center gap-1')}>
          <CalendarCheck className="size-3 shrink-0" aria-hidden />
          on your calendar
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
        {/*
          ⚠ Every card links to its source message. ADR-010 requires the source
          shown beside a meeting proposal, and `/messages/[id]` is the route
          ADR-018 built for exactly that. `prefetch={false}` because these are
          private message bodies and the reader has not asked for them yet.
        */}
        <Link
          href={`/messages/${item.message.id}`}
          prefetch={false}
          className={cn(
            LABEL,
            'focus-ring rounded underline underline-offset-2 hover:text-foreground',
          )}
        >
          {item.kind === 'meeting' && !item.confirmedAt ? 'Review' : 'Open message'}
        </Link>

        <MoveCard
          id={item.id}
          title={item.title}
          back={back}
          forward={forward}
          backLabel={back ? STATUS_LABEL[back] : null}
          forwardLabel={forward ? STATUS_LABEL[forward] : null}
        />
      </div>
    </li>
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
 * The weekday is included because a board is scanned, and "Fri" answers "is
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

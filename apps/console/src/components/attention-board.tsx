'use client';

import {
  CalendarCheck,
  CircleCheck,
  Circle,
  Clock,
  Inbox,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion, type Variants } from 'framer-motion';
import Link from 'next/link';
import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from 'react';

import { ArchiveButton, ClearDoneButton } from '@/components/attention-archive';
import { MoveCard } from '@/components/attention-move';
import {
  groupForBoard,
  itemWhen,
  KIND_LABEL,
  neighbourStatus,
  STATUS_LABEL,
  type AttentionItem,
  type AttentionKind,
  type AttentionStatus,
} from '@/lib/attention';
import { moveAttentionItem } from '@/lib/attention-actions';
import { CHANNEL_META, type ChannelRow } from '@/lib/channels';
import { initials } from '@/lib/timeline';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The "needs attention" board (US-9, re-shaped 2026-08-05, restyled 2026-10-04).
 *
 * ── What changed and why ─────────────────────────────────────────────────────
 *
 * This was a single ordered list. Ms. Maria's note: *"okay din siya pero siguro
 * palitan na lang yung way ng UI niya mismo… kanban… meron kang not started, in
 * progress, done. So it's similar to Trello."*
 *
 * On 2026-10-04 Yuri asked for the look of a 21st.dev "kanban board": status
 * icons on the columns, soft raised cards that lift on hover, coloured kind
 * tags, an avatar-and-date footer, and cards you can drag between columns.
 * The look is taken; the code is this console's own.
 *
 * ── Motion ── CSS for arriving, framer-motion for MOVING ──────────────────────────────
 *
 * Yuri wants this console as smooth as it can be (2026-10-04), so the cards
 * move like the snippet's: a moved card slides on a spring to its new column,
 * the cards around it slide to close the gap, and an archived card fades out.
 * That is framer-motion's `layout` / `layoutId`.
 *
 * ⚠ The one thing NOT taken from the snippet: it started every card at
 * opacity 0 and faded it in from JavaScript, so wherever JavaScript animation
 * does not run (a headless render, a background tab) the board was empty.
 * Every motion element here is `initial={false}`, and the entrance is CSS
 * (`.card-enter`) played over a visible resting state. If framer never runs,
 * cards simply snap into place. `reducedMotion="user"` honours the system.
 *
 * ── ⚠ What did NOT change, and must not ──────────────────────────────────────
 *
 * **Every card still shows the sentence it came from.** Not on hover, not
 * behind a disclosure — on the card. These are a model's readings of somebody's
 * mail, and a board of confident-looking claims with no way to check them is
 * precisely the thing ADR-007 and ADR-010 exist to prevent.
 *
 * **Ordering is still the feature**, inside each column. See `groupForBoard`
 * for why Done sorts differently from the other two.
 *
 * ── Drag AND arrows ──────────────────────────────────────────────────────────
 *
 * Dragging is the fast way on a desktop. The two arrows stay on every card,
 * because drag-and-drop is mouse-only: the arrows are what keyboard, touch and
 * screen-reader users move cards with, and they work before hydration.
 *
 * A dropped card lands at once (`useOptimistic`), and the server then
 * revalidates the page. If the move fails, the optimistic state is dropped and
 * the card is back where the database says it is, with the reason above the
 * board — the screen still ends up showing the truth.
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
  now: Date | string;
}) {
  const nowDate = useMemo(() => new Date(now), [now]);
  const channelTypeById = new Map(channels.map((c) => [c.id, c.type]));

  const [shown, moveShown] = useOptimistic(
    items,
    (state, move: { id: string; to: AttentionStatus }) =>
      state.map((item) =>
        item.id === move.id
          ? { ...item, status: move.to, statusChangedAt: new Date().toISOString() }
          : item,
      ),
  );
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<{ id: string; from: AttentionStatus } | null>(null);
  const [over, setOver] = useState<AttentionStatus | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Cards already drawn once. Only a card NEW to the board plays the CSS
   * entrance; one that merely moved columns slides instead (`layoutId`) —
   * fading it in again mid-slide would look like it had been replaced.
   */
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const item of shown) seen.current.add(item.id);
  });

  const columns = groupForBoard(shown, nowDate);
  // A card that left a column but is still on the board MOVED; it must not
  // fade out where it was. Passed to each exiting card through `custom`.
  const onBoard = new Set(shown.map((item) => item.id));

  function drop(to: AttentionStatus) {
    const move = dragging;
    setDragging(null);
    setOver(null);
    if (!move || move.from === to) return;

    setError(null);
    setLanded(move.id);
    startTransition(async () => {
      moveShown({ id: move.id, to });
      const form = new FormData();
      form.set('id', move.id);
      form.set('to', to);
      const result = await moveAttentionItem(form);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-4 text-note text-destructive">
          {error}
        </p>
      )}

      {/*
        Three columns on a wide screen, stacked on a phone.

        ⚠ Stacked, never horizontally scrolled. A board that scrolls sideways on
        a 375px screen hides two of its three columns behind an edge with nothing
        saying so — the exact failure the mobile dock was criticised for.
      */}
      <MotionConfig reducedMotion="user">
        <LayoutGroup>
      <div className="grid gap-x-5 gap-y-8 md:grid-cols-3">
        {columns.map((column) => {
          const Icon = STATUS_ICON[column.status];
          const isOver = over === column.status && dragging?.from !== column.status;

          return (
            /*
             * ⚠ `min-w-0`. A grid track's default `min-width: auto` refuses to
             * shrink below its content, so one unbreakable string — a
             * promotional URL in a quoted sentence — pushed its column wider than
             * its share and drew across the two beside it (2026-08-06). The
             * wrapping rules on the card are the other half of the fix.
             */
            <section
              key={column.status}
              aria-labelledby={`col-${column.status}`}
              className="flex min-w-0 flex-col"
            >
              <h3
                id={`col-${column.status}`}
                className="mb-3 flex items-center gap-2 px-0.5"
              >
                <Icon className={cn('size-3.5 shrink-0', STATUS_TONE[column.status])} aria-hidden />
                <span className="text-row font-semibold tracking-[-0.01em]">{column.label}</span>

                {/* ⚠ Done only. It is the one column nothing ever leaves, so it
                    is where the pile forms — and a bulk clear on a column
                    somebody is still working through would lose their place. */}
                {column.status === 'done' && <ClearDoneButton count={column.items.length} />}

                {/* Re-keyed on the count, so it pops when a card arrives or
                    leaves. Zero-padded, like the timeline's day counts. */}
                <span
                  key={column.items.length}
                  className="count-pop ml-auto font-mono text-meta text-muted-foreground tabular-nums"
                >
                  {String(column.items.length).padStart(2, '0')}
                </span>
              </h3>

              {/*
                The drop zone is the whole column body, not just its cards, so a
                short or empty column is as easy to drop into as a full one.
              */}
              <div
                onDragOver={(event) => {
                  if (!dragging) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  if (over !== column.status) setOver(column.status);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setOver(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  drop(column.status);
                }}
                className={cn(
                  'drop-zone flex min-h-24 flex-1 flex-col gap-2.5 rounded-2xl p-1 -m-1',
                  isOver && 'is-over',
                )}
              >
                <span aria-hidden className="drop-line" />

                {column.items.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border px-3 py-7 text-center text-note text-muted-foreground">
                    {isOver
                      ? `Drop to move it to ${column.label}`
                      : column.status === 'done'
                        ? 'Nothing cleared yet.'
                        : 'Nothing in this column.'}
                  </p>
                )}

                {/* Always rendered, even empty, so the LAST card leaving a
                    column still gets its exit — an unmounted list has none. */}
                <ul className="flex flex-col gap-2.5">
                  <AnimatePresence initial={false} custom={onBoard}>
                    {column.items.map((item, index) => (
                      <Card
                        key={item.id}
                        item={item}
                        index={item.id === landed ? 0 : index}
                        fresh={!seen.current.has(item.id)}
                        channelType={channelTypeById.get(item.message.channelId)}
                        now={nowDate}
                        dragging={dragging?.id === item.id}
                        onDragStart={() => setDragging({ id: item.id, from: item.status })}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            </section>
          );
        })}
      </div>
        </LayoutGroup>
      </MotionConfig>
    </>
  );
}

/** The column icons: an empty ring, a clock, a tick — the snippet's three. */
const STATUS_ICON: Record<AttentionStatus, LucideIcon> = {
  not_started: Circle,
  in_progress: Clock,
  done: CircleCheck,
};

const STATUS_TONE: Record<AttentionStatus, string> = {
  not_started: 'text-muted-foreground',
  in_progress: 'text-amber-500',
  done: 'text-emerald-500',
};

/**
 * One tint per kind, for the tag. ⚠ None of them is a channel's hue — Gmail is
 * red, WhatsApp green and Meetings blue, and a "Meeting" tag in the Meetings
 * blue would read as "came in on Meetings" when most come in on Gmail.
 */
const KIND_TAG: Record<AttentionKind, string> = {
  meeting: 'bg-violet-500/12 text-violet-700 dark:text-violet-300',
  commitment: 'bg-amber-500/14 text-amber-700 dark:text-amber-300',
  action_item: 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-300',
  question: 'bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300',
};

/**
 * How a card leaves a column. `custom` is the set of ids still on the board,
 * from `AnimatePresence`: a card in it has MOVED and is already sliding in its
 * new column, so it leaves the old one at once; a card not in it was archived
 * and fades and shrinks out.
 */
function cardMotion(id: string): Variants {
  return {
    exit: (onBoard: Set<string> | undefined) =>
      onBoard?.has(id)
        ? { opacity: 0, transition: { duration: 0 } }
        : { opacity: 0, scale: 0.96, transition: { duration: 0.18 } },
  };
}

function Card({
  item,
  index,
  fresh,
  channelType,
  now,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  item: AttentionItem;
  /** Its place in the column, for the entrance stagger. */
  index: number;
  /** First time on the board: play the CSS entrance. */
  fresh: boolean;
  channelType: string | undefined;
  now: Date;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const when = itemWhen(item);
  const done = item.status === 'done';
  const overdue = when !== null && new Date(when).getTime() < now.getTime() && !done;
  const channel = channelType
    ? CHANNEL_META[channelType as keyof typeof CHANNEL_META]
    : undefined;
  const sender = item.message.senderName ?? item.message.senderRef ?? 'Unknown sender';

  const back = neighbourStatus(item.status, -1);
  const forward = neighbourStatus(item.status, 1);

  return (
    /*
     * Two layers, because two systems move this card and must not share an
     * element: framer-motion owns the OUTER one's transform (the slide), CSS
     * the inner one's (hover lift, press, entrance). On one element framer's
     * inline `transform` would cancel the hover.
     *
     * ⚠ The native drag handlers are on the inner `div` too: on a `motion`
     * element, `onDragStart`/`onDragEnd` are claimed by framer's own
     * pointer-drag gesture, and HTML drag-and-drop never reaches them.
     */
    <motion.li
      layout
      layoutId={item.id}
      initial={false}
      variants={cardMotion(item.id)}
      exit="exit"
      transition={{ layout: { type: 'spring', stiffness: 500, damping: 34 } }}
      className="min-w-0"
    >
      <div
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          // Firefox starts no drag without data.
          event.dataTransfer.setData('text/plain', item.title);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        style={{ '--i': index } as CSSProperties}
        className={cn(
          'board-card group/card min-w-0 cursor-grab overflow-hidden rounded-xl bg-panel p-3.5 active:cursor-grabbing',
          fresh && 'card-enter',
          done && 'is-done',
          dragging && 'is-dragging',
        )}
      >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'rounded-md px-1.5 py-0.5 text-label font-semibold tracking-wide',
            KIND_TAG[item.kind],
          )}
        >
          {KIND_LABEL[item.kind]}
        </span>

        {/* ⚠ The channel is NAMED, never carried by the dot alone — Gmail red
            against WhatsApp green is the red/green confusion pair. */}
        <span className="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-label font-medium text-muted-foreground">
          {channel && <span className={cn('size-1.5 rounded-full', channel.dotClass)} aria-hidden />}
          {channel?.label ?? 'Unknown channel'}
        </span>

        {item.confirmedAt && (
          <span className="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-label font-medium text-muted-foreground">
            <CalendarCheck className="size-3 shrink-0" aria-hidden />
            On your calendar
          </span>
        )}

        {/*
          ⚠ Archive sits at the TOP of the card, away from the move arrows at
          the bottom. They are different kinds of action: the arrows say "where
          does this go next", archive says "this does not belong here at all".
        */}
        <span className="-my-1 -mr-1 ml-auto shrink-0">
          <ArchiveButton id={item.id} title={item.title} />
        </span>
      </div>

      {/*
        ⚠ `[overflow-wrap:anywhere]`, not `break-words`: a 120-character
        tracking URL after two normal words is not a word that overflows on its
        own line, so `break-word` lets it run off the card.
      */}
      <p
        className={cn(
          'mt-2 text-row font-semibold text-pretty [overflow-wrap:anywhere]',
          done && 'line-through decoration-muted-foreground',
        )}
      >
        {item.title}
      </p>

      {/*
        The sender's own words. Quoted, in the human voice, never paraphrased
        and never truncated — this is the evidence, and a quote cut short is a
        quote whose meaning cannot be checked.
      */}
      <blockquote className="mt-1.5 border-l-2 border-border pl-3 text-note text-muted-foreground text-pretty [overflow-wrap:anywhere]">
        {item.quote}
      </blockquote>

      {/* Who and when — the snippet's avatar-and-date footer. */}
      {/* Wraps rather than truncating: when "Passed · Sat 3 Oct, 22:19" and a
          long name do not fit side by side, the date takes the next line and
          the name stays whole. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="grid size-5.5 shrink-0 place-items-center rounded-full bg-accent text-[0.5625rem] font-bold text-muted-foreground"
          >
            {initials(item.message.senderName ?? null, item.message.senderRef ?? null)}
          </span>
          <span className="min-w-0 truncate text-note text-muted-foreground">{sender}</span>
        </span>

        {/*
          ⚠ Overdue is stated in WORDS as well as colour (WCAG 1.4.1), and
          suppressed in Done: everything finished is eventually "passed", and a
          column of red warnings about completed work reads as failure.
        */}
        <span
          className={cn(
            'ml-auto shrink-0 font-mono text-label tabular-nums',
            overdue ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {when ? `${overdue ? 'Passed · ' : ''}${formatWhen(when)}` : 'No date'}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
        {/*
          ⚠ Every card links to its source message (ADR-010, ADR-018).
          `prefetch={false}`: these are private message bodies and the reader
          has not asked for them yet.
        */}
        <Link
          href={`/messages/${item.message.id}`}
          prefetch={false}
          draggable={false}
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
      </div>
    </motion.li>
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

'use client';

import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';

import { bodyForDisplay, preview, type TimelineMessage } from '@/lib/timeline';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * One message on the board.
 *
 * ── Hierarchy ────────────────────────────────────────────────────────────────
 *
 * Subject is the largest thing in the row, sender is the boldest, preview is
 * the quietest. That ordering is the fix for a row where the sender was set
 * heavier than the subject *and* the subject was set larger than the sender —
 * two signals pointing at different words, so neither won and the list read as
 * a flat wall.
 *
 * Who identifies the row. What it says is why you would stop on it. The
 * preview is there to be skimmed past.
 *
 * ── Why the row opens ────────────────────────────────────────────────────────
 *
 * A one-line preview with no way to read line two is a dead end, and this is a
 * console whose entire premise is "find what the client actually said". The
 * body is already in hand — `fetchTimeline` selects `body_text` — so opening a
 * row costs no query, no route and no round trip. That is what keeps this out
 * of Phase 3's territory: it is the same data, rendered fully.
 *
 * ⚠ Bodies are rendered here and nowhere else (`docs/02-ARCHITECTURE.md` §6).
 * This component is inside the timeline; do not lift it out to reuse the
 * markup somewhere the rule does not hold.
 */
export function MessageRow({
  message,
  channelLabel,
  dotClass,
  showChannel,
  isLast,
}: {
  message: TimelineMessage;
  /** Null when the message's channel row could not be loaded. */
  channelLabel: string | null;
  dotClass: string;
  /** True when this message came in on a different line than the one above it. */
  showChannel: boolean;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const outbound = message.direction === 'outbound';
  const name = outbound ? 'You' : (message.sender?.display_name ?? null);
  const address = message.sender?.external_id ?? null;
  const line = preview(message.body_text);
  const body = bodyForDisplay(message.body_text);

  /*
   * ── Why the headline is not simply the subject ───────────────────────────
   *
   * Half this timeline has no subject. Email has one; chat does not — the
   * canonical type says so outright (`subject?: string`, "email has one, chat
   * doesn't"), and WhatsApp is the second channel by design.
   *
   * Rendering `subject ?? 'No subject'` therefore put a 15px italic apology
   * where every WhatsApp message's actual words belong, and pushed the words
   * themselves down into the grey preview line. On a screen whose entire
   * premise is that both channels are equal citizens of one record, that reads
   * as chat being a degraded kind of email.
   *
   * So the largest line in the row is *whatever this message leads with*: its
   * subject if it has one, its opening line if it does not. The fallback below
   * is then genuinely rare — no subject and no body at all — and says so
   * plainly instead of naming a field the channel never had.
   */
  const headline = message.subject ?? (line || null);

  /** Already promoted into the headline — printing it twice says nothing new. */
  const showPreview = Boolean(message.subject) && Boolean(line);

  return (
    <li className="group relative flex gap-3.5">
      {/* The line, and this message's lamp on it. */}
      <span className="relative flex w-2 shrink-0 justify-center" aria-hidden>
        <span
          className={cn(
            'absolute top-0 w-px bg-border',
            isLast ? 'h-5' : 'bottom-0',
          )}
        />
        <span
          className={cn(
            'absolute top-[9px] size-[7px] rounded-full ring-[3px] ring-background',
            dotClass,
          )}
        />
      </span>

      <div className="min-w-0 flex-1 pb-4">
        {/*
          The line changed. Named in words, because the lamp's colour cannot be
          the only carrier — see channelChangePoints() in lib/timeline.ts.
        */}
        {showChannel && channelLabel && (
          <p className={cn(LABEL, 'mb-1.5 flex items-center gap-1.5 pt-1')}>
            <span className={cn('size-1 rounded-full', dotClass)} aria-hidden />
            {channelLabel}
          </p>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          // Only while the panel exists. A collapsed row is not rendering one,
          // and aria-controls pointing at an id that is not in the document is
          // a dangling reference — `aria-expanded` is what actually carries the
          // state to a screen reader either way.
          aria-controls={open ? panelId : undefined}
          className="focus-ring -mx-2 block w-full rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/70"
        >
          <span className="flex items-baseline gap-2">
            <span className="truncate text-row font-medium">
              {name ?? address ?? 'Unknown sender'}
            </span>

            {name && address && (
              <span className="hidden truncate font-mono text-meta text-muted-foreground sm:inline">
                {address}
              </span>
            )}

            {/* Direction is shown, never filtered on. A self-sent message is
                outbound and must still appear — see lib/timeline.ts. */}
            {outbound && (
              <span className={cn(LABEL, 'shrink-0')}>sent</span>
            )}

            <time
              dateTime={message.sent_at}
              className="ml-auto shrink-0 font-mono text-meta text-muted-foreground"
            >
              {formatTime(message.sent_at)}
            </time>
          </span>

          <span className="mt-0.5 flex items-start gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 text-subject',
                open ? 'font-medium' : 'truncate',
                !headline && 'text-muted-foreground italic',
              )}
            >
              {headline ?? 'Empty message'}
            </span>

            <ChevronRight
              className={cn(
                'mt-1 size-3.5 shrink-0 text-faint transition-transform duration-150',
                'group-hover:text-muted-foreground',
                open && 'rotate-90 text-muted-foreground',
              )}
              aria-hidden
            />
          </span>

          {!open && showPreview && (
            <span className="mt-0.5 block truncate text-row text-muted-foreground">
              {line}
            </span>
          )}
        </button>

        {open && (
          <div id={panelId} className="animate-unfold mt-2.5">
            <p className={cn(LABEL, 'mb-2')}>
              {channelLabel ?? 'Unknown channel'} · {formatFullTimestamp(message.sent_at)}
              {address && <span className="sm:hidden"> · {address}</span>}
            </p>

            {body.text ? (
              <p className="max-w-[62ch] text-row whitespace-pre-wrap">{body.text}</p>
            ) : (
              /*
                '' is a legal, meaningful value here — it means normalize looked
                and there was nothing, which is what an attachment-only mail or
                a bare calendar invite produces. `docs/02-ARCHITECTURE.md` §2.
                Saying so beats an empty gap that reads as a rendering failure.
              */
              <p className="text-row text-muted-foreground italic">
                No text in this message — it may carry only attachments.
              </p>
            )}

            {body.truncated && (
              <p className="mt-2.5 text-note text-muted-foreground">
                Showing the first {body.limit.toLocaleString('en-GB')} characters.
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** The date the row's header only had room to show as a time. */
function formatFullTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

'use client';

import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';

import { ROW_ATTR } from '@/components/timeline-keys';
import { useNow } from '@/lib/now';
import {
  segmentsText,
  snippetRepeatsHeadline,
  type HighlightSegment,
} from '@/lib/search';
import {
  bodyForDisplay,
  formatAge,
  initials,
  preview,
  type TimelineMessage,
} from '@/lib/timeline';
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
  snippet,
  showDate = false,
}: {
  message: TimelineMessage;
  /** Null when the message's channel row could not be loaded. */
  channelLabel: string | null;
  dotClass: string;
  /** True when this message came in on a different line than the one above it. */
  showChannel: boolean;
  isLast: boolean;
  /**
   * Search only: the matched fragments, already split into plain and matched
   * runs. Replaces the preview line, because on a result row the useful thing
   * is *why this matched*, not what the message happens to open with.
   */
  snippet?: HighlightSegment[] | null;
  /**
   * Search results are ranked, not chronological, so consecutive rows can be
   * months apart with no day heading between them. Without the date the row
   * says "14:12" and means nothing.
   */
  showDate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const now = useNow();

  const outbound = message.direction === 'outbound';
  const name = outbound ? 'You' : (message.sender?.display_name ?? null);
  const address = message.sender?.external_id ?? null;
  const line = preview(message.body_text);
  const body = bodyForDisplay(message.body_text);

  /**
   * "14m ago" while it is recent, otherwise null and the clock time shows.
   *
   * Suppressed entirely on a search result: "just now" is the language of a
   * live board, and a ranked result list is not one. There the row needs to
   * say *when*, absolutely, because the rows above and below it may be from
   * any date at all.
   */
  const age = showDate ? null : formatAge(message.sent_at, now);

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

  /*
   * ── The same rule, applied to a search snippet ───────────────────────────
   *
   * A message with no subject takes its headline from its opening line, and
   * `ts_headline` fragments that same body — so a short chat message rendered
   * the identical sentence twice, once as the headline and once as the grey
   * snippet below it. Caught by measuring the preview harness, not by reading
   * the code.
   *
   * When that happens the fix is not to drop the snippet — that would throw
   * away the highlight, which on a result row is the whole point. The headline
   * carries the marks instead, and the duplicate line goes.
   */
  const snippetIsHeadline = snippetRepeatsHeadline(headline, snippet ?? null);
  const headlineSegments =
    snippetIsHeadline && snippet && normaliseSpace(segmentsText(snippet)) === normaliseSpace(headline ?? '')
      ? snippet
      : null;

  return (
    <li className="group relative flex gap-4">
      {/* The line, and this message's lamp on it. */}
      <span className="relative flex w-2 shrink-0 justify-center" aria-hidden>
        <span
          className={cn(
            'absolute top-0 w-px bg-border',
            isLast ? 'h-5' : 'bottom-0',
          )}
        />
        {/* `top-[10px]`, up from 9: `--text-row`'s line-height went 1.5 → 1.6
            with the 2026-08-06 scale, which moves the first line's optical
            centre down about a pixel. The lamp sits on that centre, not on the
            top of the row. */}
        <span
          className={cn(
            'absolute top-[10px] size-[7px] rounded-full ring-[3px] ring-background',
            dotClass,
          )}
        />
      </span>

      <div className="min-w-0 flex-1 pb-5">
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

        {/*
          The avatar sits OUTSIDE the button so the opened body aligns with the
          text column rather than starting under the initials — and the hover
          wash moves out here with it, so the whole row lights up as one object
          instead of the text highlighting while the avatar stays cold.
        */}
        <div className="-mx-2 flex gap-2.5 rounded-md px-2 py-1 transition-colors group-hover:bg-accent/70">
          <Avatar
            initials={initials(message.sender?.display_name ?? null, address)}
            outbound={outbound}
          />

          <div className="min-w-0 flex-1">
        <button
          type="button"
          // Marks this as a stop for j/k. See components/timeline-keys.tsx.
          {...{ [ROW_ATTR]: '' }}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          // Only while the panel exists. A collapsed row is not rendering one,
          // and aria-controls pointing at an id that is not in the document is
          // a dangling reference — `aria-expanded` is what actually carries the
          // state to a screen reader either way.
          aria-controls={open ? panelId : undefined}
          className="focus-ring block w-full rounded-sm text-left"
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

            {/*
              `title` carries the exact clock time whenever the label is
              relative, so "just now" is never the only answer available.
            */}
            <time
              dateTime={message.sent_at}
              // Whenever the visible label is lossy — relative ("just now") or
              // year-less ("7 Aug") — the exact stamp stays one hover away.
              title={age || showDate ? formatFullTimestamp(message.sent_at) : undefined}
              className="ml-auto shrink-0 font-mono text-meta text-muted-foreground"
            >
              {age ?? (showDate ? formatDateTime(message.sent_at) : formatTime(message.sent_at))}
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
              {headlineSegments ? (
                <Highlighted segments={headlineSegments} />
              ) : (
                (headline ?? 'Empty message')
              )}
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

          {/*
            The snippet wins over the preview when there is one. `ts_headline`
            already picked the fragments that contain the search terms, and on
            a result row "why did this match" is the only question — the
            message's opening line is what the timeline shows and is usually
            not where the hit is.

            Rendered as elements, never as HTML: `highlightSegments` exists so
            that a message body — written by somebody else — never reaches
            `dangerouslySetInnerHTML`. Not truncated with `truncate` either,
            because a fragment cut at the viewport edge can lose the very word
            that was highlighted; two lines are clamped instead.
          */}
          {!open && snippet && snippet.length > 0 && !snippetIsHeadline ? (
            <span className="mt-0.5 block line-clamp-2 text-row text-muted-foreground">
              <Highlighted segments={snippet} />
            </span>
          ) : (
            !open &&
            showPreview && (
              <span className="mt-0.5 block truncate text-row text-muted-foreground">
                {line}
              </span>
            )
          )}
        </button>

        {open && (
          <div id={panelId} className="animate-unfold mt-2.5">
            <p className={cn(LABEL, 'mb-2')}>
              {channelLabel ?? 'Unknown channel'} · {formatFullTimestamp(message.sent_at)}
              {address && <span className="sm:hidden"> · {address}</span>}
            </p>

            {/*
              ── The AI summary (Phase 4A, ADR-015) ──────────────────────────
              Ms. Maria's founding request, 2026-07-25: "view whatsapp messages
              real time AND HAVE AI SUMMARIZE". Three rules govern where it may
              appear, and all three are load-bearing:

              1. **In the opened row only** — never in the headline, never in
                 the preview line. The timeline's headline rule is *whatever the
                 message leads with*, and ADR-015 rejects putting a paraphrase
                 where a person's own sentence belongs. It is the one change
                 that would make this console untrustworthy.
              2. **Above the body, and the body is always right there.** The
                 original is one glance away, always. This is the defence that
                 holds even if a prompt injection succeeds — a reader compares.
              3. **In the machine voice.** Mono, the register this design
                 reserves for what the *system* knows, against sans for what a
                 *person* wrote. On a console whose whole premise is separating
                 those two, a machine paraphrase set in the human voice is the
                 wrong signal — and the change of typeface says "generated"
                 faster than the label does.

              The label names the model rather than saying "AI", because
              `extractions.model` is recorded per row precisely so this question
              is answerable (ADR-006), and "written by llama-3.1-8b-instant" is
              a more honest claim than "AI summary".
            */}
            {/*
              ⚠ A NEUTRAL rule, deliberately — not the amber one.

              This was `border-live/40` for one draft. Two things were wrong
              with that. It measured 1.44:1 against the light background, so it
              was invisible and doing no work at all. And more importantly it
              borrowed `--live`, which this console reserves for exactly one
              meaning: *the board is receiving*. The README's rule is that
              colour here carries channel identity or liveness and nothing else,
              and that discipline is what lets a 7px dot carry the product's
              central distinction. A summary is neither of those things.

              It does not need a hue. The register change — mono against sans —
              and the label above already say "the machine wrote this", and both
              of those survive being colour-blind, which a tint does not.
            */}
            {message.summary && (
              <div className="mb-3 border-l-2 border-border pl-3">
                <p className={cn(LABEL, 'mb-1')}>
                  Summary · generated by{' '}
                  <span className="normal-case">{message.summary.model}</span>
                </p>
                <p className="max-w-[62ch] font-mono text-note text-muted-foreground">
                  {message.summary.text}
                </p>
              </div>
            )}

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
        </div>
      </div>
    </li>
  );
}

/** Collapses runs of whitespace, so the two paths a body arrives by compare. */
function normaliseSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A snippet's matched runs, as elements.
 *
 * ⚠ Elements, never `dangerouslySetInnerHTML`. `ts_headline`'s default
 * delimiters are `<b>` tags, and every body in this table was written by
 * somebody else — an email is free to contain `<img onerror=…>`. Rendering
 * segments as React children means React escapes them, so there is no path
 * from a message body to executable markup. `lib/search.ts` pins that with a
 * test.
 *
 * `bg-live/20` rather than a new colour: amber is already this console's one
 * reserved "the system is telling you something" hue, and a search hit is
 * exactly that. Adding a fourth colour would be the thing the design notes
 * refuse — colour here means channel, or live, and nothing else.
 */
function Highlighted({ segments }: { segments: HighlightSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded-[2px] bg-live/20 px-0.5 text-foreground">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Who sent it, as one or two letters.
 *
 * ── Why it is monochrome ─────────────────────────────────────────────────────
 *
 * A hue per contact is the conventional build and it is wrong here. This
 * interface already spends colour on exactly two meanings — which channel a
 * message came in on, and whether the board is live — and that discipline is
 * what lets a 7px dot carry the product's central distinction. A rainbow of
 * contact colours would sit beside those with no meaning attached and make all
 * three read as decoration. The letters do the identifying; they differ from
 * each other far more than a set of pastel circles would.
 *
 * ── Why a rounded square ─────────────────────────────────────────────────────
 *
 * There is already a circle on this row, 10px to the left: the channel lamp.
 * Two round things adjacent read as one repeated element. Square means
 * identity, round means signal — and the shape difference survives being
 * skimmed, which is the whole job.
 *
 * Decorative, so `aria-hidden`: the sender's name is directly beside it and a
 * screen reader spelling out "M S" first is noise.
 */
function Avatar({ initials, outbound }: { initials: string; outbound: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md',
        'text-label font-semibold tracking-normal',
        // Your own messages invert, so "me" is separable from every contact at
        // a glance without reading the name.
        outbound
          ? 'bg-foreground text-background'
          : 'bg-accent text-foreground',
      )}
    >
      {initials}
    </span>
  );
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Date and time, for rows that do not sit under a day heading.
 *
 * Short month rather than a numeric date: `07/08` is ambiguous between two
 * conventions and this project's readers use both, while "7 Aug" is not
 * ambiguous to anyone. No year — a result older than a year is rare enough
 * that the row's `title` carrying the full stamp is the right place for it.
 */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    day: 'numeric',
    month: 'short',
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

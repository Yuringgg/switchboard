import type { ChannelType } from '@switchboard/core';

import { cn } from '@/lib/utils';

/**
 * The landing page's one moving thing — and it is the product diagram, not
 * decoration.
 *
 * ── What it says ─────────────────────────────────────────────────────────────
 *
 * Three lines come in on the left. Every message on any of them is patched
 * through one jack field in the middle. One ordered record comes out on the
 * right, and each row still carries the colour of the line it arrived on.
 *
 * ⚠ It was two until Phase 7. Meetings is a real connected channel, and a
 * product diagram that shows fewer lines than the product has is the one thing
 * this figure cannot afford to be — a visitor reads it instead of the copy.
 *
 * That is the entire product in one picture: *many lines in, one operator's
 * view out*, which is also the name. A visitor who reads nothing else on the
 * page should be able to answer "what does this do?" from this alone — which is
 * the bar Ms. Maria set for the landing page on 2026-08-05.
 *
 * ── ⚠ Why every animated element is legible when nothing animates ────────────
 *
 * The cords, the jacks, the labels and all five rows are drawn at full opacity
 * in the resting frame. The motion moves things that are already on screen; it
 * never reveals them. Three separate reasons, and each has already cost
 * somebody time:
 *
 *   · `prefers-reduced-motion` collapses every animation in this stylesheet to
 *     0.01ms and one iteration, so the resting frame IS what a reader with that
 *     preference sees. It has to be a finished picture.
 *   · This project's browser pane does not composite — rAF, IntersectionObserver
 *     and ResizeObserver deliver zero callbacks in it — and a headless renderer
 *     or a hidden tab behaves the same way. A diagram gated on a scroll-reveal
 *     is a diagram that ships blank to a defence panel.
 *   · There is no JavaScript here at all. This is the one page a stranger loads
 *     first, and it should cost them nothing.
 *
 * ── ⚠ `pathLength="100"` on every cord is load-bearing ───────────────────────
 *
 * It renormalises each cord's dash units so a single set of keyframes drives
 * paths of very different real lengths at the same apparent speed. Remove it
 * and the five signals drift out of step, in a way that reads as five different
 * animations rather than five messages on one board. The dash arithmetic that
 * depends on it is worked out in full on `@keyframes cord-signal` in
 * `globals.css`; do not change the dasharray without reading it.
 *
 * ── Colour ───────────────────────────────────────────────────────────────────
 *
 * The three channel hues and amber, and nothing else — the same meanings the
 * console spends colour on. ⚠ Gmail red against WhatsApp green is the worst
 * pair for red/green colour blindness, so exactly as in the timeline, **the
 * colour is never the only carrier**: every source is named in words, and the
 * figure carries a text alternative for anyone who cannot see it at all.
 *
 * Meetings blue is the one hue here that survives that axis, which is why it
 * did NOT change the rule — it makes two of three legible, not three.
 */

/**
 * Where each line sits on the left edge.
 *
 * ⚠ Named rather than repeated as literals in SIGNALS below. They were written
 * out at every use, so moving a source meant finding every copy of `96`, and
 * the jack field is full of numbers that look just like it.
 *
 * Spread about the jack field's own centre (168), so the cords fan rather than
 * all sweeping the same way.
 */
const SOURCE_Y = {
  gmail: 74,
  meeting: 168,
  whatsapp: 262,
} as const;

/**
 * One message on the board: which line it came in on, and which jack it takes.
 *
 * ⚠ Two Gmail, two WhatsApp, one meeting — and the ratio is deliberate. A
 * meeting arrives once, after the fact, where mail and chat arrive all day.
 * Five even cords would draw a product that does not exist.
 */
const SIGNALS = [
  { channel: 'gmail', sourceY: SOURCE_Y.gmail, jackY: 52 },
  { channel: 'meeting', sourceY: SOURCE_Y.meeting, jackY: 110 },
  { channel: 'whatsapp', sourceY: SOURCE_Y.whatsapp, jackY: 168 },
  { channel: 'gmail', sourceY: SOURCE_Y.gmail, jackY: 226 },
  { channel: 'whatsapp', sourceY: SOURCE_Y.whatsapp, jackY: 284 },
] as const;

/**
 * One full cycle. Five signals share it on an even stagger, so a message is
 * landing roughly every 0.72s — busy enough to read as a live board, slow
 * enough that the eye can follow one cord from end to end.
 */
const CYCLE_MS = 3600;

/*
 * ⚠ Typed `Record<ChannelType, …>`, so a fourth channel added to the canonical
 * union makes this file fail to typecheck until the diagram accounts for it.
 * Same mechanism as `lib/channels.ts` and `lib/voice/tools.ts`. A product
 * picture that silently keeps showing the old channel count is exactly the kind
 * of wrong nobody notices.
 *
 * ⚠ Written out in full rather than built from a template. Tailwind only ships
 * classes it can find as literal text, so `stroke-channel-${type}` compiles to
 * nothing and the cords would render unstyled.
 */
const STROKE: Record<ChannelType, string> = {
  gmail: 'stroke-channel-gmail',
  whatsapp: 'stroke-channel-whatsapp',
  meeting: 'stroke-channel-meeting',
};

const FILL: Record<ChannelType, string> = {
  gmail: 'fill-channel-gmail',
  whatsapp: 'fill-channel-whatsapp',
  meeting: 'fill-channel-meeting',
};

export function PatchField({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 760 340"
      className={cn('h-auto w-full', className)}
      role="img"
      aria-label={
        'A diagram of the switchboard: Gmail, WhatsApp and meetings on the left, all ' +
        'three patched through one jack field in the middle, arriving as a single ' +
        'ordered list of messages on the right, each still marked with the channel ' +
        'it came in on.'
      }
    >
      {/* ── The three lines coming in ───────────────────────────────────────── */}
      <SourceLine y={SOURCE_Y.gmail} channel="gmail" label="Gmail" />
      <SourceLine y={SOURCE_Y.meeting} channel="meeting" label="Meetings" />
      <SourceLine y={SOURCE_Y.whatsapp} channel="whatsapp" label="WhatsApp" />

      {/*
        ── The cords ──────────────────────────────────────────────────────────
        Drawn twice: a static hairline that is always there, and a bright dash
        travelling along an identical path on top of it. Two elements rather
        than one animated stroke, so that with motion off the cords are still
        drawn and the board still reads as patched.
      */}
      {SIGNALS.map((signal, index) => {
        const d = cordPath(signal.sourceY, signal.jackY);
        const delay = `${(index * CYCLE_MS) / SIGNALS.length}ms`;

        return (
          <g key={index}>
            <path
              d={d}
              pathLength="100"
              fill="none"
              className="stroke-border"
              strokeWidth={1.25}
            />
            <path
              d={d}
              pathLength="100"
              fill="none"
              strokeWidth={2.5}
              strokeLinecap="round"
              style={{ animationDelay: delay }}
              className={cn('animate-cord-signal', STROKE[signal.channel])}
            />
          </g>
        );
      })}

      {/* ── The board itself ────────────────────────────────────────────────── */}
      <rect
        x={252}
        y={20}
        width={76}
        height={300}
        rx={10}
        className="fill-panel stroke-border"
        strokeWidth={1.25}
      />

      {SIGNALS.map((signal, index) => {
        const delay = `${(index * CYCLE_MS) / SIGNALS.length}ms`;

        return (
          <g key={index}>
            {/* The jack. A ring, not a filled dot: it is a socket. */}
            <circle
              cx={290}
              cy={signal.jackY}
              r={7}
              className="fill-background stroke-faint"
              strokeWidth={1.5}
            />
            <circle cx={290} cy={signal.jackY} r={2.75} className="fill-faint" />

            {/* The lamp above the jack — the one amber thing on the board. */}
            <circle
              cx={290}
              cy={signal.jackY - 17}
              r={2.4}
              style={{ animationDelay: delay }}
              className="animate-jack-lamp fill-live"
            />
          </g>
        );
      })}

      {/* ── The record ──────────────────────────────────────────────────────── */}
      {SIGNALS.map((signal, index) => {
        const top = signal.jackY - 22;
        const delay = `${(index * CYCLE_MS) / SIGNALS.length}ms`;

        return (
          <g
            key={index}
            style={{ animationDelay: delay }}
            className="animate-record-land"
          >
            <rect
              x={396}
              y={top}
              width={352}
              height={44}
              rx={8}
              className="fill-panel stroke-border"
              strokeWidth={1.25}
            />

            {/* Which line this row came in on. */}
            <circle cx={416} cy={top + 22} r={3.5} className={FILL[signal.channel]} />

            {/* The subject, and the line under it. Bars rather than lorem text:
                a diagram that pretends to contain real mail invites the reader
                to try to read it, and this is a picture of the shape of the
                record, not a screenshot of one. */}
            <rect
              x={432}
              y={top + 13}
              width={rowWidth(index)}
              height={7}
              rx={3.5}
              className="fill-foreground/70"
            />
            <rect
              x={432}
              y={top + 26}
              width={rowWidth(index) * 0.62}
              height={5}
              rx={2.5}
              className="fill-muted-foreground/45"
            />

            {/* Arrived. The same amber the console's new-message pill uses. */}
            <circle
              cx={732}
              cy={top + 22}
              r={3}
              style={{ animationDelay: delay }}
              className="animate-row-lamp fill-live"
            />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A labelled source on the left edge.
 *
 * ⚠ The name is set in the SVG rather than left to the colour. Both of this
 * product's channel hues sit on the red/green axis, and "which line did this
 * come in on" is the one question it exists to answer — the same rule
 * `channelChangePoints` enforces in the real timeline.
 */
function SourceLine({
  y,
  channel,
  label,
}: {
  y: number;
  channel: ChannelType;
  label: string;
}) {
  return (
    <g>
      <rect
        x={4}
        y={y - 19}
        width={116}
        height={38}
        rx={19}
        className="fill-panel stroke-border"
        strokeWidth={1.25}
      />
      <circle cx={28} cy={y} r={4} className={FILL[channel]} />
      <text
        x={44}
        y={y}
        dominantBaseline="central"
        className="fill-foreground font-mono text-[12px] font-medium tracking-[0.06em]"
      >
        {label}
      </text>
    </g>
  );
}

/**
 * Source → jack → row, as one continuous path.
 *
 * One path per message rather than a cord to the board and a second cord out of
 * it: the point of the picture is that a message keeps its identity all the way
 * through, so the line that carries it should not be cut in half at the panel.
 * The straight tail after the curve passes behind the board and out the other
 * side, which is what a patched cord actually looks like.
 */
function cordPath(sourceY: number, jackY: number): string {
  return `M 120,${sourceY} C 186,${sourceY} 214,${jackY} 290,${jackY} L 396,${jackY}`;
}

/** Varied so the record reads as real mail rather than a repeated component. */
function rowWidth(index: number): number {
  return [214, 158, 246, 186, 138][index] ?? 190;
}

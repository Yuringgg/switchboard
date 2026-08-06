import {
  CalendarPlus,
  ListChecks,
  Mail,
  MessageCircle,
  ScanText,
  Search,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { SwitchboardMark } from '@/components/brand';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The auth screens' left panel: the board, with everything it handles in orbit
 * around it.
 *
 * ── ⚠ Why none of the original's icons survived ──────────────────────────────
 *
 * The component this is adapted from orbited HTML5, CSS3, TypeScript,
 * JavaScript, Tailwind, Next.js, React, Figma and Git around the words
 * "Animated Login". That is a portfolio piece: it advertises the author's
 * stack to a visitor who has not asked and does not care. On the first screen
 * of a product it is worse than decoration — it tells somebody about to type a
 * password what the site is *built with* instead of what it *does*.
 *
 * What orbits here is the product's own vocabulary, and each ring means
 * something:
 *
 *   · **inner** — the two lines that come in. Gmail and WhatsApp, in their own
 *     channel colours, which are the same two hues the timeline uses. This is
 *     the one ring a stranger has to understand.
 *   · **middle** — what the board does to a message once it lands: summarise,
 *     extract, queue.
 *   · **outer** — what you can then do with the record: search it, ask it,
 *     put a meeting on a calendar.
 *
 * At the centre, the mark itself. Many lines in, one operator's view out.
 *
 * ── ⚠ Pure CSS, and nothing here is load-bearing ─────────────────────────────
 *
 * Same reasoning as the landing page's patch field: the orbit and the rings run
 * on CSS keyframes with no rAF, no library and no observer, so they degrade to
 * a still arrangement rather than to an empty panel. And the whole thing is
 * `aria-hidden` behind a real heading — it is illustration beside a login form,
 * and a screen reader walking seven orbiting glyphs learns nothing from them.
 *
 * It is also `hidden lg:flex` at the call site. On a phone this panel would
 * push the form the visitor actually came for below the fold.
 */

interface Orbiter {
  icon: LucideIcon;
  /** Screen-reader-invisible; used as the `title` for a pointer user. */
  label: string;
  radius: number;
  duration: number;
  delay: number;
  className?: string;
  size: string;
}

const ORBITERS: Orbiter[] = [
  // The two lines in. Coloured, because these are the only two things on this
  // panel whose colour carries meaning anywhere else in the product.
  {
    icon: Mail,
    label: 'Gmail',
    radius: 92,
    duration: 26,
    delay: 0,
    className: 'text-channel-gmail border-channel-gmail/35',
    size: 'size-9',
  },
  {
    icon: MessageCircle,
    label: 'WhatsApp',
    radius: 92,
    duration: 26,
    delay: 13,
    className: 'text-channel-whatsapp border-channel-whatsapp/35',
    size: 'size-9',
  },

  // What happens to a message once it lands.
  {
    icon: Sparkles,
    label: 'Summarised on arrival',
    radius: 150,
    duration: 34,
    delay: 0,
    size: 'size-8',
  },
  {
    icon: ScanText,
    label: 'Meetings and commitments extracted',
    radius: 150,
    duration: 34,
    delay: 17,
    size: 'size-8',
  },

  // What you can do with the record afterwards.
  {
    icon: Search,
    label: 'Searchable across every channel',
    radius: 208,
    duration: 44,
    delay: 0,
    size: 'size-8',
  },
  {
    icon: ListChecks,
    label: 'Queued on the attention board',
    radius: 208,
    duration: 44,
    delay: 15,
    size: 'size-8',
  },
  {
    icon: CalendarPlus,
    label: 'Added to your calendar, on your say-so',
    radius: 208,
    duration: 44,
    delay: 30,
    size: 'size-8',
  },
];

/** The radii that get a drawn ring. Matches the three groups above. */
const RINGS = [92, 150, 208];

export function SwitchboardOrbit({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative flex min-h-[34rem] items-center justify-center overflow-hidden',
        className,
      )}
    >
      {/*
        The rings, breathing. `--live`-free on purpose: amber in this product
        means a socket is genuinely open, and nothing on a signed-out screen
        is receiving anything.
      */}
      {RINGS.map((radius, index) => (
        <span
          key={radius}
          // Inline because the radii are data. ⚠ A Tailwind class built by
          // interpolation (`size-[${radius}px]`) is not in the stylesheet at
          // all — the scanner reads source text, not runtime values.
          style={{
            width: radius * 2,
            height: radius * 2,
            animationDelay: `${index * 0.35}s`,
          }}
          className="animate-ripple absolute top-1/2 left-1/2 rounded-full border border-border"
        />
      ))}

      {/* The board. */}
      <span className="relative z-10 flex size-16 items-center justify-center rounded-2xl border border-border bg-panel">
        <SwitchboardMark className="size-7" />
      </span>

      {ORBITERS.map((orbiter) => {
        const Icon = orbiter.icon;

        return (
          <span
            key={orbiter.label}
            title={orbiter.label}
            style={
              {
                '--orbit-radius': orbiter.radius,
                '--orbit-duration': orbiter.duration,
                '--orbit-delay': orbiter.delay,
              } as React.CSSProperties
            }
            className={cn(
              'animate-orbit absolute flex items-center justify-center rounded-full',
              'border border-border bg-background text-muted-foreground',
              orbiter.size,
              orbiter.className,
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
        );
      })}
    </div>
  );
}

/**
 * The panel as it appears beside the form — the orbit plus the one sentence a
 * stranger needs.
 *
 * ⚠ The sentence is a real heading in the accessibility tree, not decoration.
 * The illustration is hidden from it, so without this the left half of this
 * screen would be silent.
 */
export function AuthAside() {
  return (
    <aside className="relative hidden flex-col justify-center border-r border-border bg-panel/40 px-10 lg:flex">
      <SwitchboardOrbit />

      <div className="relative z-10 mx-auto max-w-[34ch] pb-14 text-center">
        <h2 className="text-2xl font-semibold text-balance">
          Many lines in, one operator&rsquo;s view out.
        </h2>
        <p className={cn(LABEL, 'mt-3 normal-case')}>
          Gmail and WhatsApp arrive in one ordered record. A model reads each
          one as it lands and shows you the sentence it read.
        </p>
      </div>
    </aside>
  );
}

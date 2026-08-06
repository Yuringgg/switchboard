import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A shutter that clears off an element as the page settles.
 *
 * ── ⚠ Adapted from a framer-motion component, and the adaptation is the point
 *
 * It was supplied as `BoxReveal`: `useInView` + `useAnimation`, content held at
 * `opacity: 0` behind `variants.hidden` until an IntersectionObserver fires.
 * Dropped in as given it would have shipped a **blank sign-in form** in this
 * project, for a reason that has nothing to do with taste — this environment's
 * browser pane delivers zero IntersectionObserver callbacks, and neither does a
 * headless renderer or a tab that is never painted. A gate that never opens is
 * not a missing animation; it is a login page with no fields on it.
 *
 * There is also no scroll to observe. The auth form is above the fold by
 * definition, so "reveal when it scrolls into view" is answering a question
 * this screen never asks.
 *
 * So: **no library, no observer, and the resting state IS the finished state.**
 * The CSS in `globals.css` animates content *away and back*; with animations
 * disabled, collapsed by `prefers-reduced-motion`, or never run at all, what
 * renders is the completed layout. The visual idea survives intact.
 *
 * A server component — there is no state and no effect left to hold.
 */
export function BoxReveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Seconds. Stagger a stack by handing each item a slightly larger one. */
  delay?: number;
  className?: string;
}) {
  return (
    /*
     * `animationDelay` is set on the WRAPPER and inherited by both the content
     * and the bar (`animation-delay: inherit` in the utility). Setting it on
     * each separately is how the two drift apart by a frame and the bar clears
     * text that has not risen yet.
     *
     * ⚠ `overflow-hidden` would clip a focus ring on anything inside — which on
     * this screen is every input. The bar is parked at `translateX(101%)`
     * instead, so it needs no clipping to stay out of sight.
     */
    <div
      className={cn('reveal', className)}
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}

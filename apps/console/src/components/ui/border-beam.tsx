import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A light that travels around a border.
 *
 * ── Why this is CSS and not the `border-beam` package ───────────────────────
 *
 * The drop this came from asks for `npm i border-beam`. That package is real —
 * v1.3.0, 156 KB unpacked, one maintainer — and it is 156 KB to draw a rotating
 * gradient. This is that, in about thirty lines, with no dependency to audit,
 * no peer-range to keep happy, and nothing new inside the pre-commit
 * supply-chain check.
 *
 * It is also this project's own precedent:
 * `correspondence/2026-08-09-design-revisions.md` §5 records three component
 * drops adopted and rebuilt on CSS, none pasted.
 *
 * ── How it works ────────────────────────────────────────────────────────────
 *
 * A conic gradient, larger than the box, spinning. The child sits on top inset
 * by one pixel, so only that one-pixel rim of the gradient is ever visible —
 * which reads as a light running around the edge.
 *
 * ⚠ `overflow-hidden` on the wrapper is load-bearing. Without it the gradient
 * square hangs out past the corners and the effect becomes a spinning rectangle
 * behind the panel.
 */
export function BorderBeam({
  children,
  className,
  /** Seconds for one lap. Slower reads as ambient; faster reads as urgent. */
  duration = 8,
  /** Dim it when nothing is happening, so it never competes with the words. */
  active = true,
}: {
  children: ReactNode;
  className?: string;
  duration?: number;
  active?: boolean;
}) {
  return (
    <div className={cn('relative isolate overflow-hidden rounded-xl', className)}>
      {/*
        The spinning gradient. `inset-[-100%]` makes it comfortably bigger than
        the box in every direction, so a rotation never exposes a corner.

        ⚠ `prefers-reduced-motion` is handled by the global rule in globals.css,
        which collapses the animation. The beam then rests as a static gradient
        edge rather than vanishing — the border is still drawn, it simply stops
        travelling.
      */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-[-100%] -z-10',
          'motion-safe:animate-[beam-spin_var(--beam-duration)_linear_infinite]',
          active ? 'opacity-100' : 'opacity-40',
          'transition-opacity duration-500',
        )}
        style={
          {
            '--beam-duration': `${duration}s`,
            /*
             * Transparent for most of the sweep so it reads as one travelling
             * light rather than a rainbow ring. The colours are the console's
             * own tokens, so it follows the theme instead of fighting it.
             */
            background:
              'conic-gradient(from 0deg, transparent 0deg 300deg, ' +
              'var(--color-primary) 340deg, var(--color-live) 355deg, transparent 360deg)',
          } as React.CSSProperties
        }
      />

      {/*
        The panel itself, one pixel in from the edge — which is what turns the
        gradient behind it into a border rather than a background.
      */}
      <div className="relative rounded-[calc(var(--radius)+0.25rem)] bg-panel inset-ring inset-ring-border/60 m-px">
        {children}
      </div>
    </div>
  );
}

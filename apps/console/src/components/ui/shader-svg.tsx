'use client';

import { MeshGradient } from '@paper-design/shaders-react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * The assistant's face — a rounded figure filled with a live mesh gradient,
 * whose eyes follow the pointer and blink.
 *
 * ── Why this folder ──────────────────────────────────────────────────────────
 *
 * `@/components/ui` is shadcn's namespace (`components.json` aliases it), so
 * anything living here must be a *generic* piece with no knowledge of the
 * console's data. This file holds the figure and nothing else; the assistant
 * screen decides what it means — see `components/assistant-ghost.tsx`.
 *
 * ⚠ **Do not name a file here after a shadcn component** (`button`, `card`,
 * `dialog`…). `pnpm dlx shadcn@latest add <name>` writes into this folder and
 * would silently overwrite it. Same reasoning as the note in `lib/ui.ts`.
 *
 * ── What was changed from the source snippet, and why ────────────────────────
 *
 * Five things, each of which fails silently rather than loudly:
 *
 * 1. **`document.querySelector('svg')` measured the wrong element.** It returns
 *    the *first* SVG in the document, which in this app is the Switchboard mark
 *    in the sidebar — so the eyes tracked the pointer relative to the logo, and
 *    looked increasingly wrong the further down the page the figure sat. It is
 *    a `ref` now.
 * 2. **The clip path's id was a global constant.** Two figures on one page (a
 *    nav mark and this one) would both define `#shapeClip`, the first would
 *    win, and the second would be clipped by whichever definition the document
 *    happened to hold. `useId()` makes it per-instance — sanitised, because
 *    React's generated ids contain characters that are not safe in a URL
 *    fragment.
 * 3. **Pointer tracking re-rendered the component on every mouse move.** Two
 *    `useState`s in sequence, so a mouse crossing the screen re-rendered the
 *    shader's parent a few hundred times. It is a `MotionValue` now: the
 *    transform is written straight to the DOM and React never re-renders.
 * 4. **`ry: 30` in the blink keyframes is not valid CSS.** `ry` is a length, and
 *    a unitless number is only legal for `0` — the whole keyframe was dropped
 *    and the figure never blinked, with no error anywhere. It is `30px` now,
 *    and it lives in `globals.css` beside `animate-lamp` rather than in
 *    `styled-jsx`, matching how every other animation in this console is
 *    declared.
 * 5. **Nothing respected `prefers-reduced-motion`.** The stylesheet's global
 *    reduce rule only reaches CSS animations; framer-motion writes inline
 *    styles and the shader runs its own rAF loop, so both ignored it. The
 *    figure now holds still, and `speed={0}` stops the shader's loop outright
 *    rather than just hiding it.
 */

/**
 * Pink → sky → deep navy, as supplied. It is worth saying why it was kept
 * rather than restyled into the console's own palette: the ramp *ends* on
 * `#1A1A2E`, which sits within a few points of `--background` in dark mode, so
 * the figure grounds itself into the page instead of floating on it. The two
 * light hues are the only unreserved colour in the product — amber means "the
 * board is live" and red/green mean Gmail/WhatsApp, and none of those may be
 * spent on decoration.
 */
const COLORS = ['#FFB3D9', '#87CEEB', '#4A90E2', '#2C3E50', '#1A1A2E'];

/**
 * Painted underneath the shader canvas, always.
 *
 * WebGL fails for reasons this app cannot detect or influence — a blocked
 * context, a lost context on a laptop switching GPUs, a hardened browser. The
 * failure mode without this is a hole in the page in the shape of a ghost. The
 * canvas simply paints over it when it works, so this costs one gradient.
 */
const FALLBACK =
  'radial-gradient(120% 90% at 24% 10%, #FFB3D9 0%, transparent 56%),' +
  'radial-gradient(110% 80% at 82% 32%, #87CEEB 0%, transparent 60%),' +
  'linear-gradient(163deg, #4A90E2 0%, #2C3E50 52%, #1A1A2E 100%)';

/** How far the eyes travel from centre, in user units. */
const MAX_OFFSET = 8;

export function MeshGradientSVG({
  className,
  /**
   * Reading rather than listening: the eyes stop following the pointer and scan
   * left to right instead. It is the one piece of state the figure carries, and
   * it is what makes it read as *the thing answering* rather than a mascot
   * parked next to a form.
   */
  busy = false,
}: {
  className?: string;
  busy?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const reduceMotion = useReducedMotion();

  // Sanitised: React 19 generates ids like «r0», and neither guillemets nor the
  // colons of earlier versions are safe inside `url(#…)`.
  const clipId = `ghost-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // The pointer target, and the eyes' actual position lagging behind it. Both
  // are MotionValues, so moving the mouse writes a transform and nothing more.
  const targetX = useMotionValue(0);
  const targetY = useMotionValue(0);
  const eyeX = useSpring(targetX, { stiffness: 150, damping: 15 });
  const eyeY = useSpring(targetY, { stiffness: 150, damping: 15 });

  /**
   * The shader is mounted only after the first client render.
   *
   * It is not that the library cannot render on the server — it can, and says
   * so. It is that a WebGL canvas is the single most fragile thing on this
   * screen, and the assistant is the screen the product is demonstrated on. The
   * gradient below is already correct at first paint either way.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Following the pointer. Skipped entirely while reading, and while the
  // reader has asked for less motion — in both cases the listener is never
  // attached rather than attached and ignored.
  useEffect(() => {
    if (busy || reduceMotion) return;

    const onMove = (event: MouseEvent) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;

      const dx = (event.clientX - (rect.left + rect.width / 2)) * 0.08;
      const dy = (event.clientY - (rect.top + rect.height / 2)) * 0.08;

      targetX.set(clamp(dx, MAX_OFFSET));
      targetY.set(clamp(dy, MAX_OFFSET));
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [busy, reduceMotion, targetX, targetY]);

  // Reading: a slow sweep left and right. The spring does the smoothing, so
  // alternating a target twice a second is the whole implementation.
  useEffect(() => {
    if (!busy || reduceMotion) {
      if (!busy) return;
      // Reduced motion still needs the eyes recentred, or they keep whatever
      // the pointer last left them at while the answer is being fetched.
      targetX.set(0);
      targetY.set(0);
      return;
    }

    let left = true;
    targetX.set(-5);
    targetY.set(2);

    const scan = setInterval(() => {
      left = !left;
      targetX.set(left ? -5 : 5);
    }, 620);

    return () => clearInterval(scan);
  }, [busy, reduceMotion, targetX, targetY]);

  return (
    <motion.div
      className={cn('relative w-full max-w-[136px]', className)}
      // Breathing. `transformOrigin: top center` is what makes the vertical
      // squash read as a hover rather than a wobble.
      animate={reduceMotion ? undefined : { y: [0, -8, 0], scaleY: [1, 1.08, 1] }}
      transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      style={{ transformOrigin: 'top center' }}
    >
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        width="231"
        height="289"
        viewBox="0 0 231 289"
        className="h-auto w-full"
        /*
         * Decorative. The figure carries no information the caller does not
         * also state in text directly beside it — see `assistant-ghost.tsx`,
         * where the status is a real string in the machine voice. Labelling
         * this as an image as well would announce the same fact twice.
         */
        aria-hidden
      >
        <defs>
          <clipPath id={clipId}>
            <path d="M230.809 115.385V249.411C230.809 269.923 214.985 287.282 194.495 288.411C184.544 288.949 175.364 285.718 168.26 280C159.746 273.154 147.769 273.461 139.178 280.23C132.638 285.384 124.381 288.462 115.379 288.462C106.377 288.462 98.1451 285.384 91.6055 280.23C82.912 273.385 70.9353 273.385 62.2415 280.23C55.7532 285.334 47.598 288.411 38.7246 288.462C17.4132 288.615 0 270.667 0 249.359V115.385C0 51.6667 51.6756 0 115.404 0C179.134 0 230.809 51.6667 230.809 115.385Z" />
          </clipPath>
        </defs>

        <foreignObject width="231" height="289" clipPath={`url(#${clipId})`}>
          <div className="h-full w-full" style={{ background: FALLBACK }}>
            {mounted && (
              <MeshGradient
                colors={COLORS}
                className="h-full w-full"
                speed={reduceMotion ? 0 : 1}
              />
            )}
          </div>
        </foreignObject>

        {/*
          Both eyes move together on one group rather than each animating its
          own `cx`/`cy`. Two eyes that can drift apart is a bug waiting to be
          filed, and a single transform is also the cheaper thing for the
          compositor to run on every frame.
        */}
        <motion.g style={{ x: eyeX, y: eyeY }}>
          <ellipse cx={80} cy={120} rx={20} ry={30} fill="#16162c" className="animate-blink" />
          <ellipse cx={150} cy={120} rx={20} ry={30} fill="#16162c" className="animate-blink" />
        </motion.g>
      </svg>
    </motion.div>
  );
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

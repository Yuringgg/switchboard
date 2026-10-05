import { flushSync } from 'react-dom';

import { setTheme, type Theme } from '@/lib/theme';

/**
 * Switching theme with a circular reveal — Yuri's 21st.dev pick, 2026-10-06.
 *
 * Going LIGHT, the new page grows out of the control you pressed as a circle
 * until it covers the screen. Going DARK, the old light page shrinks back into
 * it. The snippet it came from ran the circle from the middle of one panel;
 * here it starts at the control, so the change visibly comes from your click.
 *
 * ── How ──────────────────────────────────────────────────────────────────────
 *
 * The View Transitions API: the browser photographs the page, the theme is
 * applied, it photographs again, and the two photographs are stacked in
 * `::view-transition-old(root)` / `-new(root)`. A clip-path circle animated on
 * the top one does the reveal. The rules that turn the browser's own crossfade
 * off and choose which photograph is on top are in `globals.css`, under
 * THE THEME REVEAL, scoped to `html[data-theme-reveal]` so no other transition
 * is touched.
 *
 * ⚠ `flushSync` is load-bearing. The toggle reads the theme through
 * `useSyncExternalStore`, and the second photograph is taken as soon as the
 * update returns — without it the new page is photographed with the OLD option
 * still highlighted, and the highlight jumps after the circle finishes.
 *
 * ── ⚠ It can never leave the page stuck ──────────────────────────────────────
 *
 * The theme is applied inside the transition's update, so whatever happens to
 * the animation, the choice has already taken effect. A watchdog skips the
 * transition if the browser stalls (the snapshots are images; while they are
 * up the live page cannot be clicked). Where the API is missing (an older
 * browser), the user asked for reduced motion, or the colours would not change
 * (System → Dark on a dark machine), the theme simply switches.
 */

const DURATION_MS = 700;

type ThemeTransition = {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition: () => void;
};

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ThemeTransition;
};

/** A second click while the circle is still growing is applied directly. */
let running = false;

function resolvesDark(theme: Theme): boolean {
  return (
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  );
}

export async function switchTheme(next: Theme, origin?: { x: number; y: number }) {
  const root = document.documentElement;
  const doc = document as TransitionDocument;
  const toDark = resolvesDark(next);
  const changes = root.classList.contains('dark') !== toDark;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!changes || reduced || running || typeof doc.startViewTransition !== 'function') {
    setTheme(next);
    return;
  }

  running = true;
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  // To the farthest corner, so the circle covers the whole screen and no more.
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

  root.dataset.themeReveal = toDark ? 'dark' : 'light';
  const transition = doc.startViewTransition(() => {
    flushSync(() => setTheme(next));
  });
  const watchdog = window.setTimeout(() => transition.skipTransition(), DURATION_MS + 1500);
  let wave: Animation | undefined;

  try {
    await transition.ready;
    const point = `${x}px ${y}px`;
    const closed = `circle(0px at ${point})`;
    const open = `circle(${radius}px at ${point})`;
    wave = root.animate(
      { clipPath: toDark ? [open, closed] : [closed, open] },
      {
        duration: DURATION_MS,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        // Held at the end, so the last frame is never the unclipped photograph.
        fill: 'forwards',
        pseudoElement: toDark ? '::view-transition-old(root)' : '::view-transition-new(root)',
      },
    );
    /*
     * ⚠ Raced against the transition, not awaited alone. A stalled animation
     * (a background tab, a frozen compositor) never finishes; when the
     * watchdog skips the transition, `finished` settles and the cleanup runs.
     * Awaiting the wave alone left `running` stuck true — measured: every
     * later switch then lost its reveal.
     */
    await Promise.race([wave.finished, transition.finished]);
  } catch {
    // A failed snapshot or an interrupted animation: the theme is already set.
  } finally {
    // Skip first, then cancel: both land before the next frame, so the
    // unclipped photograph is never painted.
    transition.skipTransition();
    wave?.cancel();
    window.clearTimeout(watchdog);
    await transition.finished.catch(() => {});
    delete root.dataset.themeReveal;
    running = false;
  }
}

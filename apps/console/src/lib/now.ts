'use client';

import { useSyncExternalStore } from 'react';

/**
 * A shared, ticking "now".
 *
 * ── Why a store and not `useState` in the row ────────────────────────────────
 *
 * Relative timestamps have to re-render themselves or they are wrong within a
 * minute of being painted. Fifty rows each owning a `setInterval` is fifty
 * timers waking the tab up out of phase with each other; one store with one
 * interval is the same behaviour for one timer, and every row updates on the
 * same frame so the column never looks half-stale.
 *
 * ── Why the server snapshot is `0` ───────────────────────────────────────────
 *
 * `Date.now()` on the server is a different number from `Date.now()` in the
 * browser a moment later, so rendering it directly is a guaranteed hydration
 * mismatch — and "14m ago" vs "15m ago" is exactly the kind that React reports
 * as a wall of noise. `0` is a sentinel meaning *not mounted yet*; callers
 * render the absolute clock time until it becomes real. The clock is correct
 * on the server and correct in the browser, so nothing is ever wrong — the
 * phrasing just sharpens one frame after hydration.
 */

const TICK_MS = 30_000;

const listeners = new Set<() => void>();
let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, TICK_MS);
  }

  return () => {
    listeners.delete(listener);
    // Nothing on screen needs the clock any more. Left running, it keeps a
    // timer alive for a component tree that no longer exists.
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  if (now === 0) now = Date.now();
  return now;
}

function getServerSnapshot(): number {
  return 0;
}

/** Milliseconds since the epoch, or `0` before the client has mounted. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

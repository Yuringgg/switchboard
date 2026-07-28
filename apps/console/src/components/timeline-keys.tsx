'use client';

import { useEffect } from 'react';

import { SCROLLER_ID } from '@/components/live';

/**
 * Keyboard navigation for the timeline: j / k / g, and Home.
 *
 * ── It moves FOCUS, it does not track a selection ────────────────────────────
 *
 * The obvious build is a `selectedIndex` in state with a highlight ring drawn
 * from it. That produces a second notion of "where you are" sitting alongside
 * the browser's own, and the two drift the moment anyone presses Tab or clicks
 * a row — now there is a highlighted row and a focused row and they disagree.
 *
 * So `j` and `k` just move real DOM focus between the row buttons, which are
 * already focusable and already carry the focus ring. Everything else falls
 * out for free and stays correct: Enter and Space open a row because that is
 * what a focused `<button>` does, Tab still works, and a screen reader
 * announces the row it lands on with its expanded state. There is no new
 * state, and nothing to keep in sync.
 *
 * ── Why a global listener rather than per-row handlers ───────────────────────
 *
 * `j` has to work when focus is nowhere near the list — that is the point of
 * `g`, and it is what makes the first keypress after page load do something.
 */

/** Marks a row button as navigable. Set by `MessageRow`. */
export const ROW_ATTR = 'data-message-row';

/**
 * The rows a person can actually see.
 *
 * ⚠ Both filters are load-bearing, and a plain
 * `document.querySelectorAll('[data-message-row]')` is wrong.
 *
 * React streams suspended content into a `<div id="S:n" hidden>` parked at the
 * end of `<body>`, so while the timeline is behind a `<Suspense>` the document
 * holds a SECOND, hidden copy of every row — measured: 12 matches for 6
 * messages, the phantom set still showing a stale timestamp. Unfiltered, `j`
 * would walk off the end of the visible list into six rows nobody can see and
 * focus would vanish.
 *
 * Scoping to the scroller excludes that container, which lives outside it.
 * The visibility check is the belt to that braces: it also covers a row hidden
 * for any reason a later change introduces.
 */
function rows(): HTMLElement[] {
  const scroller: ParentNode = document.getElementById(SCROLLER_ID) ?? document;

  return Array.from(
    scroller.querySelectorAll<HTMLElement>(`[${ROW_ATTR}]`),
  ).filter((row) => row.offsetParent !== null);
}

/**
 * True when the keystroke belongs to whatever the user is typing in.
 *
 * Without this, `j` in the search field Phase 3 adds would jump the list
 * instead of typing a letter — the classic way single-key shortcuts break a
 * page, and much easier to prevent now than to discover later.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function focusRow(element: HTMLElement | undefined) {
  if (!element) return;
  element.focus();
  // `nearest` so a row already on screen does not get yanked to the middle;
  // only one that is off the edge moves, and only as far as it must.
  element.scrollIntoView({ block: 'nearest' });
}

export function TimelineKeys() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Never shadow a browser or OS shortcut.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;

      const all = rows();
      if (all.length === 0) return;

      const active = document.activeElement;
      const index = all.findIndex((row) => row === active || row.contains(active));

      switch (event.key) {
        case 'j': {
          event.preventDefault();
          // Not yet in the list: start at the top rather than at index 1.
          focusRow(index === -1 ? all[0] : all[Math.min(index + 1, all.length - 1)]);
          break;
        }
        case 'k': {
          event.preventDefault();
          focusRow(index === -1 ? all[0] : all[Math.max(index - 1, 0)]);
          break;
        }
        case 'g':
        case 'Home': {
          event.preventDefault();
          document
            .getElementById(SCROLLER_ID)
            ?.scrollTo({ top: 0, behavior: 'smooth' });
          focusRow(all[0]);
          break;
        }
        default:
          break;
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}

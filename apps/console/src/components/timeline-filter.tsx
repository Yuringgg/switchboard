'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';

import { CHANNELS } from '@/lib/channels';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * Which lines the timeline is showing (Ms. Maria, 2026-08-05).
 *
 * ── Why a real `<form method="get">`, same as /search ─────────────────────────
 *
 * The filter belongs in the URL. It survives a reload, it is a link somebody
 * can send, and it renders on the server so the filtered list arrives with the
 * document instead of after a client round trip. The one line of client
 * behaviour on top is that changing a chip submits immediately — a filter that
 * needs a second click on "Apply" reads as broken.
 *
 * ⚠ It also has to keep working with JavaScript still loading, which on this
 * console is not hypothetical. Hence the real submit button, visually hidden
 * only once hydration has clearly happened is *not* something CSS can know — so
 * it is always in the DOM, `sr-only`, and reachable by keyboard.
 *
 * ── ⚠ Why every channel is listed, not only the connected ones ───────────────
 *
 * `/search` deliberately hides its channel filter below two connected channels,
 * on the reasoning that offering a filter which can only ever return nothing
 * makes a working feature look broken. That reasoning is sound there and wrong
 * here, for a reason outside the code: **WhatsApp is not connected yet** — it is
 * blocked on Meta's developer verification, not on anything in this repo — so
 * hiding the control would have shipped Ms. Maria's request as no visible
 * change at all. That exact outcome has already cost this project two exchanges
 * once, with the mobile dock.
 *
 * So both lines are always offered, and an unconnected one says so on the chip
 * and cannot be selected. The reader learns the real state of the board instead
 * of being shown a shorter list and left to wonder.
 */
export function TimelineFilter({
  selected,
  connectedTypes,
}: {
  /** Channel types currently in the URL. Empty means every line. */
  selected: string[];
  /** Which of them the reader actually has. */
  connectedTypes: string[];
}) {
  const formRef = useRef<HTMLFormElement>(null);

  // `requestSubmit`, not `submit`: it fires the submit event and runs
  // validation where `.submit()` bypasses both. Guarded because a chip can be
  // clicked before hydration attaches the ref.
  const submit = () => formRef.current?.requestSubmit();

  const active = selected.length > 0;

  return (
    <form
      ref={formRef}
      action="/"
      method="get"
      className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className={cn(LABEL, 'float-left mr-2.5')}>Lines</legend>

        {CHANNELS.map(({ type, label, dotClass }) => {
          const connected = connectedTypes.includes(type);
          const checked = selected.includes(type);

          return (
            <label
              key={type}
              title={
                connected
                  ? `Show only ${label}`
                  : `${label} is not connected yet, so there is nothing to filter to`
              }
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-note transition-colors',
                // The ring goes on the visible chip rather than the checkbox,
                // which is `sr-only` and would draw its focus ring in a corner
                // of the screen.
                'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/45',
                !connected
                  ? 'cursor-not-allowed border-border bg-panel text-muted-foreground'
                  : checked
                    ? 'cursor-pointer border-input bg-accent font-medium text-foreground'
                    : 'cursor-pointer border-border bg-panel text-muted-foreground hover:border-input hover:text-foreground',
              )}
            >
              <input
                type="checkbox"
                name="channel"
                value={type}
                defaultChecked={checked}
                disabled={!connected}
                onChange={submit}
                className="sr-only"
              />
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  connected ? dotClass : 'bg-faint',
                )}
                aria-hidden
              />
              {label}
              {/*
                ⚠ In words, not only in the greyed-out styling. A disabled
                control that does not say why it is disabled is the same defect
                as a colour-only channel dot, and this console has a rule about
                that.
              */}
              {!connected && (
                <span className={cn(LABEL, 'ml-0.5')}>not connected</span>
              )}
            </label>
          );
        })}
      </fieldset>

      {/* Present for the pre-hydration case and for keyboard users; the chips
          submit on change once JavaScript is running. */}
      <button type="submit" className="sr-only focus:not-sr-only">
        Apply filter
      </button>

      {/*
        A Link, not `<button type="reset">`. Reset restores the form's
        *defaults*, which are the values already in the URL — so on a page that
        has a filter applied it visibly does nothing. Navigating to the bare
        route is what "show everything" actually means.
      */}
      {active && (
        <Link
          href="/"
          className={cn(buttonClass({ variant: 'ghost', size: 'sm' }), '-my-1')}
        >
          <X className="size-3" aria-hidden />
          Show both
        </Link>
      )}
    </form>
  );
}

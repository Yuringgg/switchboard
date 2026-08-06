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
  view,
}: {
  /** Channel types currently in the URL. Empty means every line. */
  selected: string[];
  /** Which of them the reader actually has. */
  connectedTypes: string[];
  /** Which layout the record is in. See `TimelineSplit`. */
  view: 'merged' | 'split';
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
      className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2.5"
    >
      {/*
        ── The layout switch (Yuri, 2026-08-06) ────────────────────────────────

        ⚠ Radio inputs, not two links. Three reasons, and the third is the one
        that decided it: a radio group is one tab stop with arrow-key movement
        rather than two, it announces "2 of 2" so a screen-reader user knows it
        is a choice rather than two unrelated buttons — and it rides inside this
        form, so switching the layout PRESERVES the channel filter. Two links
        would each have to reconstruct the whole query string, and the first
        time somebody adds a third filter one of them will be forgotten.
      */}
      <fieldset className="flex items-center gap-1.5">
        <legend className={cn(LABEL, 'float-left mr-2.5')}>View</legend>

        <div className="flex items-center gap-0.5 rounded-md border border-border bg-panel p-0.5">
          {VIEWS.map(({ value, label, hint }) => {
            const checked = view === value;

            return (
              <label
                key={value}
                title={hint}
                className={cn(
                  'cursor-pointer rounded-[5px] px-2.5 py-1 text-note transition-colors',
                  'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/45',
                  checked
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <input
                  type="radio"
                  name="view"
                  value={value}
                  defaultChecked={checked}
                  onChange={submit}
                  className="sr-only"
                />
                {label}
              </label>
            );
          })}
        </div>
      </fieldset>

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
        /*
         * ⚠ The layout is preserved in this link and the channel filter is
         * not — which is the whole point. "Show both lines" clears the filter;
         * it is not a general reset, and dropping `view` here would silently
         * throw away a layout choice the reader made separately.
         */
        <Link
          href={view === 'merged' ? '/?view=merged' : '/'}
          className={cn(buttonClass({ variant: 'ghost', size: 'sm' }), '-my-1')}
        >
          <X className="size-3" aria-hidden />
          Show both
        </Link>
      )}
    </form>
  );
}

const VIEWS = [
  {
    value: 'split',
    label: 'Split',
    hint: 'One column per line — Gmail on the left, WhatsApp on the right.',
  },
  {
    value: 'merged',
    label: 'Merged',
    hint: 'Every line in one record, in the order things happened.',
  },
] as const;

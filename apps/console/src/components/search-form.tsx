'use client';

import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';

import { CHANNEL_META, type ChannelRow } from '@/lib/channels';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The search control: one text field and the filters that narrow it.
 *
 * ── Why it is a real `<form method="get">` ───────────────────────────────────
 *
 * Everything here could be `useState` plus `router.push`, and it would be
 * worse in three specific ways. A GET form puts the query in the URL, so a
 * search is a **link** — shareable, bookmarkable, and survivable across a
 * reload, which matters on a console whose job is finding one message again.
 * It renders on the server, so results arrive with the document rather than
 * after a client round trip. And it works with JavaScript disabled or still
 * loading, which the `soon` items in this app already taught us is not
 * hypothetical on a slow connection.
 *
 * The client enhancement is one line of behaviour on top of that, not a
 * replacement for it: changing a filter submits immediately, because a
 * checkbox that requires a second click on "Search" to take effect reads as
 * broken. The text field deliberately does NOT auto-submit on every keystroke
 * — that is a navigation per character to Singapore.
 */
export function SearchForm({
  query,
  channels,
  selectedChannels,
  from,
  to,
}: {
  query: string;
  channels: ChannelRow[];
  selectedChannels: string[];
  from: string;
  to: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * `requestSubmit` rather than `submit`: it runs validation and fires the
   * submit event, where `.submit()` bypasses both. Guarded because a filter
   * can change before hydration attaches the ref.
   */
  const submit = () => formRef.current?.requestSubmit();

  const active = Boolean(query || selectedChannels.length || from || to);

  return (
    <form ref={formRef} action="/search" method="get" className="mb-6">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search every channel…"
            // Off: the browser's own history dropdown covers the field with a
            // list of past searches at exactly the moment the results below
            // are what you want to look at.
            autoComplete="off"
            // `autoFocus` on purpose, and only here — this page exists for one
            // action and the field is it. It is not stealing focus from
            // anything, because arriving on /search *is* the intent to type.
            autoFocus
            aria-label="Search messages"
            className={cn(
              'focus-ring h-9 w-full rounded-md border border-border bg-panel pr-3 pl-9',
              'text-row placeholder:text-muted-foreground',
            )}
          />
        </div>

        {/* Visible, and not only for the no-JavaScript case: a search field
            with no button gives no affordance that Enter is what commits it. */}
        <button type="submit" className={buttonClass({ size: 'md' })}>
          Search
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        {/*
          Channels read from the database, not from CHANNELS — filtering by a
          channel you have not connected is an option that can only ever return
          nothing, and offering it makes the filter look broken when it works.
        */}
        {channels.length > 1 && (
          <fieldset className="flex flex-wrap items-center gap-1.5">
            <legend className={cn(LABEL, 'mr-2 float-left')}>Channel</legend>

            {channels.map((channel) => {
              const meta = CHANNEL_META[channel.type as keyof typeof CHANNEL_META];
              const checked = selectedChannels.includes(channel.id);

              return (
                <label
                  key={channel.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-note transition-colors',
                    // `has-[:focus-visible]` puts the ring on the visible chip
                    // rather than the checkbox, which is `sr-only` and would
                    // draw its focus ring in a corner of the screen.
                    'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/45',
                    checked
                      ? 'border-input bg-accent font-medium text-foreground'
                      : 'border-border bg-panel text-muted-foreground hover:border-input hover:text-foreground',
                  )}
                >
                  <input
                    type="checkbox"
                    name="channel"
                    value={channel.id}
                    defaultChecked={checked}
                    onChange={submit}
                    className="sr-only"
                  />
                  <span
                    className={cn('size-1.5 rounded-full', meta?.dotClass ?? 'bg-faint')}
                    aria-hidden
                  />
                  {meta?.label ?? channel.type}
                </label>
              );
            })}
          </fieldset>
        )}

        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className={cn(LABEL, 'mr-2 float-left')}>Between</legend>

          <DateField name="from" label="Earliest date" value={from} onChange={submit} />
          <span className="text-note text-muted-foreground" aria-hidden>
            –
          </span>
          <DateField name="to" label="Latest date" value={to} onChange={submit} />
        </fieldset>

        {/*
          A Link, not a reset button. Reset restores the form's *defaults*,
          which are the values currently in the URL — so on a page that already
          has filters applied, a reset button visibly does nothing. Navigating
          to the bare route is what "clear" actually means.
        */}
        {active && (
          <Link
            href="/search"
            className={cn(
              buttonClass({ variant: 'ghost', size: 'sm' }),
              'ml-auto -mr-2',
            )}
          >
            <X className="size-3" aria-hidden />
            Clear
          </Link>
        )}
      </div>
    </form>
  );
}

/**
 * A date bound.
 *
 * `type="date"` rather than a custom picker: it is keyboard-accessible,
 * localised, and touch-friendly for free, and this console has no calendar
 * component to be consistent with. The label is visually hidden because the
 * fieldset's legend already says "Between" and two visible labels reading
 * "Earliest date" / "Latest date" would be more text than the control.
 */
function DateField({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  onChange: () => void;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <input
        type="date"
        name={name}
        defaultValue={value}
        onChange={onChange}
        className={cn(
          'focus-ring h-7 rounded-md border border-border bg-panel px-2',
          'font-mono text-meta text-muted-foreground',
          // The stock indicator is a dark glyph that vanishes in dark mode.
          'dark:[color-scheme:dark]',
        )}
      />
    </label>
  );
}

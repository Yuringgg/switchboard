'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * A month grid and a clock, for choosing when a meeting starts.
 *
 * ── ⚠ Four things had to change from the component this came from ────────────
 *
 * **1. It did date arithmetic with `new Date(year, month, day)` and handed back
 * a `Date`.** That is local-machine time, and this flow is not in local-machine
 * time: `lib/manila.ts` exists because a value that drifts by an offset puts a
 * confirmed meeting on somebody's real calendar hours from where they approved
 * it — *silently and consistently*, which reads as a bug in extraction rather
 * than in a suffix. Everything below works on the wall-clock parts of a
 * `YYYY-MM-DDTHH:mm` string and never constructs a zoned `Date` from them.
 * `Date.UTC` is used only for month length and weekday, where it cannot drift.
 *
 * **2. It carried its own theme toggle** that wrote `classList` on
 * `<html>` directly. That bypasses `lib/theme.ts`, which owns the decision and
 * persists it — so the picker would have changed the whole app's appearance and
 * then had it snap back on the next reload. Removed; the theme control lives
 * where it lives.
 *
 * **3. Every day cell was `#FF3B30`.** That is Apple's system red. In this
 * console red is `--destructive` and means *something has gone wrong* — it is
 * one of only two places outside a real error allowed to use it. A month of red
 * numerals would read as a screen full of failures. Selection is the ink
 * colour, like every other selected thing here.
 *
 * **4. It was 12-hour with an AM/PM segmented control.** The rest of this
 * console reads clocks in 24-hour (`en-GB`, Asia/Manila) because it is a piece
 * of equipment, and a picker that disagreed with the timestamp on the row above
 * it would be the only ambiguous time in the product. It also deletes a whole
 * class of bug: there is no state that can be "11:00" and mean either morning
 * or night.
 *
 * ── The contract ─────────────────────────────────────────────────────────────
 *
 * Controlled. `value` is `YYYY-MM-DDTHH:mm` — exactly what a `datetime-local`
 * submits and exactly what `manilaInputToRfc3339` parses — and the hidden input
 * is what the server action reads. ⚠ Nothing here creates anything: ADR-010's
 * rule is that a calendar event exists only after a form submission, and this
 * component edits a form value and stops.
 */

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface Parts {
  year: number;
  month: number; // 0-indexed
  day: number;
  hour: number;
  minute: number;
}

/** `YYYY-MM-DDTHH:mm` → parts. Null for anything that is not that shape. */
function parse(value: string): Parts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]) - 1,
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

function format(p: Parts): string {
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * ⚠ `Date.UTC`, never `new Date(y, m, d)`.
 *
 * The local-time constructor is what makes a calendar show the wrong month for
 * anybody east or west of the machine that rendered it. Day 0 of the next month
 * is the last day of this one, and in UTC that arithmetic is exact.
 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Which column the 1st falls in, Monday-first. */
function firstWeekdayIndex(year: number, month: number): number {
  const sundayFirst = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

/** Today, in Manila — the console's zone, not the reader's. */
function manilaToday(): { year: number; month: number; day: number } {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .split('-')
    .map(Number);

  return { year: y!, month: m! - 1, day: d! };
}

export function DateTimePicker({
  name,
  label,
  value,
  onChange,
  hint,
}: {
  /** Form field name. The hidden input under it is what the action reads. */
  name: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const parts = parse(value);

  // The month being browsed, which is not the same as the month selected —
  // paging to March must not move the appointment to March.
  const [view, setView] = useState(() => ({
    year: parts?.year ?? manilaToday().year,
    month: parts?.month ?? manilaToday().month,
  }));

  /*
   * ⚠ Escape closes, and focus goes back to the trigger.
   *
   * The component this came from had neither: it closed only by clicking the
   * backdrop, and focus was left wherever it happened to be — so a keyboard
   * user could open a modal they could not close and then land on <body>. This
   * is the minimum that makes an overlay operable, and it is why the overlay is
   * `role="dialog"` with a label rather than a bare div.
   */
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    // Move focus in, so the first Tab lands inside the picker rather than
    // continuing through the form behind it.
    dialogRef.current?.focus();

    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const set = (patch: Partial<Parts>) => {
    const base = parts ?? { ...manilaToday(), hour: 9, minute: 0 };
    const next = { ...base, ...patch };
    // Clamp rather than roll over: paging from 31 January to February must not
    // silently become 3 March.
    next.day = Math.min(next.day, daysInMonth(next.year, next.month));
    onChange(format(next));
  };

  const today = manilaToday();
  const total = daysInMonth(view.year, view.month);
  const offset = firstWeekdayIndex(view.year, view.month);

  const step = (delta: number) => {
    const month = view.month + delta;
    if (month < 0) setView({ year: view.year - 1, month: 11 });
    else if (month > 11) setView({ year: view.year + 1, month: 0 });
    else setView({ year: view.year, month });
  };

  return (
    <div className="grid gap-1">
      <span className={LABEL}>
        {label}
        {hint && <span className="normal-case"> {hint}</span>}
      </span>

      {/*
        ⚠ The hidden input is the ONLY thing the server action sees. The trigger
        below is a button, not an input — a `<button>` with a name would submit
        its own value and a second field would arrive on the action.
      */}
      <input type="hidden" name={name} value={value} />

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'focus-ring flex h-9 items-center gap-2 rounded-md border border-border',
          'bg-background px-2.5 text-left text-row transition-colors hover:border-input',
        )}
      >
        <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className={cn('truncate', !parts && 'text-muted-foreground')}>
          {parts ? readable(parts) : 'Pick a date and time'}
        </span>
      </button>

      {open && (
        /*
         * `fixed`, centred, and outside the flow — not `absolute`.
         *
         * ⚠ This form renders inside `AppShell`'s scroll container, which is
         * `overflow-y: auto`. An absolutely-positioned popover would be clipped
         * by it the moment the picker is taller than the space below the field,
         * which on a month grid is always. `fixed` escapes the container
         * outright and cannot be clipped by an ancestor's overflow.
         */
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Dismiss layer. A real button so it is not a click target that a
              screen reader cannot see or reach. */}
          <button
            type="button"
            aria-label="Close the date picker"
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus();
            }}
            className="absolute inset-0 cursor-default bg-background/70"
          />

          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn(
              'animate-arrive relative w-[19.5rem] rounded-xl border border-border',
              'bg-panel p-4 outline-none',
            )}
          >
            <div className="flex items-center gap-2">
              <p id={titleId} className="text-row font-medium">
                {MONTHS[view.month]} {view.year}
              </p>

              <div className="ml-auto flex items-center gap-1">
                <Pager onClick={() => step(-1)} label="Previous month">
                  <ChevronLeft className="size-3.5" aria-hidden />
                </Pager>
                <Pager onClick={() => step(1)} label="Next month">
                  <ChevronRight className="size-3.5" aria-hidden />
                </Pager>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-y-1">
              {WEEKDAYS.map((day) => (
                <span key={day} className={cn(LABEL, 'text-center')}>
                  {day}
                </span>
              ))}

              {Array.from({ length: offset }, (_, i) => (
                <span key={`pad-${i}`} aria-hidden />
              ))}

              {Array.from({ length: total }, (_, i) => {
                const day = i + 1;
                const selected =
                  parts?.year === view.year &&
                  parts?.month === view.month &&
                  parts?.day === day;
                const isToday =
                  today.year === view.year &&
                  today.month === view.month &&
                  today.day === day;

                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => set({ year: view.year, month: view.month, day })}
                    aria-pressed={selected}
                    className={cn(
                      'focus-ring mx-auto flex size-8 items-center justify-center rounded-full',
                      'font-mono text-note transition-colors',
                      selected
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : 'text-foreground hover:bg-accent',
                      // ⚠ Today is marked with a ring, not a colour: the one
                      // hue this console reserves is amber for "receiving", and
                      // a date is not that.
                      !selected && isToday && 'ring-1 ring-border ring-inset',
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center gap-3 border-t border-border pt-3.5">
              <span className={cn(LABEL, 'text-foreground')}>Time</span>

              <div className="ml-auto flex items-center gap-1.5">
                <Spin
                  label="Hour"
                  value={parts?.hour ?? 9}
                  max={23}
                  onChange={(hour) => set({ hour })}
                />
                <span className="font-mono text-muted-foreground" aria-hidden>
                  :
                </span>
                <Spin
                  label="Minute"
                  value={parts?.minute ?? 0}
                  max={59}
                  step={5}
                  onChange={(minute) => set({ minute })}
                />
                {/* Stated, because a bare 24-hour clock with no zone on it is
                    the assumption that puts an event eight hours out. */}
                <span className={cn(LABEL, 'ml-1')}>PHT</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="focus-ring mt-4 h-8 w-full rounded-md bg-primary text-note font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Pager({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="focus-ring flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

/**
 * An hour or a minute.
 *
 * ⚠ `type="number"` with a real `min`/`max`, not the source's free-text field
 * with a regex stripping non-digits on every keystroke. That version fights the
 * user — it silently deletes what they typed — and it gives no keyboard
 * stepping, no mobile numeric keypad and no validation. `inputMode` is set
 * anyway because `type="number"` alone does not reliably summon the numeric pad
 * on Android.
 */
function Spin({
  label,
  value,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        step={step}
        inputMode="numeric"
        value={pad(value)}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isNaN(next)) return;
          // Clamped rather than rejected: typing "9" on the way to "19" must
          // not be refused, and a paste of "99" must not become an hour.
          onChange(Math.max(0, Math.min(max, next)));
        }}
        className={cn(
          'focus-ring h-8 w-12 rounded-md border border-border bg-background',
          'text-center font-mono text-note tabular-nums',
          // The stock spinner arrows are a dark glyph that vanishes in dark
          // mode and steal 14px of a 48px field.
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none',
        )}
      />
    </label>
  );
}

/** "Fri 7 Aug 2026, 15:00" — the same voice as every other timestamp here. */
function readable(p: Parts): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(
    // ⚠ Formatted in UTC from UTC parts, which is the only way to print wall
    // clock digits back unchanged. Passing these through the local zone is the
    // drift this whole component is written to avoid.
    new Date(Date.UTC(p.year, p.month, p.day, p.hour, p.minute)),
  );
}

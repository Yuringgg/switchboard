'use client';

import { CalendarCheck, CalendarPlus } from 'lucide-react';
import { useActionState, useState } from 'react';

import { DateTimePicker } from '@/components/ui/date-time-picker';
import type { AttentionItem } from '@/lib/attention';
import { toManilaInput } from '@/lib/manila';
import type { ConfirmResult } from '@/lib/proposals';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * A meeting proposal, beside its source message (US-7b, ADR-010).
 *
 * ── ⚠ Everything about this component is the confirmation gate ───────────────
 *
 * > *"An LLM misreading 'maybe we should meet sometime next week' as a Thursday
 * > 3pm commitment, and silently putting it on someone's real calendar, is the
 * > kind of failure that gets a tool uninstalled after one incident. Propose,
 * > don't assert."* — ADR-010
 *
 * So three things are non-negotiable here, and each is visible on screen:
 *
 *   1. **The source message is shown beside it.** That is the route this lives
 *      on — `/messages/[id]` renders the whole body directly below (ADR-018,
 *      which built the route partly for this).
 *   2. **The quote is shown**, so the reader can see the sentence the model
 *      read without scanning the body for it.
 *   3. **Title, time and location are editable before confirming.** A proposal
 *      you can only accept or reject is not a proposal; the model gets the
 *      gist right and the details wrong, and the details are what land on a
 *      calendar.
 */
export function MeetingProposal({
  item,
  action,
}: {
  item: AttentionItem;
  action: (previous: ConfirmResult | null, formData: FormData) => Promise<ConfirmResult>;
}) {
  const [result, submit, pending] = useActionState(action, null);

  /*
   * Already on the calendar: no form, no button, no way to do it twice.
   *
   * The guard that actually prevents a duplicate is `calendar_event_id`, server
   * side, checked before every insert. This is the same fact expressed in the
   * UI — because a button that looks live and then says "already done" teaches
   * people to click it twice.
   */
  if (item.confirmedAt || item.calendarEventId) {
    return (
      <section className="mt-6 rounded-md border border-border bg-panel p-4">
        <p className={cn(LABEL, 'flex items-center gap-1.5')}>
          <CalendarCheck className="size-3.5" aria-hidden />
          On your calendar
        </p>
        <p className="mt-1.5 text-row font-medium">{item.title}</p>
        {item.startsAt && (
          <p className={cn(LABEL, 'mt-1')}>{formatLocal(item.startsAt)}</p>
        )}
      </section>
    );
  }

  return <ProposalForm item={item} submit={submit} pending={pending} result={result} />;
}

/**
 * Split out so the picker state has somewhere to live below the early return
 * above — hooks cannot sit after a conditional `return`.
 */
function ProposalForm({
  item,
  submit,
  pending,
  result,
}: {
  item: AttentionItem;
  submit: (formData: FormData) => void;
  pending: boolean;
  result: ConfirmResult | null;
}) {
  /*
   * ⚠ Held as state now, not as `defaultValue` on two `datetime-local` inputs.
   *
   * The reason is the one below: moving the start has to move the end with it.
   * With uncontrolled inputs a reader who corrects a 3pm meeting to 4pm gets an
   * event that ends before it begins, and Google rejects that with a 400 whose
   * message names neither field.
   */
  const [start, setStart] = useState(
    item.startsAt ? toManilaInput(item.startsAt) : '',
  );
  // An hour, when the message named no end. Stated in the label rather than
  // slipped in, because a duration nobody chose is still a claim.
  const [end, setEnd] = useState(
    item.startsAt ? toManilaInput(item.startsAt, 60) : '',
  );

  /**
   * Moving the start drags the end along, preserving the gap the reader chose.
   *
   * ⚠ Computed on the wall-clock string via `Date.UTC`, never by constructing a
   * zoned `Date` from the parts — the same rule the picker itself follows and
   * for the same reason `lib/manila.ts` exists. Treating these strings as UTC
   * for arithmetic and printing them back unchanged is what keeps the value the
   * reader approved identical to the one the action receives.
   */
  const moveStart = (next: string) => {
    const before = toUtcMs(start);
    const after = toUtcMs(next);
    setStart(next);

    if (before === null || after === null) return;

    const endMs = toUtcMs(end);
    // No usable end yet: default to an hour after the new start.
    const gap = endMs === null ? 3_600_000 : Math.max(endMs - before, 60_000);
    setEnd(fromUtcMs(after + gap));
  };

  return (
    <section className="mt-6 rounded-md border border-border bg-panel p-4">
      <p className={cn(LABEL, 'flex items-center gap-1.5')}>
        <CalendarPlus className="size-3.5" aria-hidden />
        Meeting found in this message
      </p>

      {/*
        The evidence, before the form. A reader deciding whether to accept this
        needs the sentence the model read, not a summary of it.
      */}
      <blockquote className="mt-2 border-l-2 border-border pl-3 text-note text-muted-foreground">
        {item.quote}
      </blockquote>

      <form action={submit} className="mt-4 grid gap-3">
        <input type="hidden" name="extractionId" value={item.id} />

        <label className="grid gap-1">
          <span className={LABEL}>Title</span>
          <input
            name="title"
            defaultValue={item.title}
            required
            maxLength={200}
            className="focus-ring h-9 rounded-md border border-border bg-background px-2.5 text-row"
          />
        </label>

        {/*
          ⚠ A real picker rather than two `datetime-local` inputs.

          The native control is keyboard-accessible and localised for free,
          which is why it was the right first version — but it renders as a
          different widget in every browser, its month grid cannot be styled at
          all, and on this screen it is the control that decides what lands on
          somebody's real calendar. `components/ui/date-time-picker.tsx` is one
          widget everywhere, in this console's own voice, and it submits the
          identical `YYYY-MM-DDTHH:mm` string through a hidden input — so
          `manilaInputToRfc3339` on the server is untouched.
        */}
        <div className="grid gap-3 sm:grid-cols-2">
          <DateTimePicker
            name="startsAtLocal"
            label="Starts"
            value={start}
            onChange={moveStart}
          />
          <DateTimePicker
            name="endsAtLocal"
            label="Ends"
            hint={item.startsAt ? undefined : '(no time given)'}
            value={end}
            onChange={setEnd}
          />
        </div>

        <label className="grid gap-1">
          <span className={LABEL}>Location</span>
          <input
            name="location"
            defaultValue={item.location ?? ''}
            maxLength={200}
            className="focus-ring h-9 rounded-md border border-border bg-background px-2.5 text-row"
          />
        </label>

        {item.participants.length > 0 && (
          /*
            ⚠ Named, and deliberately NOT invited. Adding a Google attendee
            emails an invitation from the user to that address — an assertion
            far louder than a calendar entry, made off the back of a model
            reading somebody's mail. They go in the event description instead.
          */
          <p className={cn(LABEL, 'normal-case')}>
            Mentioned: {item.participants.join(', ')} — noted in the event, not invited.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClass({ size: 'sm' })} disabled={pending}>
            {pending ? 'Adding…' : 'Add to Google Calendar'}
          </button>
          <span className={cn(LABEL, 'normal-case')}>
            Times are Asia/Manila. Nothing is created until you click.
          </span>
        </div>

        {result && (
          /*
            `role="status"` rather than `alert` on success and `alert` on
            failure: a screen reader should be interrupted by "that did not
            work", and should not be by "done". The same distinction `Callout`
            makes a prop for.
          */
          <p
            role={result.ok ? 'status' : 'alert'}
            className={cn('text-note', result.ok ? 'text-foreground' : 'text-destructive')}
          >
            {result.message}
            {result.ok && result.htmlLink && (
              <>
                {' '}
                <a
                  href={result.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  Open it in Google Calendar
                </a>
              </>
            )}
          </p>
        )}
      </form>
    </section>
  );
}

/**
 * `YYYY-MM-DDTHH:mm` → milliseconds, treating the wall clock as UTC.
 *
 * ⚠ That is deliberate and it is not a bug. These strings are Manila wall
 * clock; treating them as UTC for *arithmetic* and printing them back the same
 * way is exact, because the offset cancels. Parsing them with `new Date(str)`
 * would apply the reader's own zone, and a user in another timezone would see
 * the end field jump by that offset the first time they touched the start.
 */
function toUtcMs(local: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  );
}

/** The inverse. `toISOString` is UTC, which is what `toUtcMs` encoded. */
function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

function formatLocal(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

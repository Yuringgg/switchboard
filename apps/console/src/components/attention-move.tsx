'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useActionState } from 'react';

import { moveAttentionItemAction } from '@/lib/attention-actions';
import { NO_MOVE_YET, type AttentionStatus } from '@/lib/attention';
import { cn } from '@/lib/utils';

/**
 * The two arrows that move a card between columns.
 *
 * ── ⚠ Why arrows and not drag-and-drop ───────────────────────────────────────
 *
 * Ms. Maria asked for a Kanban board and pointed at Trello. The columns are the
 * idea; the drag handle is not. HTML5 drag-and-drop needs a parallel keyboard
 * control built anyway to be usable at all, it depends on pointer events this
 * project's environment cannot test (the browser pane delivers no
 * `requestAnimationFrame` callbacks, so nothing driven by pointer motion runs),
 * and a pointer-driven reorder is the one interaction that fails silently on a
 * touch screen. Two buttons work everywhere, for everyone, and they name their
 * destination out loud.
 *
 * ── ⚠ Why this is a client component at all ──────────────────────────────────
 *
 * A plain `<form action={…}>` would work and would need no JavaScript — but a
 * server action used that way discards its return value, so a card that fails
 * to move simply does not move. "Nothing happened because it worked" and
 * "nothing happened because it failed" would be pixel-identical, which is the
 * collapse this console's design notes forbid twice by name. `useActionState`
 * is what puts the reason on the screen.
 *
 * The form still submits without hydration; only the error message and the
 * pending state need the client.
 */
export function MoveCard({
  id,
  title,
  back,
  forward,
  backLabel,
  forwardLabel,
}: {
  id: string;
  /** Named in the buttons' accessible labels — see below. */
  title: string;
  back: AttentionStatus | null;
  forward: AttentionStatus | null;
  backLabel: string | null;
  forwardLabel: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    moveAttentionItemAction,
    NO_MOVE_YET,
  );

  return (
    <>
      <form action={formAction} className="ml-auto flex items-center gap-1.5">
        <input type="hidden" name="id" value={id} />

        {/*
          The destination rides on the button's own `value`, so one form offers
          both directions with no client state deciding which. `name="to"` is
          only submitted for the button that was actually pressed — that is
          plain HTML, and it is why this works before hydration.
        */}
        <Arrow
          direction="back"
          to={back}
          toLabel={backLabel}
          title={title}
          pending={pending}
        />
        <Arrow
          direction="forward"
          to={forward}
          toLabel={forwardLabel}
          title={title}
          pending={pending}
        />
      </form>

      {/*
        ⚠ `role="alert"`, and it is the whole reason this component is not a
        bare form. Rendered only on failure: a success is visible — the card is
        in a different column.
      */}
      {state.error && (
        <p role="alert" className="mt-2 basis-full text-note text-destructive">
          {state.error}
        </p>
      )}
    </>
  );
}

/**
 * One arrow.
 *
 * ⚠ `disabled` at the ends of the board rather than hidden. A control that
 * disappears at the edge makes the row of buttons change width between cards,
 * so the two arrows land in a different place on every card and neither can be
 * clicked without looking. Present-and-unavailable is steadier and it also says
 * *why* — the `title` names the end of the board.
 */
function Arrow({
  direction,
  to,
  toLabel,
  title,
  pending,
}: {
  direction: 'back' | 'forward';
  to: AttentionStatus | null;
  toLabel: string | null;
  title: string;
  pending: boolean;
}) {
  const Icon = direction === 'back' ? ChevronLeft : ChevronRight;
  const unavailable = to === null;

  return (
    <button
      type="submit"
      name="to"
      value={to ?? ''}
      disabled={unavailable || pending}
      /*
       * ⚠ The accessible name says the card AND the destination.
       *
       * A screen-reader user tabbing a board of twelve cards otherwise hears
       * "button, chevron right" twenty-four times with no way to tell which
       * card they are on. `title` also gives every sighted user the same
       * sentence on hover, which is worth more than an icon-only control that
       * assumes the columns are memorised.
       */
      aria-label={
        unavailable
          ? `${title} is already in the ${direction === 'back' ? 'first' : 'last'} column`
          : `Move “${title}” to ${toLabel}`
      }
      title={
        unavailable
          ? direction === 'back'
            ? 'Already in the first column'
            : 'Already in the last column'
          : `Move to ${toLabel}`
      }
      className={cn(
        /*
         * ⚠ 28px, not 24. WCAG 2.5.8 puts the floor at 24×24 and a pair of 24px
         * buttons 4px apart passes it on the spacing exception — measured, and
         * it does. But this board is at its most useful on a phone, where these
         * two are the only controls on the card and they sit next to each
         * other; passing the minimum by nothing is not the same as being
         * comfortable to hit. 28px with a 6px gap costs nothing on the card.
         */
        'focus-ring flex size-7 shrink-0 items-center justify-center rounded-md',
        'transition-colors duration-150',
        unavailable
          ? // ⚠ `--faint` is the non-text token and this is an icon, not text,
            // so it is a legitimate use of it. Nothing legible may be set in it.
            'cursor-not-allowed text-faint'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        pending && !unavailable && 'opacity-60',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

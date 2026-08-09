'use client';

import { Archive, ArchiveRestore, Loader2 } from 'lucide-react';
import { useActionState } from 'react';

import {
  archiveAllDoneAction,
  setArchivedAction,
} from '@/lib/attention-actions';
import { NO_MOVE_YET } from '@/lib/attention';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * Taking one card off the board, or putting it back.
 *
 * ── ⚠ Archive, not delete, and the difference is not politeness ──────────────
 *
 * Yuri proposed a delete button because the board accumulates. Ms. Maria asked
 * for archive, and she is right for a reason specific to this schema: migration
 * 0011 records per message that the extraction pass has run, so the worker
 * skips it forever. **A deleted card is never re-extracted.** Delete here is
 * not "it will come back next sync" — it is permanent, silent data loss on a
 * row that quotes somebody's real correspondence.
 *
 * ── Why it is available in every column, not only Done ───────────────────────
 *
 * Done is the obvious case — finished work that has nowhere left to go. But the
 * more valuable one is **Not started**: the live board currently carries two
 * cards extracted out of marketing email ("Get Builder at half price", with a
 * tracking URL in the quote). That is not work anybody will ever do, and
 * without a way off the board it sits there forever making the real items
 * harder to find. Being able to clear noise before touching it is most of what
 * stops the board reading as a pile.
 *
 * ── Why there is no confirmation dialog ──────────────────────────────────────
 *
 * Because it is reversible and the way back is visible: the page header always
 * shows the archived count and links to them, and every archived card has
 * Restore. A confirm step on a reversible action trains people to click through
 * confirm steps. ⚠ If this ever becomes a real delete, that reasoning inverts.
 */
export function ArchiveButton({
  id,
  title,
  archived = false,
}: {
  id: string;
  title: string;
  /** Renders as Restore instead. */
  archived?: boolean;
}) {
  const [state, formAction, pending] = useActionState(setArchivedAction, NO_MOVE_YET);
  const Icon = archived ? ArchiveRestore : Archive;

  return (
    <>
      <form action={formAction} className="contents">
        <input type="hidden" name="id" value={id} />
        {/* ⚠ Only present for restore. Absent must mean archive — the
            direction that takes something off screen has to be the one that is
            asked for explicitly, never the fallback. */}
        {archived && <input type="hidden" name="restore" value="true" />}

        <button
          type="submit"
          disabled={pending}
          /*
           * ⚠ The accessible name carries the card, not the icon. A screen
           * reader user tabbing a board of twelve cards otherwise hears
           * "button, archive" twelve times with no way to tell them apart.
           */
          aria-label={
            archived ? `Restore “${title}” to the board` : `Archive “${title}”`
          }
          title={archived ? 'Put this back on the board' : 'Take this off the board'}
          className={cn(
            'focus-ring flex size-7 shrink-0 items-center justify-center rounded-md',
            'text-muted-foreground transition-colors duration-150',
            'hover:bg-accent hover:text-foreground',
            pending && 'opacity-60',
          )}
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Icon className="size-3.5" aria-hidden />
          )}
        </button>
      </form>

      {/* Rendered only on failure — a success is visible, because the card is
          no longer where it was. */}
      {state.error && (
        <p role="alert" className="mt-2 basis-full text-note text-destructive">
          {state.error}
        </p>
      )}
    </>
  );
}

/**
 * Clear the whole Done column.
 *
 * ⚠ This is the control that actually addresses the complaint. Done is the only
 * column nothing ever leaves, so it is where the pile forms — and archiving
 * finished work one card at a time is the interaction somebody stops doing
 * after a week.
 *
 * It reports the count back rather than just re-rendering: clearing an already
 * empty column and failing to clear a full one both look like "nothing
 * happened" otherwise.
 */
export function ClearDoneButton({ count }: { count: number }) {
  const [state, formAction, pending] = useActionState(
    archiveAllDoneAction,
    NO_MOVE_YET,
  );

  if (count === 0) return null;

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        aria-label={`Archive all ${count} done card${count === 1 ? '' : 's'}`}
        className={cn(
          LABEL,
          'focus-ring rounded px-1 py-0.5 underline underline-offset-2',
          'transition-colors hover:text-foreground',
          pending && 'opacity-60',
        )}
      >
        {pending ? 'Archiving…' : 'Archive all'}
      </button>

      {state.error && (
        <p role="alert" className="mt-1.5 text-note text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}

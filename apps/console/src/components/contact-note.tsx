'use client';

import { NotebookPen } from 'lucide-react';
import { useActionState, useState } from 'react';

import { NOTE_MAX } from '@/lib/tell-apart';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

export interface NoteResult {
  ok: boolean;
  message: string;
}

/**
 * "Who is this?" — the reader's own note on a contact.
 *
 * Ms. Maria's research task 4 asks for people with the same name to be told
 * apart by project context. Most of the time the messages do that on their own
 * (a company, a domain, a subject — `lib/tell-apart.ts`), but not always: two
 * people at one firm, writing about the same thing, look identical. A person
 * knows the difference, so they get to write it down, and **the note outranks
 * every inferred clue** — it is the one thing nobody guessed.
 *
 * Its first line is what Uriel says ("the Maria your note calls the Acme
 * designer") and what the contact list shows beside a shared name.
 *
 * ⚠ Stored in `contacts.notes`, which has existed since migration 0001 and
 * which merges already carry over (`lib/merge.ts`). No migration.
 */
export function ContactNote({
  note,
  action,
}: {
  note: string | null;
  action: (previous: NoteResult | null, formData: FormData) => Promise<NoteResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [result, submit, pending] = useActionState(
    async (previous: NoteResult | null, formData: FormData) => {
      const next = await action(previous, formData);
      if (next.ok) setEditing(false);
      return next;
    },
    null,
  );

  if (!editing) {
    return (
      <div className="mt-3">
        {note ? (
          <div className="flex items-start gap-2">
            <NotebookPen className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {/* Sans: a person wrote this. The console's two-voice rule. */}
            <p className="max-w-[60ch] text-row whitespace-pre-line">{note}</p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={cn(
                LABEL,
                'focus-ring mt-0.5 ml-1 shrink-0 rounded px-1 py-0.5 transition-colors hover:text-foreground',
              )}
            >
              Edit
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn(
              LABEL,
              'focus-ring -mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5',
              'transition-colors hover:text-foreground',
            )}
          >
            <NotebookPen className="size-3" aria-hidden />
            Add a note — who is this?
          </button>
        )}

        {result?.ok && (
          <p role="status" className={cn(LABEL, 'mt-1 normal-case')}>
            {result.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={submit} className="mt-3 grid max-w-[60ch] gap-2">
      <label className="grid gap-1">
        <span className={LABEL}>Who is this?</span>
        <textarea
          name="note"
          defaultValue={note ?? ''}
          maxLength={NOTE_MAX}
          rows={2}
          autoFocus
          placeholder="Designer at Acme — the Q3 website project"
          className="focus-ring resize-y rounded-md border border-border bg-background px-2.5 py-2 text-row"
        />
      </label>
      <p className={cn(LABEL, 'normal-case')}>
        The first line is how Uriel and this list tell apart people who share a name.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={buttonClass({ size: 'sm' })} disabled={pending}>
          {pending ? 'Saving…' : 'Save note'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className={buttonClass({ variant: 'ghost', size: 'sm' })}
        >
          Cancel
        </button>
      </div>

      {result && !result.ok && (
        <p role="alert" className="text-note text-destructive">
          {result.message}
        </p>
      )}
    </form>
  );
}

'use client';

import { Merge } from 'lucide-react';
import { useActionState, useState } from 'react';

import type { MergeResult } from '@/lib/merge';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * "This is the same person as…" (Phase 3, Q3).
 *
 * ⚠ **A merge is manual and it is a decision, so the UI has to read like one.**
 * Q3: *"Auto-merging wrong contacts corrupts data in a way that's tedious to
 * unwind."* Three things follow, and all three are visible:
 *
 *   1. **It starts closed.** A destructive-ish control that is always expanded
 *      invites an accidental click on a screen people visit to read messages.
 *   2. **Suggestions are offered, never preselected.** The heuristic ranks;
 *      the person chooses. Nothing is selected when the panel opens.
 *   3. **The consequence is stated in words before the button**, naming both
 *      contacts, because "Merge" alone does not say which direction.
 */
export function MergeContact({
  subject,
  candidates,
  suggestions,
  action,
}: {
  subject: { id: string; displayName: string };
  candidates: { id: string; displayName: string }[];
  suggestions: { id: string; displayName: string; reason: string }[];
  action: (previous: MergeResult | null, formData: FormData) => Promise<MergeResult>;
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [result, submit, pending] = useActionState(action, null);

  const target = candidates.find((c) => c.id === targetId);

  if (candidates.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          LABEL,
          'focus-ring mt-4 inline-flex items-center gap-1.5 rounded px-1 py-0.5',
          'text-muted-foreground transition-colors hover:text-foreground',
        )}
      >
        <Merge className="size-3" aria-hidden />
        Same person as another contact?
      </button>
    );
  }

  return (
    <section className="mt-4 rounded-md border border-border bg-panel p-4">
      <p className={cn(LABEL, 'flex items-center gap-1.5')}>
        <Merge className="size-3.5" aria-hidden />
        Merge this contact into another
      </p>

      {suggestions.length > 0 && (
        <div className="mt-3">
          <p className={cn(LABEL, 'normal-case')}>
            Possible matches — check before choosing, two different Marias exist:
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setTargetId(s.id)}
                  className={buttonClass({
                    variant: targetId === s.id ? 'primary' : 'subtle',
                    size: 'sm',
                  })}
                >
                  {s.displayName}
                  <span className={cn(LABEL, 'ml-1 normal-case opacity-70')}>{s.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={submit} className="mt-3 grid gap-3">
        <input type="hidden" name="sourceId" value={subject.id} />

        <label className="grid gap-1">
          <span className={LABEL}>Merge into</span>
          <select
            name="targetId"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            required
            className="focus-ring h-9 rounded-md border border-border bg-background px-2 text-row"
          >
            {/* Nothing preselected. A merge should never be one click from a
                page someone opened to read a message. */}
            <option value="">Choose a contact…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </label>

        {/*
          The consequence, in words, before the button — and naming the
          direction, because "Merge" alone does not say which row survives.
        */}
        {target && (
          <p className="text-note text-muted-foreground">
            Every handle belonging to <strong>{subject.displayName}</strong> moves to{' '}
            <strong>{target.displayName}</strong>, and this contact is removed. No message is
            deleted or moved. To undo it, merge them back the other way.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className={buttonClass({ size: 'sm' })}
            disabled={pending || !targetId}
          >
            {pending ? 'Merging…' : 'Merge'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={buttonClass({ variant: 'ghost', size: 'sm' })}
          >
            Cancel
          </button>
        </div>

        {result && (
          <p
            role={result.ok ? 'status' : 'alert'}
            className={cn('text-note', result.ok ? 'text-foreground' : 'text-destructive')}
          >
            {result.message}
          </p>
        )}
      </form>
    </section>
  );
}

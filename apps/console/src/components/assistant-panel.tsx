'use client';

import { ArrowUpRight, CornerDownLeft, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useActionState } from 'react';

import { AssistantGhost, type GhostState } from '@/components/assistant-ghost';
import { Callout } from '@/components/callout';
import type { AssistantAnswer } from '@/lib/assistant';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The assistant (US-6) — the feature Ms. Maria described first.
 *
 * ── The one rule this screen exists to hold ──────────────────────────────────
 *
 * **Every claim is cited, and an uncited answer is shown as a refusal.**
 * `docs/01-PRODUCT-SPEC.md` §7 makes it a success criterion: *"Assistant answers
 * with no citation — must refuse rather than guess."* A monitoring tool that
 * invents a meeting is worse than one that says it does not know, and it only
 * has to do it once.
 *
 * So the citations are not decoration under the answer. They are the evidence,
 * and the design puts them where they cannot be skipped.
 */
export function AssistantPanel({
  action,
  suggestions,
}: {
  action: (state: AssistantAnswer | null, formData: FormData) => Promise<AssistantAnswer>;
  suggestions: string[];
}) {
  const [state, formAction, pending] = useActionState(action, null);

  /**
   * Derived, never stored. `useActionState` already owns every fact this needs,
   * and a second copy in `useState` is how the figure ends up reading "thinking"
   * beside an answer that has already arrived.
   */
  const ghostState: GhostState = pending
    ? 'thinking'
    : !state
      ? 'idle'
      : state.error
        ? 'error'
        : state.refused
          ? 'refused'
          : 'answered';

  return (
    <div>
      <AssistantGhost state={ghostState} />

      <form action={formAction}>
        <label htmlFor="question" className="sr-only">
          Ask about your messages
        </label>

        <div className="relative">
          <textarea
            id="question"
            name="question"
            rows={2}
            required
            maxLength={500}
            defaultValue={state?.error ? undefined : ''}
            placeholder="Ask about your messages — “do I have upcoming meetings?”"
            // Enter submits, Shift+Enter adds a line. A textarea is right
            // because questions wrap; a bare input would hide the end of a
            // long one behind the cursor.
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            className={cn(
              'focus-ring w-full resize-none rounded-lg border border-border bg-panel',
              'px-3.5 py-3 pr-28 text-row placeholder:text-muted-foreground',
            )}
          />

          <button
            type="submit"
            disabled={pending}
            className={buttonClass({ size: 'sm', className: 'absolute right-2.5 bottom-2.5' })}
          >
            {pending ? 'Thinking…' : 'Ask'}
            {!pending && <CornerDownLeft className="size-3" aria-hidden />}
          </button>
        </div>
      </form>

      {/*
        Suggestions are real questions this corpus can answer, not invented
        marketing copy. An empty assistant with no prompt is the hardest kind of
        blank page — and a suggestion that returns nothing teaches the user the
        feature is broken.
      */}
      {!state && !pending && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <form action={formAction} key={suggestion}>
              <input type="hidden" name="question" value={suggestion} />
              <button
                type="submit"
                className={cn(
                  'focus-ring rounded-full border border-border bg-panel px-3 py-1',
                  'text-note text-muted-foreground transition-colors',
                  'hover:border-input hover:text-foreground',
                )}
              >
                {suggestion}
              </button>
            </form>
          ))}
        </div>
      )}

      {pending && <Thinking />}

      {state && !pending && (
        <div className="mt-6">
          {state.error ? (
            <Callout tone="error" role="alert">
              {state.error}
            </Callout>
          ) : (
            <Answer answer={state} />
          )}
        </div>
      )}
    </div>
  );
}

function Answer({ answer }: { answer: AssistantAnswer }) {
  return (
    <div>
      <p className={cn(LABEL, 'mb-2 flex items-center gap-1.5')}>
        <Sparkles className="size-3" aria-hidden />
        {answer.refused ? 'No answer found' : 'Answer'}
      </p>

      {/*
        `aria-live` so a screen-reader user learns the answer arrived. The
        question was submitted from a control that keeps focus, so nothing
        announces the change otherwise.
      */}
      <div aria-live="polite">
        <p
          className={cn(
            'max-w-[68ch] text-row whitespace-pre-wrap',
            answer.refused && 'text-muted-foreground italic',
          )}
        >
          {answer.answer}
        </p>

        {answer.citations.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <p className={LABEL}>
              {answer.citations.length} source
              {answer.citations.length === 1 ? '' : 's'}
            </p>

            {/*
              Numbered to match the [1] markers inside the answer, so a reader
              can follow a specific claim to a specific message rather than
              being handed an undifferentiated pile of "sources".

              ── ⚠ And each one is a real link (ADR-017) ────────────────────
              A citation whose whole job is "check this for yourself" and which
              cannot be opened is doing half the job. It links to
              `/messages/<id>` rather than scrolling the timeline, because the
              timeline holds only the newest 50 — a chip pointing at anything
              older would resolve to nothing, which reads exactly like the
              invented source ADR-007 exists to prevent.

              A whole-row `<Link>`, so the target is the size of the card rather
              than a word inside it, and `prefetch={false}`: these are private
              message bodies and the reader has not asked for them yet.
            */}
            <ol className="mt-2.5 space-y-1">
              {answer.citations.map((citation, index) => (
                <li key={citation.messageId}>
                  <Link
                    href={`/messages/${citation.messageId}`}
                    prefetch={false}
                    className={cn(
                      'focus-ring group -mx-2 flex gap-2.5 rounded-md px-2 py-1.5',
                      'transition-colors hover:bg-accent/70',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md',
                        'bg-accent font-mono text-label font-semibold text-foreground',
                      )}
                      aria-hidden
                    >
                      {index + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-row font-medium">
                        {citation.subject ?? citation.senderName ?? 'Message'}
                        <ArrowUpRight
                          className="size-3 shrink-0 text-faint transition-colors group-hover:text-muted-foreground"
                          aria-hidden
                        />
                      </p>
                      <p className="mt-0.5 font-mono text-meta text-muted-foreground">
                        {citation.senderName ?? 'unknown sender'} ·{' '}
                        {formatStamp(citation.sentAt)}
                      </p>
                      <p className="mt-1 line-clamp-2 text-note text-muted-foreground">
                        {citation.excerpt}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/*
          ⚠ Said out loud when there are no sources, rather than left as an
          absence. An answer with no citation has, by the contract the model was
          given, claimed nothing about the corpus — and the reader needs to know
          that is a deliberate outcome and not a rendering failure.
        */}
        {answer.refused && (
          <p className="mt-4 max-w-[60ch] text-note text-muted-foreground">
            The assistant only answers from messages it can point to. Nothing in
            your timeline matched closely enough to cite, so it declined rather
            than guessing.
          </p>
        )}
      </div>
    </div>
  );
}

/** Same shape as an answer, so nothing jumps when the real one replaces it. */
function Thinking() {
  return (
    <div className="mt-6" aria-hidden>
      <p className={cn(LABEL, 'mb-2 flex items-center gap-1.5')}>
        <Sparkles className="size-3 animate-pulse" />
        Reading your messages
      </p>
      <div className="animate-pulse space-y-2">
        <span className="block h-3.5 w-11/12 rounded bg-faint/60" />
        <span className="block h-3.5 w-4/5 rounded bg-faint/60" />
        <span className="block h-3.5 w-2/3 rounded bg-faint/40" />
      </div>
      <span className="sr-only">Searching your messages</span>
    </div>
  );
}

function formatStamp(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

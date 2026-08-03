'use client';

import { MeshGradientSVG } from '@/components/ui/shader-svg';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The assistant, given a face.
 *
 * ── Why it exists ────────────────────────────────────────────────────────────
 *
 * `/assistant` was a text box on an empty page, which is the hardest kind of
 * blank screen: nothing on it says *who* is being asked, or that anything is
 * there to ask. The figure is the answer to that — it looks at the pointer
 * while it is waiting, reads while it is working, and sits above the composer
 * so the thing you are addressing is on screen while you type.
 *
 * ── The one rule it must not break ───────────────────────────────────────────
 *
 * **It may never look like it is speaking when it has not cited anything.**
 * `docs/01-PRODUCT-SPEC.md` §7 makes "refuse rather than guess" a success
 * criterion, and ADR-016 is the record of how much work went into keeping the
 * refusal honest. A character that beams cheerfully through a refusal quietly
 * undoes that — so the status line below names the *reason* ("nothing to
 * cite"), which is the contract, rather than a mood.
 *
 * ── Why the status is text and not just the figure ───────────────────────────
 *
 * The figure is `aria-hidden`. Everything it expresses — waiting, reading,
 * answered — is also stated here in the machine voice, in the same mono
 * uppercase the console uses for every other thing the machine knows. A
 * reader who never sees the animation loses nothing, which is the only
 * arrangement that makes an animated illustration acceptable on a screen this
 * central.
 */

export type GhostState = 'idle' | 'thinking' | 'answered' | 'refused' | 'error';

/**
 * Deliberately not a restatement of what the answer block below already says.
 * "Answer", "N sources" and "No answer found" are that block's words; these are
 * the assistant's own state, and the two must not compete to describe the same
 * event. The refusal names why rather than repeating the outcome.
 */
const STATUS: Record<GhostState, string> = {
  idle: 'Ready',
  thinking: 'Reading your messages',
  answered: 'Answered from your messages',
  refused: 'Nothing to cite',
  error: 'Unavailable',
};

export function AssistantGhost({ state }: { state: GhostState }) {
  return (
    <div className="mb-5 flex items-center gap-4">
      <MeshGradientSVG className="max-w-[92px] shrink-0" busy={state === 'thinking'} />

      <p
        className={cn(
          LABEL,
          // The only state that is not simply informational. `--destructive` is
          // the console's one error colour and it is spent sparingly; a
          // refusal is a correct outcome, not a fault, so it does not get it.
          state === 'error' && 'text-destructive',
        )}
        /*
         * Announced, because the visible change during a long answer is an
         * animation a screen-reader user cannot perceive. `polite` so it waits
         * for a pause rather than interrupting — the answer itself is the
         * announcement that matters, and it has its own live region.
         */
        aria-live="polite"
      >
        {STATUS[state]}
      </p>
    </div>
  );
}

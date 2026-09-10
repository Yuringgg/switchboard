'use client';

import { useEffect, useRef } from 'react';

import { LABEL } from '@/lib/ui';
import type { TranscriptTurn } from '@/lib/voice/transcript';
import { cn } from '@/lib/utils';

/**
 * What was said, as it is said.
 *
 * ── Why a voice product needs one of these ──────────────────────────────────
 *
 * Speech is gone the moment it lands. On a call you cannot scroll back, and a
 * name misheard is invisible — Whisper hears "Maria Cruz" as "Mariah Cruz" and
 * the answer that follows is confidently about the wrong person.
 *
 * That is the same argument the "Heard" block makes on a typed answer, and it
 * is the reason this is not decoration: **it is how you check the machine.**
 * A voice interface with no transcript asks you to trust it, which is exactly
 * what `docs/01-PRODUCT-SPEC.md` §7 says this product must never do.
 *
 * ── ⚠ Nothing here is stored ────────────────────────────────────────────────
 *
 * These turns live in React state for the length of the page. No table, no
 * request, no upload. Audio was already handled that way — the plan's §7 makes
 * "nothing is persisted" a stated security property rather than an oversight,
 * and a transcript is the same content in a different shape. RA 10173 surface
 * stays flat.
 *
 * It survives the call ending on purpose. Reading back what was said is most
 * useful once you have stopped talking.
 */

export function VoiceTranscript({ turns }: { turns: TranscriptTurn[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /*
   * Follow the newest line — but only if the reader is already at the bottom.
   *
   * ⚠ Yanking the view down while somebody is reading back three turns is the
   * standard chat-log defect. 40px of slack, so "near the bottom" counts.
   */
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;

    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    if (atBottom) endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  if (turns.length === 0) return null;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className={LABEL}>Transcript</p>

      <div
        ref={scrollRef}
        // Capped and scrollable: a long call must not push the Hang up button
        // off the screen.
        className="mt-2 max-h-64 space-y-2.5 overflow-y-auto pr-1"
        /*
         * `polite`, not `assertive`. A screen reader announcing every partial
         * would talk over the assistant, which is the one thing a voice UI
         * cannot afford to do.
         */
        aria-live="polite"
        aria-label="Live transcript"
      >
        {turns.map((turn, index) => (
          <div
            key={index}
            className={cn('flex flex-col', turn.role === 'user' && 'items-end')}
          >
            <span className={cn(LABEL, 'mb-0.5')}>
              {turn.role === 'user' ? 'You' : 'Switchboard'}
            </span>
            <p
              className={cn(
                'max-w-[46ch] rounded-lg px-3 py-1.5 text-row',
                turn.role === 'user'
                  ? 'bg-accent text-foreground'
                  : 'border border-border bg-panel text-foreground',
                // Still being revised. Dimmed rather than hidden, so the words
                // appear as they are spoken instead of arriving in a block.
                !turn.final && 'text-muted-foreground italic',
              )}
            >
              {turn.text}
            </p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

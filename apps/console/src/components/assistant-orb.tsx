'use client';

import { Loader2, Mic, Square, Volume2 } from 'lucide-react';

import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The circular interface (voice V1, Ms. Maria's V3).
 *
 * ── The one rule it must not break ───────────────────────────────────────────
 *
 * **It may never look like it is speaking when it has not cited anything.**
 * `assistant-ghost.tsx` states this for the figure beside the composer, and it
 * matters MORE here, not less: a spoken answer leaves nothing on screen to
 * check, so a refusal has to be legible as a refusal. `refused` therefore goes
 * still — no pulse, no ring — and the status line names the reason rather than
 * a mood.
 *
 * ── Why CSS and not a motion library ─────────────────────────────────────────
 *
 * `correspondence/2026-08-09-design-revisions.md` §5: framer-motion, `useInView`
 * and `ResizeObserver` all deliver nothing in this project's browser pane and in
 * headless renderers, so three adopted components were rebuilt on CSS. Same
 * choice here. The live level ring is an inline `transform` rather than a
 * keyframe, because it follows real microphone data and no keyframe can.
 *
 * `prefers-reduced-motion` is handled globally in `globals.css` — every
 * animation below collapses to nothing under it, which is why none of them
 * carries meaning on its own. The status text does.
 */

export type OrbState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'answered'
  | 'refused'
  | 'error';

/**
 * What the machine is doing, said in words.
 *
 * ⚠ Not decoration. The orb is `aria-hidden` and everything it expresses is
 * stated here in the mono machine voice — the same arrangement
 * `assistant-ghost.tsx` argues for, and the only one that makes an animated
 * illustration acceptable on a screen this central. A reader who never sees the
 * animation loses nothing.
 */
const STATUS: Record<OrbState, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Reading your messages',
  speaking: 'Answering',
  answered: 'Answered from your messages',
  refused: 'Nothing to cite',
  error: 'Unavailable',
};

const HINT: Record<OrbState, string> = {
  idle: 'Tap to ask out loud, or type below.',
  listening: 'Say your question, then tap to stop.',
  thinking: 'Searching your messages for something it can cite.',
  speaking: 'Tap to stop reading.',
  answered: 'The full answer and its sources are below.',
  refused: 'Nothing in your messages matched closely enough to cite.',
  error: 'Something went wrong. The message below says what.',
};

export function AssistantOrb({
  state,
  /** Live microphone loudness, 0–1. Only meaningful while listening. */
  level = 0,
  onPress,
  disabled = false,
  supported = true,
}: {
  state: OrbState;
  level?: number;
  onPress: () => void;
  disabled?: boolean;
  supported?: boolean;
}) {
  const listening = state === 'listening';
  const speaking = state === 'speaking';
  const thinking = state === 'thinking';

  /*
   * The ring follows the microphone while listening.
   *
   * This is the single biggest lever on PERCEIVED responsiveness in the whole
   * feature, and it costs one `AnalyserNode` and no network. Most of what makes
   * a voice UI feel slow is the dead air while you are still talking — seeing
   * your own voice move something removes it. See the plan's §2.
   *
   * Capped at 1.42 so a shout does not push the ring outside its own box.
   */
  const ringScale = listening ? 1 + Math.min(level, 1) * 0.42 : 1;

  return (
    <div className="flex items-center gap-5">
      <div className="relative flex size-28 shrink-0 items-center justify-center">
        {/*
          The outer ring. Breathing when idle, following the voice when
          listening, still on a refusal — deliberately, see the note above.
        */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 rounded-full border',
            /*
             * ⚠ `animate-orb-breathe`, NOT `animate-ripple`. The latter
             * translates by -50%,-50% because it was written for rings
             * positioned by their centre; on this `inset-0` element it parks
             * the circle half its width up and to the left of the button.
             * Nothing errors — it just looks broken. See globals.css.
             */
            state === 'idle' && 'animate-orb-breathe border-border',
            listening && 'border-destructive/50',
            speaking && 'animate-orb-breathe border-primary/50',
            thinking && 'animate-orb-breathe border-border',
            (state === 'answered' || state === 'refused' || state === 'error') &&
              'border-border',
          )}
          style={
            listening
              ? {
                  transform: `scale(${ringScale})`,
                  // Fast enough to track speech, slow enough not to jitter.
                  transition: 'transform 90ms linear',
                }
              : undefined
          }
        />

        {/* A second, fainter ring, so the orb reads as depth rather than a
            single outline. Absent on the still states for the same reason. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-2 rounded-full border border-border/60',
            (listening || speaking) && 'opacity-100',
            !listening && !speaking && 'opacity-40',
          )}
          style={
            listening
              ? {
                  transform: `scale(${1 + Math.min(level, 1) * 0.22})`,
                  transition: 'transform 120ms linear',
                }
              : undefined
          }
        />

        <button
          type="button"
          onClick={onPress}
          disabled={disabled || !supported}
          aria-label={
            listening ? 'Stop recording' : speaking ? 'Stop reading' : 'Ask out loud'
          }
          /*
           * `aria-disabled` would be wrong here: when speech is unsupported the
           * control genuinely cannot be used, and a real `disabled` keeps it out
           * of the tab order rather than offering a dead stop to a keyboard
           * user. The reason is in the hint text below.
           */
          className={cn(
            'focus-ring relative flex size-18 items-center justify-center rounded-full',
            'transition-colors disabled:pointer-events-none disabled:opacity-50',
            listening && 'bg-destructive text-destructive-foreground',
            speaking && 'bg-primary text-primary-foreground hover:opacity-90',
            !listening && !speaking && 'bg-primary text-primary-foreground hover:opacity-90',
          )}
        >
          {thinking ? (
            <Loader2 className="size-6 animate-spin" aria-hidden />
          ) : listening ? (
            <Square className="size-5" aria-hidden />
          ) : speaking ? (
            <Volume2 className="size-6" aria-hidden />
          ) : (
            <Mic className="size-7" aria-hidden />
          )}
        </button>
      </div>

      <div className="min-w-0">
        {/*
          `aria-live` so a screen-reader user learns the state changed. The
          button keeps focus across the whole loop, so nothing else announces it.
        */}
        <p
          className={cn(LABEL, state === 'error' && 'text-destructive')}
          aria-live="polite"
        >
          {STATUS[state]}
        </p>
        <p className="mt-1.5 max-w-[42ch] text-note text-muted-foreground">
          {supported
            ? HINT[state]
            : 'This browser cannot read answers aloud. Typing still works.'}
        </p>
      </div>
    </div>
  );
}

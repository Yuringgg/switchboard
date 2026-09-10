'use client';

import { Mic, Square } from 'lucide-react';
import { useState } from 'react';

import { LABEL } from '@/lib/ui';
import {
  MAX_CLIP_SECONDS,
  useVoiceCapture,
  type CaptureResult,
} from '@/lib/use-voice-capture';
import { cn } from '@/lib/utils';

/**
 * Voice V0 — record, transcribe, print the numbers.
 *
 * ── What this exists to settle ──────────────────────────────────────────────
 *
 * Not a feature. A workbench, like `/preview`. The voice plan lists three
 * things that cost ten minutes to check now and half a day to discover late,
 * and this page checks all three:
 *
 *   1. **What the browser actually records.** Chrome gives
 *      `audio/webm;codecs=opus`, Safari gives `audio/mp4`. Both are on Groq's
 *      accepted list, but the filename has to agree with the bytes, so the real
 *      value is printed rather than assumed.
 *   2. **Whether Groq accepts that blob**, unconverted.
 *   3. **Whether the round trip fits the latency budget.** The plan allows
 *      300–500ms for transcription. The numbers are printed, not estimated.
 *
 * ⚠ It shares `useVoiceCapture` with the assistant's orb. This page keeps
 * existing after V1 precisely because it shows the raw measurements the product
 * screen has no business displaying — when voice feels slow, this is where you
 * find out which stage is at fault.
 */
export function VoiceLab() {
  const [reading, setReading] = useState<CaptureResult | null>(null);

  const { state, level, seconds, error, toggle, supported } = useVoiceCapture({
    onTranscript: setReading,
  });

  const recording = state === 'recording';

  return (
    <div className="max-w-[68ch]">
      <div className="flex items-center gap-5">
        <div className="relative flex size-24 shrink-0 items-center justify-center">
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 rounded-full border transition-colors',
              recording ? 'border-destructive/40' : 'border-border',
            )}
            style={
              recording
                ? {
                    transform: `scale(${1 + level * 0.35})`,
                    transition: 'transform 90ms linear',
                  }
                : undefined
            }
          />
          <button
            type="button"
            onClick={toggle}
            disabled={state === 'transcribing' || !supported}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
            className={cn(
              'focus-ring flex size-16 items-center justify-center rounded-full',
              'transition-colors disabled:pointer-events-none disabled:opacity-60',
              recording
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-primary text-primary-foreground hover:opacity-90',
            )}
          >
            {recording ? <Square className="size-5" /> : <Mic className="size-6" />}
          </button>
        </div>

        <div>
          <p className={LABEL} aria-live="polite">
            {state === 'transcribing'
              ? 'Transcribing'
              : recording
                ? `Recording · ${seconds.toFixed(1)}s`
                : 'Ready'}
          </p>
          <p className="mt-1.5 text-note text-muted-foreground">
            {!supported
              ? 'This browser cannot record audio. A secure origin is required — plain HTTP on anything but localhost lands here.'
              : recording
                ? `Say something, then press stop. Stops itself at ${MAX_CLIP_SECONDS}s.`
                : 'Press to record. The clip goes to Groq Whisper and comes back as text.'}
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-6 text-row text-destructive">
          {error}
        </p>
      )}

      {reading && (
        <div className="mt-8 border-t border-border pt-6">
          <p className={LABEL}>Transcript</p>
          <p className="mt-2 text-row whitespace-pre-wrap">{reading.text}</p>

          {/*
            The three facts this page exists to produce. Printed rather than
            summarised, because the point is to read the real values.
          */}
          <p className={cn(LABEL, 'mt-6')}>Measured</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-meta text-muted-foreground">
            <dt>recorded as</dt>
            <dd className="text-foreground">{reading.mimeType}</dd>

            <dt>clip length</dt>
            <dd>{(reading.clipMs / 1000).toFixed(1)}s</dd>

            <dt>upload size</dt>
            <dd>{(reading.bytes / 1024).toFixed(1)} KB</dd>

            <dt>groq time</dt>
            <dd className="text-foreground">{reading.serverMs} ms</dd>

            <dt>round trip</dt>
            <dd className="text-foreground">{reading.totalMs} ms</dd>

            <dt>model</dt>
            <dd>{reading.model}</dd>
          </dl>

          <p className="mt-4 text-note text-muted-foreground">
            {reading.totalMs <= 900
              ? 'Inside the plan’s budget for this stage.'
              : 'Slower than the plan assumed — worth re-checking §2 before trusting the latency target.'}
          </p>
        </div>
      )}
    </div>
  );
}

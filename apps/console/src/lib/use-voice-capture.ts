'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Record a clip and turn it into text (voice V0/V1).
 *
 * Shared by `/voice-lab` — the workbench that prints the raw numbers — and by
 * the assistant's orb. One implementation on purpose: the recorder is the part
 * with browser-specific traps in it, and a fix that lands in only one of two
 * copies is the kind of bug this project keeps writing notes about.
 *
 * The hook owns the microphone and knows nothing about the assistant. It hands
 * back a transcript; what happens to it is the caller's business.
 */

/**
 * The recorder stops itself after this long.
 *
 * ⚠ A security control, not a convenience. A recorder with no cap is a
 * microphone left open in a room. It also keeps the upload small, which keeps
 * the latency honest. Nobody asks a 30-second question.
 *
 * Kept in step with `MAX_CLIP_SECONDS` in `packages/ai/src/transcribe.ts`, and
 * deliberately not imported from there: that module is server-side, and pulling
 * it into a client bundle to read one number drags its dependencies with it.
 */
export const MAX_CLIP_SECONDS = 30;

/**
 * Container formats to try, best first.
 *
 * `isTypeSupported` is the only honest way to ask — the answer differs by
 * browser AND by platform, so a hardcoded string works until it silently does
 * not. The empty string at the end means "browser default", which is what makes
 * this work on a browser none of these match.
 *
 * ⚠ Every entry must be on Groq's accepted list: flac, mp3, mp4, mpeg, mpga,
 * m4a, ogg, wav, webm.
 */
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  '',
];

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of PREFERRED_TYPES) {
    if (type === '' || MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export type CaptureState = 'idle' | 'recording' | 'transcribing';

export interface CaptureResult {
  text: string;
  model: string;
  /** Groq's own time, measured on the server. */
  serverMs: number;
  /** Upload, transcription and response. Measured in the browser. */
  totalMs: number;
  bytes: number;
  mimeType: string;
  clipMs: number;
}

export function useVoiceCapture({
  onTranscript,
}: {
  onTranscript: (result: CaptureResult) => void;
}) {
  const [state, setState] = useState<CaptureState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  /*
   * `onTranscript` through a ref.
   *
   * The callback is usually an inline arrow, so it is a new function on every
   * render. Putting it in `start`'s dependency array would rebuild `start` on
   * every render, and the `stop` listener registered on the recorder would then
   * be holding a stale one.
   */
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  /**
   * Release the microphone.
   *
   * ⚠ Stopping the recorder is not enough. The browser keeps showing its
   * recording indicator until every track is stopped, and a tab that still
   * looks like it is listening after you pressed stop is exactly what makes a
   * voice feature feel untrustworthy.
   */
  const teardown = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;

    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    recorderRef.current = null;
    setLevel(0);
  }, []);

  // Also on unmount, so navigating away mid-recording does not leave the
  // microphone open.
  useEffect(() => teardown, [teardown]);

  const send = useCallback(async (blob: Blob, clipMs: number) => {
    setState('transcribing');

    const form = new FormData();
    form.append('audio', blob, 'speech');

    const startedAt = performance.now();

    try {
      const response = await fetch('/api/voice/transcribe', {
        method: 'POST',
        body: form,
      });

      const totalMs = Math.round(performance.now() - startedAt);
      const body = (await response.json().catch(() => null)) as {
        text?: string;
        model?: string;
        elapsedMs?: number;
        bytes?: number;
        mimeType?: string;
        error?: string;
      } | null;

      if (!response.ok) {
        setError(body?.error ?? `Transcription failed (HTTP ${response.status}).`);
        return;
      }

      onTranscriptRef.current({
        text: body?.text ?? '',
        model: body?.model ?? 'unknown',
        serverMs: body?.elapsedMs ?? 0,
        totalMs,
        bytes: body?.bytes ?? blob.size,
        mimeType: body?.mimeType || blob.type || 'unknown',
        clipMs,
      });
    } catch {
      setError('Could not reach the transcription service.');
    } finally {
      setState('idle');
    }
  }, []);

  const stop = useCallback(() => {
    // `stop()` fires the listener registered in `start`, which is where the
    // blob is assembled and sent.
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setSeconds(0);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        /*
         * Worth asking for by name. A laptop mic in a room picks up its own
         * speakers and the room's hum, and Whisper transcribes both. The
         * browser's own processing beats anything we would do to the blob
         * afterwards, and it is free.
         *
         * ⚠ `echoCancellation` matters more here than in the workbench: the orb
         * speaks its answer out loud through the same laptop, so without it a
         * follow-up question records the assistant's own voice.
         */
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (cause) {
      /*
       * Two different problems arrive as one rejection and the fix differs, so
       * they are named separately. "Permission denied" sends someone to their
       * browser settings; "no microphone" does not.
       */
      const name = cause instanceof Error ? cause.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it for this site and try again.'
          : name === 'NotFoundError'
            ? 'No microphone found.'
            : 'Could not open the microphone.',
      );
      return;
    }

    streamRef.current = stream;

    // The live level. Cheap, and it answers "is it hearing me?" without making
    // someone record a clip to find out.
    try {
      const context = new AudioContext();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);

      const samples = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        // Root mean square around the 128 midpoint — a rough loudness, which is
        // all a meter needs.
        let sum = 0;
        for (const sample of samples) {
          const centred = (sample - 128) / 128;
          sum += centred * centred;
        }
        setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 3));
        frameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // A level meter is not worth failing a recording over.
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });

    recorder.addEventListener('stop', () => {
      const clipMs = Math.round(performance.now() - startedAtRef.current);
      /*
       * ⚠ `recorder.mimeType`, not the string we asked for. The browser has the
       * final say and may hand back something else, and the filename the server
       * builds has to match the actual bytes.
       */
      const blob = new Blob(chunks, { type: recorder.mimeType });
      teardown();

      if (blob.size === 0) {
        setError('Nothing was recorded.');
        setState('idle');
        return;
      }

      void send(blob, clipMs);
    });

    startedAtRef.current = performance.now();
    recorder.start();
    setState('recording');
  }, [send, teardown]);

  // The clock, and the hard cap.
  useEffect(() => {
    if (state !== 'recording') return;

    const timer = setInterval(() => {
      const elapsed = (performance.now() - startedAtRef.current) / 1000;
      setSeconds(elapsed);
      if (elapsed >= MAX_CLIP_SECONDS) stop();
    }, 100);

    return () => clearInterval(timer);
  }, [state, stop]);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') void start();
  }, [state, start, stop]);

  /**
   * Can this browser record at all?
   *
   * ⚠ `navigator.mediaDevices` is undefined on an insecure origin — not just on
   * an old browser. Anything but `localhost` served over plain HTTP lands here,
   * which is a real way to lose an afternoon.
   */
  const supported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;

  return { state, level, seconds, error, setError, start, stop, toggle, supported };
}

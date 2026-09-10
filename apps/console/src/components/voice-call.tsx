'use client';

import Vapi from '@vapi-ai/web';
import { Loader2, Phone, PhoneOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Callout } from '@/components/callout';
import { VoicePoweredOrb } from '@/components/ui/voice-powered-orb';
import { VoiceTranscript } from '@/components/voice-transcript';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { foldTranscript, type TranscriptTurn } from '@/lib/voice/transcript';

/**
 * Uriel — the voice stage on `/assistant`.
 *
 * ── ⚠ The one thing this component exists to do ─────────────────────────────
 *
 * Not "start a call" — the SDK does that in one line. **Link the call to this
 * tenant.**
 *
 * `/api/webhooks/vapi` arrives with no cookie and no user, runs as
 * `service_role`, and every RLS policy is inert for it. The only sanctioned way
 * it learns whose messages to read is `voice_call_sessions`, and this is the
 * only place a row is ever written — from a page where a real session exists,
 * so the answer is known rather than inferred. See migration 0014.
 *
 * Until that row exists, every tool call is refused. That is deliberate and it
 * fails in the safe direction: the caller hears "I cannot reach your messages",
 * never somebody else's mail.
 *
 * ── ⚠ A race, and why it is acceptable ──────────────────────────────────────
 *
 * The call exists at Vapi before the row exists here. If the agent invoked a
 * tool in that window it would be refused — but it cannot realistically: the
 * assistant speaks its greeting first, which takes seconds, and the POST below
 * is one request that goes out the moment `start()` resolves.
 *
 * The clean fix is creating the call server-side through Vapi's REST API so the
 * row always exists first. Worth doing before a demo; not worth blocking the
 * first working call on.
 */

/** What the assistant is called out loud. Keep it matching Vapi's greeting. */
export const AGENT_NAME = 'Uriel';

/** Both are public by design — the key is a browser credential, like Supabase's. */
const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;

type CallState = 'idle' | 'connecting' | 'live' | 'ending';

/**
 * Who is talking, and how loudly.
 *
 * ⚠ Both come from the Vapi SDK, and NEITHER opens a microphone of its own.
 * The SDK already holds the mic for the call, and its own observer starts
 * automatically:
 *
 *   volume-level        the ASSISTANT's output
 *   local-volume-level  the USER's microphone
 *
 * Reading them here rather than measuring in the orb is what lets the orb move
 * when she speaks as well as when you do — a component listening to the
 * microphone can only ever see one side of the conversation, and would hear
 * her only as feedback through the laptop speakers.
 */
const HUE_USER = 0;
/** Shifted while she talks, so it is visible at a glance who has the floor. */
const HUE_ASSISTANT = 200;

export function VoiceCall() {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);

  /*
   * ⚠ Constructed lazily, in a ref, and never during render.
   *
   * The SDK touches browser APIs on construction, so building it at module
   * scope breaks the server render outright. A ref also means one instance for
   * the life of the component rather than a new one per render, which would
   * leak the previous one's event listeners.
   */
  const vapiRef = useRef<Vapi | null>(null);

  /*
   * ⚠ THE INSTANCE AND ITS LISTENERS ARE SET UP ONCE, HERE — NOT IN `start`.
   *
   * They used to be registered inside `start()`, which meant every press of
   * Call added ANOTHER full set to the same instance. Two calls, two message
   * handlers, and each transcript message folded twice. Three calls, three
   * times. The SDK never complains; the transcript just quietly turns to
   * nonsense, and only after a second call, which is why it survives a first
   * test.
   */
  useEffect(() => {
    if (!PUBLIC_KEY) return;

    const vapi = new Vapi(PUBLIC_KEY);
    vapiRef.current = vapi;

    const onCallEnd = () => {
      setState('idle');
      setLevel(0);
      setAssistantSpeaking(false);
    };

    const onError = () => {
      setError('The call dropped. Try again.');
      setState('idle');
      setLevel(0);
    };

    const onSpeechStart = () => setAssistantSpeaking(true);
    const onSpeechEnd = () => {
      setAssistantSpeaking(false);
      setLevel(0);
    };

    /*
     * ⚠ Her voice and yours drive the same orb.
     *
     * `volume-level` is the assistant's output; `local-volume-level` is the
     * microphone. Reading both is what lets the orb move when she speaks as
     * well as when you do — a component listening to the microphone alone can
     * only ever see one side of a conversation.
     */
    const onVolume = (volume: number) => setLevel(volume);
    const onLocalVolume = (volume: number) =>
      // Only while she is NOT talking, or the microphone picking her up through
      // the speakers fights her own level and the orb stutters.
      setAssistantSpeaking((speaking) => {
        if (!speaking) setLevel(volume);
        return speaking;
      });

    /*
     * The live transcript.
     *
     * ⚠ Partials REPLACE rather than append — see `foldTranscript`. Each one is
     * a fresh revision of the same utterance, so appending gives "what what's
     * what's in my" and reads as a defect in the product rather than in the
     * transcriber.
     *
     * ⚠ Nothing is stored. These turns live in state for the length of the page
     * and go nowhere — the same rule the audio itself follows.
     */
    const onMessage = (message: unknown) => {
      const m = message as {
        type?: string;
        role?: string;
        transcript?: string;
        transcriptType?: string;
      };

      if (m.type !== 'transcript' || !m.transcript || !m.role) return;

      setTurns((current) =>
        foldTranscript(current, {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          text: m.transcript ?? '',
          final: m.transcriptType === 'final',
        }),
      );
    };

    vapi.on('call-end', onCallEnd);
    vapi.on('error', onError);
    vapi.on('speech-start', onSpeechStart);
    vapi.on('speech-end', onSpeechEnd);
    vapi.on('volume-level', onVolume);
    vapi.on('local-volume-level', onLocalVolume);
    vapi.on('message', onMessage);

    return () => {
      // Hang up if the page goes away mid-call. A call nobody is on still bills
      // by the minute, and a forgotten open call is the only real way to waste
      // money here.
      vapi.stop();
      vapi.removeAllListeners();
      vapiRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    setError(null);
    // A new call starts a new transcript. The previous one stayed on screen so
    // it could be read after hanging up, but it is not this conversation.
    setTurns([]);

    const vapi = vapiRef.current;
    if (!vapi || !ASSISTANT_ID) {
      setError('Voice calling is not configured on this deployment.');
      return;
    }

    setState('connecting');

    try {
      const call = await vapi.start(ASSISTANT_ID);

      /*
       * ⚠ The call id, and the whole point of this component.
       *
       * Without it the agent can talk but can read nothing, because the webhook
       * has no way to know who is on the line.
       */
      const callId = (call as { id?: string } | null)?.id;

      if (!callId) {
        vapi.stop();
        setError('The call started but returned no id, so it could not be linked to your account.');
        setState('idle');
        return;
      }

      const response = await fetch('/api/voice/call-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vapiCallId: callId }),
      });

      if (!response.ok) {
        /*
         * ⚠ The call is STOPPED rather than left running.
         *
         * An unlinked call is not a degraded call — it is an assistant that
         * will refuse every single question while billing by the minute. Ending
         * it and saying so is more honest than letting someone talk to
         * something that cannot answer.
         */
        vapi.stop();
        setError('Could not link this call to your account, so it was ended. Try again.');
        setState('idle');
        return;
      }

      setState('live');
    } catch {
      setError('Could not start the call. Check your microphone permission.');
      setState('idle');
    }
  }, []);

  const stop = useCallback(() => {
    setState('ending');
    vapiRef.current?.stop();
  }, []);

  const configured = Boolean(PUBLIC_KEY && ASSISTANT_ID);
  const live = state === 'live';
  const busy = state === 'connecting' || state === 'ending';

  const status = !configured
    ? 'Unavailable'
    : state === 'connecting'
      ? 'Connecting'
      : state === 'ending'
        ? 'Hanging up'
        : live
          ? assistantSpeaking
            ? 'Speaking'
            : 'Listening'
          : 'Ready';

  return (
    <section className="flex flex-col items-center">
      {/*
        The orb, and the light it sits in.

        ⚠ The glow is a separate absolutely-positioned pool, not a box-shadow.
        A shadow clips to the orb's own box; this has to bleed past it and read
        through the flowing-line backdrop without hiding it.
      */}
      <div className="relative flex items-center justify-center">
        {/*
          ⚠ Deliberately faint. The reference is explicit that the void is the
          design and the particles carry every bit of the colour — a strong glow
          behind them turns a constellation into a lamp with confetti on it.
          This is just enough to stop the sphere floating on a flat plate.
        */}
        <span
          aria-hidden
          className={cn(
            'animate-orb-glow pointer-events-none absolute size-[24rem] rounded-full',
            'blur-3xl transition-colors duration-700 sm:size-[28rem]',
            live ? 'bg-primary/12' : 'bg-primary/[0.06]',
          )}
        />

        <div className="relative size-64 sm:size-72 lg:size-80">
          <VoicePoweredOrb
            level={level}
            hue={assistantSpeaking ? HUE_ASSISTANT : HUE_USER}
            fallback={
              // WebGL is genuinely absent in some renderers, and this is the
              // centre of the screen. A ring on the same number keeps the
              // signal rather than leaving a hole.
              <span
                aria-hidden
                className="size-40 rounded-full border-2 border-primary/50"
                style={{
                  transform: `scale(${1 + Math.min(level, 1) * 0.3})`,
                  transition: 'transform 90ms linear',
                }}
              />
            }
          />
        </div>
      </div>

      {/*
        Name, state, and the one control — directly under the orb, so the thing
        you address and the button that addresses it read as one object.
      */}
      <div className="-mt-2 flex flex-col items-center gap-3">
        <p className={cn(LABEL, !configured && 'text-destructive')} aria-live="polite">
          {AGENT_NAME} · {status}
        </p>

        <button
          type="button"
          onClick={live ? stop : start}
          disabled={!configured || busy}
          className={buttonClass({
            variant: live ? 'subtle' : 'primary',
            size: 'md',
            className: 'px-5',
          })}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : live ? (
            <PhoneOff className="size-3.5" aria-hidden />
          ) : (
            <Phone className="size-3.5" aria-hidden />
          )}
          {live ? 'End call' : `Talk to ${AGENT_NAME}`}
        </button>

        <p className="max-w-[46ch] text-center text-note text-muted-foreground">
          {!configured
            ? 'Voice calling is not set up on this deployment.'
            : live
              ? 'Speak normally. Interrupt whenever you like.'
              : `${AGENT_NAME} can read your attention board, search your messages, and look someone up.`}
        </p>
      </div>

      {error && (
        <div className="mt-5 w-full max-w-xl">
          <Callout tone="error" role="alert">
            {error}
          </Callout>
        </div>
      )}

      {/* Kept after the call ends — reading back what was said is most useful
          once you have stopped talking. */}
      <div className="w-full max-w-xl">
        <VoiceTranscript turns={turns} />
      </div>
    </section>
  );
}

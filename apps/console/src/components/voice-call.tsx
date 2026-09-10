'use client';

import Vapi from '@vapi-ai/web';
import { Loader2, Phone, PhoneOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Callout } from '@/components/callout';
import { VoicePoweredOrb } from '@/components/ui/voice-powered-orb';
import { VoiceTranscript } from '@/components/voice-transcript';
import { buttonClass, LABEL } from '@/lib/ui';
import { foldTranscript, type TranscriptTurn } from '@/lib/voice/transcript';

/**
 * Start a call with the Vapi voice agent (voice V2).
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

  const getVapi = useCallback((): Vapi | null => {
    if (!PUBLIC_KEY) return null;
    if (!vapiRef.current) vapiRef.current = new Vapi(PUBLIC_KEY);
    return vapiRef.current;
  }, []);

  // Hang up if the page goes away mid-call. A call nobody is on still bills by
  // the minute, and a forgotten open call is the only real way to waste money.
  useEffect(() => {
    return () => {
      vapiRef.current?.stop();
    };
  }, []);

  const start = useCallback(async () => {
    setError(null);
    // A new call starts a new transcript. The previous one stayed on screen so
    // it could be read after hanging up, but it is not this conversation.
    setTurns([]);

    const vapi = getVapi();
    if (!vapi || !ASSISTANT_ID) {
      setError('Voice calling is not configured on this deployment.');
      return;
    }

    setState('connecting');

    try {
      vapi.on('call-end', () => {
        setState('idle');
        setLevel(0);
        setAssistantSpeaking(false);
      });
      vapi.on('error', () => {
        setError('The call dropped. Try again.');
        setState('idle');
        setLevel(0);
      });

      /*
       * ⚠ Her voice and yours drive the same orb.
       *
       * `volume-level` is the assistant's output; `local-volume-level` is the
       * microphone. Whoever is louder wins the orb, which is what makes a
       * conversation read as a conversation rather than as a level meter for
       * one participant.
       */
      vapi.on('speech-start', () => setAssistantSpeaking(true));
      vapi.on('speech-end', () => {
        setAssistantSpeaking(false);
        setLevel(0);
      });

      /*
       * The live transcript.
       *
       * ⚠ Partials REPLACE rather than append — see `foldTranscript`. They
       * arrive many times a second and each one is a fresh revision of the same
       * utterance, so appending produces "what what's what's in my" and reads
       * as a defect in the product rather than in the transcriber.
       *
       * ⚠ Nothing is stored. These turns live in state for the length of the
       * page and go nowhere — the same rule the audio itself follows.
       */
      vapi.on('message', (message: unknown) => {
        const m = message as {
          type?: string;
          role?: 'user' | 'assistant';
          transcript?: string;
          transcriptType?: 'partial' | 'final';
        };

        if (m.type !== 'transcript' || !m.transcript || !m.role) return;

        setTurns((current) =>
          foldTranscript(current, {
            role: m.role === 'assistant' ? 'assistant' : 'user',
            text: m.transcript ?? '',
            final: m.transcriptType === 'final',
          }),
        );
      });

      vapi.on('volume-level', (volume: number) => setLevel(volume));
      vapi.on('local-volume-level', (volume: number) =>
        // ⚠ Only when she is NOT talking. Otherwise the microphone picking her
        // up through the speakers fights her own level and the orb stutters.
        setAssistantSpeaking((speaking) => {
          if (!speaking) setLevel(volume);
          return speaking;
        }),
      );

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
  }, [getVapi]);

  const stop = useCallback(() => {
    setState('ending');
    vapiRef.current?.stop();
  }, []);

  const configured = Boolean(PUBLIC_KEY && ASSISTANT_ID);
  const live = state === 'live';
  const busy = state === 'connecting' || state === 'ending';

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex flex-wrap items-center gap-4">
        {/*
          Only while a call is live. An orb spinning at an idle screen is
          decoration; an orb that appears when the line opens is a status light.
        */}
        {(live || state === 'connecting') && (
          <div className="size-20 shrink-0">
            <VoicePoweredOrb
              level={level}
              hue={assistantSpeaking ? HUE_ASSISTANT : HUE_USER}
              fallback={
                // WebGL is genuinely absent in some renderers. A ring that
                // scales with the same number keeps the signal.
                <span
                  aria-hidden
                  className="size-12 rounded-full border-2 border-primary/60"
                  style={{
                    transform: `scale(${1 + Math.min(level, 1) * 0.35})`,
                    transition: 'transform 90ms linear',
                  }}
                />
              }
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className={LABEL} aria-live="polite">
            {state === 'connecting'
              ? 'Connecting'
              : live
                ? assistantSpeaking
                  ? 'Speaking'
                  : 'Listening'
                : state === 'ending'
                  ? 'Hanging up'
                  : 'Voice call'}
          </p>
          <p className="mt-1.5 max-w-[52ch] text-note text-muted-foreground">
            {!configured
              ? 'Voice calling is not set up on this deployment.'
              : live
                ? 'Speak normally. It can read your attention board, search your messages, and look someone up.'
                : 'Talk to Switchboard out loud, the way you would on the phone.'}
          </p>
        </div>

        <button
          type="button"
          onClick={live ? stop : start}
          disabled={!configured || busy}
          className={buttonClass({
            variant: live ? 'subtle' : 'primary',
            className: 'shrink-0',
          })}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : live ? (
            <PhoneOff className="size-3.5" aria-hidden />
          ) : (
            <Phone className="size-3.5" aria-hidden />
          )}
          {live ? 'Hang up' : 'Call'}
        </button>
      </div>

      {error && (
        <div className="mt-3">
          <Callout tone="error" role="alert">
            {error}
          </Callout>
        </div>
      )}

      {/*
        Kept after the call ends on purpose — reading back what was said is most
        useful once you have stopped talking.
      */}
      <VoiceTranscript turns={turns} />
    </div>
  );
}

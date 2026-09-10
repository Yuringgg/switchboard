'use client';

import Vapi from '@vapi-ai/web';
import { Loader2, Phone, PhoneOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Callout } from '@/components/callout';
import { buttonClass, LABEL } from '@/lib/ui';

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

export function VoiceCall() {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState<string | null>(null);

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

    const vapi = getVapi();
    if (!vapi || !ASSISTANT_ID) {
      setError('Voice calling is not configured on this deployment.');
      return;
    }

    setState('connecting');

    try {
      vapi.on('call-end', () => setState('idle'));
      vapi.on('error', () => {
        setError('The call dropped. Try again.');
        setState('idle');
      });

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={LABEL} aria-live="polite">
            {state === 'connecting'
              ? 'Connecting'
              : live
                ? 'On a call'
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
    </div>
  );
}

import { NextResponse } from 'next/server';

import { createServiceClient } from '@/lib/supabase/service';
import { isPlausibleCallId } from '@/lib/voice/call-session';
import { toolArgsOf, toolNameOf, type VapiToolCall } from '@/lib/voice/payload';
import { verifyVapiSignature } from '@/lib/voice/signature';
import {
  getAttentionItems,
  getPersonActivity,
  getRecentMessages,
  isVoiceTool,
  resolvePerson,
  searchMessagesForVoice,
  type ToolResult,
} from '@/lib/voice/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Vapi tool webhook.
 *
 * Vapi hosts the call — speech in, model, speech out. When the agent decides to
 * use a tool it POSTs here, and what this returns is what gets spoken.
 *
 * ── Why it lives under `app/api/webhooks/` ──────────────────────────────────
 *
 * Because that is the only place permitted to touch the service-role client,
 * and `apps/console/test/service-client-boundary.test.ts` enforces it. That
 * rule turned out to be exactly right here: this IS an ingest-shaped route — a
 * machine caller with no cookie, no session and no user, authenticating itself
 * per request. It belongs beside Gmail's and Meta's, not beside a page.
 *
 * ── ⚠⚠ THE ONE THING THAT MUST NOT GO WRONG ─────────────────────────────────
 *
 * `service_role` bypasses every RLS policy. If this route resolves the wrong
 * owner, one tenant's private mail is read aloud to another — over a phone
 * line, with no screen to notice it on.
 *
 * So the owner is **never** taken from the request body. Vapi's `call.id` is
 * treated as a claim and matched against `voice_call_sessions`, a table this
 * application wrote while a real session existed. Exactly the rule
 * `docs/02-ARCHITECTURE.md` §2 sets for adapters and migration 0006 implements
 * for WhatsApp. See migration 0014.
 *
 * An unknown or expired call id fails CLOSED.
 */

/**
 * The two headers Vapi's HMAC credential sends.
 *
 * ⚠ These are Vapi's own DEFAULTS, kept deliberately so the dashboard needs no
 * extra fields typed into it — the only two the credential form requires are a
 * name and the secret. Changing either here means changing it there too, and a
 * mismatch reads as a wrong secret rather than as a wrong header name.
 *
 * ⚠ Vapi offers Bearer, `X-Vapi-Secret`, OAuth and HMAC. HMAC is the only one
 * that proves the **body** was not altered — the others prove only that the
 * caller holds a token, so anyone who obtains it can send any payload they
 * like. On a route that decides whose mail to read, that difference matters.
 */
const SIGNATURE_HEADER = 'x-signature';
const TIMESTAMP_HEADER = 'x-timestamp';

/**
 * Vapi's payload, narrowed to the parts this route reads.
 *
 * Deliberately not a full model of their schema. Everything else in the message
 * — the transcript, the recording, the assistant config — is content this route
 * has no business inspecting, and a type that named it would invite that.
 */
interface VapiToolCallsMessage {
  message?: {
    type?: string;
    call?: { id?: string };
    toolCallList?: VapiToolCall[];
  };
}

export async function POST(request: Request) {
  const secret = process.env.VAPI_WEBHOOK_SECRET;

  if (!secret) {
    /*
     * ⚠ 404, not 401, and never "allow because nothing is configured".
     *
     * Unset config must mean the endpoint is DISABLED, exactly as
     * `EMBED_API_SECRET` does in the worker. An unconfigured route that
     * advertises it exists and is merely locked is a route somebody will
     * eventually make fail open.
     */
    console.warn('[vapi] rejected: VAPI_WEBHOOK_SECRET is not set');
    return new NextResponse('Not found', { status: 404 });
  }

  /*
   * ⚠ The RAW bytes, verified before anything is parsed.
   *
   * A `JSON.parse` → `JSON.stringify` round trip reorders keys and drops
   * whitespace, and the digest would never match. Read as text, verify, then
   * parse — the rule `verifyHubSignature` spells out for Meta.
   *
   * ⚠ Vapi signs `{timestamp}.{body}`, not the body alone. See
   * `lib/voice/signature.ts` — signing the body only would have rejected every
   * genuine delivery, and turning their timestamp OFF to make it simpler would
   * have thrown away replay protection on the one route that reads private mail
   * aloud.
   */
  const rawBody = await request.text();

  const check = verifyVapiSignature({
    rawBody,
    signature: request.headers.get(SIGNATURE_HEADER),
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    secret,
  });

  if (!check.ok) {
    /*
     * The reason is LOGGED, never returned. It is genuinely useful while
     * wiring the dashboard up — "stale-timestamp" and "bad-signature" have
     * completely different fixes — and telling the caller which part failed
     * helps only somebody probing the endpoint.
     */
    console.warn(`[vapi] rejected: ${check.reason}`);
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let payload: VapiToolCallsMessage;
  try {
    payload = JSON.parse(rawBody) as VapiToolCallsMessage;
  } catch {
    return new NextResponse('Bad request', { status: 400 });
  }

  const message = payload.message;

  // Vapi sends many server events down one URL. Everything that is not a tool
  // call is acknowledged and ignored — returning an error would make Vapi retry
  // events this route was never meant to handle.
  if (message?.type !== 'tool-calls') {
    return NextResponse.json({ results: [] });
  }

  const callId = message.call?.id;
  const toolCalls = message.toolCallList ?? [];

  // ⚠ Format-checked before it reaches a query, exactly as it was before it
  // was stored. A signed request is still a request carrying a value from
  // another system, and this one selects the row that decides whose mail is read.
  if (!isPlausibleCallId(callId) || toolCalls.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const supabase = createServiceClient();

  /*
   * ── Resolve the tenant. This is the security boundary. ──────────────────
   *
   * `callId` is a CLAIM. It is matched against a row this application wrote,
   * and `owner_id` is taken from that row and from nowhere else.
   */
  const { data: sessionRow, error: sessionError } = await supabase
    .from('voice_call_sessions')
    .select('owner_id, expires_at')
    .eq('vapi_call_id', callId)
    .maybeSingle();

  if (sessionError) {
    console.error(`[vapi] session lookup failed: ${sessionError.message}`);
    return NextResponse.json({
      results: toolCalls.map((call) => ({
        toolCallId: call.id,
        result: 'TOOL_ERROR: could not verify this call.',
      })),
    });
  }

  const session = sessionRow as { owner_id: string; expires_at: string } | null;

  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    /*
     * ⚠ FAILS CLOSED, and the wording matters.
     *
     * The agent is told the call is not authorised — not that the mailbox is
     * empty. "I don't have anything about that" would be a lie that sounds
     * like an answer, and the caller would act on it.
     */
    console.warn(`[vapi] refused: no live session for call ${callId}`);
    return NextResponse.json({
      results: toolCalls.map((call) => ({
        toolCallId: call.id,
        result:
          'TOOL_ERROR: this call is not linked to an account, so no messages can be read. ' +
          'Tell the caller you cannot reach their messages right now.',
      })),
    });
  }

  const ownerId = session.owner_id;

  /*
   * Bookkeeping only. Never gates anything — see migration 0014.
   *
   * ⚠ `last_tool_name` is the NAME the agent asked for, including one this
   * route does not recognise. That case and a tool that simply failed sound
   * identical to the caller, and without recording it the difference lives only
   * in the provider's dashboard. Migration 0015.
   *
   * Name only. Never the arguments — those carry what somebody said out loud.
   */
  await supabase
    .from('voice_call_sessions')
    .update({
      last_tool_at: new Date().toISOString(),
      last_tool_name: toolCalls.map(toolNameOf).join(', ').slice(0, 200),
    })
    .eq('vapi_call_id', callId);

  /*
   * Tools run in parallel. Vapi may batch several into one request, and running
   * them in sequence would add their latencies together on a path whose whole
   * point is that it answers quickly.
   */
  const results = await Promise.all(
    toolCalls.map(async (call) => ({
      toolCallId: call.id,
      /*
       * ⚠ ALWAYS A STRING.
       *
       * Vapi's docs describe `result` as "string, object, or array", but every
       * example they publish returns a string — and an object returned here
       * produced a call where the route ran correctly (session resolved, tool
       * dispatched, data present) and the agent still told the caller it could
       * not reach their messages.
       *
       * A JSON string satisfies both readings and costs the model nothing: it
       * reads the fields either way. Under an ambiguity in someone else's API,
       * the shape that works under BOTH interpretations is the right one — the
       * same reasoning `verifySignature` uses for accepting hex and base64.
       */
      result: asToolString(await runTool(supabase, ownerId, call)),
    })),
  );

  return NextResponse.json({ results });
}

/**
 * Whatever a tool returned, as something Vapi will definitely accept.
 *
 * Errors are already strings and pass through untouched, so the `TOOL_ERROR`
 * prefix the prompt keys on survives.
 */
function asToolString(value: ToolResult | string): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Dispatch one tool call.
 *
 * ⚠ Returns a message rather than throwing, on every path. A throw here fails
 * the whole batch, so one bad argument would take out the tools beside it — and
 * what the caller hears is silence where an answer should be.
 */
async function runTool(
  supabase: ReturnType<typeof createServiceClient>,
  ownerId: string,
  call: VapiToolCall,
): Promise<ToolResult | string> {
  const name = toolNameOf(call);

  if (!isVoiceTool(name)) {
    /*
     * The agent asked for a tool that does not exist here — usually the Vapi
     * assistant and this route drifting apart.
     *
     * ⚠ An EMPTY name here means the payload shape changed again, not that
     * somebody misconfigured a tool. Said out loud so the next person reads it
     * as a parsing problem rather than hunting the dashboard for a typo.
     */
    console.warn(`[vapi] unknown tool: ${name || '(no name in payload)'}`);
    return name
      ? `TOOL_ERROR: ${name} is not a tool this assistant has.`
      : 'TOOL_ERROR: the tool call arrived with no name this route could read.';
  }

  const args = toolArgsOf(call);

  /*
   * ⚠ Every argument is untrusted. It was produced by a language model from
   * something a person said out loud, which is two layers of "not a validated
   * input" — so each is narrowed to a string here rather than passed through.
   */
  const asString = (value: unknown): string =>
    typeof value === 'string' ? value.slice(0, 200) : '';

  try {
    switch (name) {
      case 'resolve_person':
        return await resolvePerson(supabase, ownerId, asString(args.name));

      case 'get_attention_items':
        return await getAttentionItems(supabase, ownerId);

      case 'get_recent_messages':
        return await getRecentMessages(supabase, ownerId, {
          channel: asString(args.channel),
        });

      case 'search_messages':
        return await searchMessagesForVoice(supabase, ownerId, asString(args.query));

      case 'get_person_activity':
        return await getPersonActivity(supabase, ownerId, asString(args.person_id));
    }
  } catch (cause) {
    /*
     * ⚠ The reason is logged, never returned. It can carry a Postgres error
     * naming a column and a value, and the value could be a fragment of
     * somebody's message — which this route would then read aloud.
     */
    console.error(
      `[vapi] tool ${name} failed:`,
      cause instanceof Error ? cause.message : 'unknown',
    );
    return 'TOOL_ERROR: that lookup failed. Tell the caller to try again in a moment.';
  }
}

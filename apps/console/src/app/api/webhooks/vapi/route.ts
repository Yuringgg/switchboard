import { createHmac } from 'node:crypto';

import { safeEqual } from '@switchboard/core';
import { NextResponse } from 'next/server';

import { createServiceClient } from '@/lib/supabase/service';
import { isPlausibleCallId } from '@/lib/voice/call-session';
import {
  getAttentionItems,
  getPersonActivity,
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
 * HMAC-SHA256 over the raw body, hex, in a header we choose.
 *
 * ⚠ Vapi offers Bearer, `X-Vapi-Secret`, OAuth and HMAC. HMAC is the only one
 * that proves the **body** was not altered — the others prove only that the
 * caller holds a token, so anyone who obtains it can send any payload they
 * like. On a route that decides whose mail to read, that difference matters.
 *
 * Same shape as the WhatsApp route's check, and for the same reasons: the
 * digest is computed over the exact bytes received, and the comparison is
 * timing-safe.
 */
const SIGNATURE_HEADER = 'x-vapi-signature';

interface VapiToolCall {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
}

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
   */
  const rawBody = await request.text();
  const provided = request.headers.get(SIGNATURE_HEADER);

  const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (!provided || !safeEqual(provided, digest)) {
    // No detail. An unverified body is attacker-controlled input, and saying
    // which part failed helps only the attacker.
    console.warn('[vapi] rejected: bad signature');
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

  // Bookkeeping only. Never gates anything — see migration 0014.
  await supabase
    .from('voice_call_sessions')
    .update({ last_tool_at: new Date().toISOString() })
    .eq('vapi_call_id', callId);

  /*
   * Tools run in parallel. Vapi may batch several into one request, and running
   * them in sequence would add their latencies together on a path whose whole
   * point is that it answers quickly.
   */
  const results = await Promise.all(
    toolCalls.map(async (call) => ({
      toolCallId: call.id,
      result: await runTool(supabase, ownerId, call),
    })),
  );

  return NextResponse.json({ results });
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
  if (!isVoiceTool(call.name)) {
    // The agent asked for a tool that does not exist here. Naming it is right:
    // it usually means the Vapi assistant and this route have drifted apart.
    console.warn(`[vapi] unknown tool: ${call.name}`);
    return `TOOL_ERROR: ${call.name} is not a tool this assistant has.`;
  }

  const args = call.arguments ?? {};

  /*
   * ⚠ Every argument is untrusted. It was produced by a language model from
   * something a person said out loud, which is two layers of "not a validated
   * input" — so each is narrowed to a string here rather than passed through.
   */
  const asString = (value: unknown): string =>
    typeof value === 'string' ? value.slice(0, 200) : '';

  try {
    switch (call.name) {
      case 'resolve_person':
        return await resolvePerson(supabase, ownerId, asString(args.name));

      case 'get_attention_items':
        return await getAttentionItems(supabase, ownerId);

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
      `[vapi] tool ${call.name} failed:`,
      cause instanceof Error ? cause.message : 'unknown',
    );
    return 'TOOL_ERROR: that lookup failed. Tell the caller to try again in a moment.';
  }
}

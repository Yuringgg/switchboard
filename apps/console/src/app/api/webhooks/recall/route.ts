import { NextResponse } from 'next/server';

import { createServiceClient } from '@/lib/supabase/service';
import { isPlausibleBotId } from '@/lib/meetings/bot-session';
import { botIdOf, eventNameOf } from '@/lib/meetings/payload';
import { verifyRecallSignature } from '@/lib/meetings/signature';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Recall.ai webhook — meetings arriving (Phase 7A, ADR-026).
 *
 * Recall sends a bot into a meeting, records it, transcribes it, and POSTs here
 * as the bot's status changes and when a recording is ready.
 *
 * ── ⚠⚠ WHAT THIS ROUTE DELIBERATELY DOES NOT DO ─────────────────────────────
 *
 * **It does not parse the transcript.** Not yet, and not by oversight.
 *
 * Every field this route reads beyond the bot id would be read from Recall's
 * *documentation* rather than from a delivery anyone has actually received. The
 * Vapi integration did exactly that and lost most of a day: the published shape
 * showed `{id, name, arguments}` flat, the real API sent OpenAI's nested
 * `{id, function: {name, arguments}}`, every tool was rejected identically, and
 * the cause was indistinguishable from a database outage. It took adding a
 * column (migration 0015) to see it.
 *
 * So this route's entire job in 7A is:
 *
 *   verify it is genuine → work out whose meeting it is → **store the payload
 *   untouched** → answer 200.
 *
 * That is not a stub. It is the instrument, built first on purpose. Send one
 * bot into one meeting and the real payload lands in `raw_events`, where its
 * actual shape can be READ rather than assumed — and only then is it worth
 * writing the code that maps it onto `messages`.
 *
 * `raw_events` already exists for precisely this: *"Untouched provider payload,
 * stored as jsonb. Never pre-parse it here."*
 *
 * ── ⚠⚠ THE ONE THING THAT MUST NOT GO WRONG ─────────────────────────────────
 *
 * `service_role` bypasses every RLS policy. If this route resolves the wrong
 * owner, one tenant's private meeting transcript is filed into another tenant's
 * inbox.
 *
 * So the owner is **never** taken from the request body. Recall's bot id is
 * treated as a claim and matched against `meeting_bot_sessions`, a table this
 * application wrote while a real session existed. Same rule as
 * `docs/02-ARCHITECTURE.md` §2 sets for adapters, migration 0006 implements for
 * WhatsApp, and migration 0014 implements for voice. See migration 0016.
 *
 * An unknown or expired bot id fails CLOSED.
 *
 * ── Why it lives under `app/api/webhooks/` ──────────────────────────────────
 *
 * Because that is the only place permitted to touch the service-role client,
 * and `apps/console/test/service-client-boundary.test.ts` enforces it. This is
 * an ingest-shaped route — a machine caller with no cookie, no session and no
 * user, authenticating itself per request. It belongs beside Gmail's, Meta's
 * and Vapi's.
 */

/**
 * Svix's three headers.
 *
 * ⚠ Recall does not sign these itself — Svix delivers them, so the scheme and
 * the header names are Svix's. See `lib/meetings/signature.ts`, which cites the
 * source and the date it was read.
 *
 * ⚠ Svix's Enterprise plans can emit `webhook-` prefixed headers instead. Both
 * are accepted because accepting both costs nothing and a silent header rename
 * on a plan change would read as a wrong secret.
 */
const ID_HEADERS = ['svix-id', 'webhook-id'] as const;
const TIMESTAMP_HEADERS = ['svix-timestamp', 'webhook-timestamp'] as const;
const SIGNATURE_HEADERS = ['svix-signature', 'webhook-signature'] as const;

function firstHeader(request: Request, names: readonly string[]): string | null {
  for (const name of names) {
    const value = request.headers.get(name);
    if (value) return value;
  }
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.RECALL_WEBHOOK_SECRET;

  if (!secret) {
    /*
     * ⚠ 404, not 401, and never "allow because nothing is configured".
     *
     * Unset config must mean the endpoint is DISABLED, exactly as
     * `EMBED_API_SECRET` does in the worker and `VAPI_WEBHOOK_SECRET` does next
     * door. An unconfigured route that advertises it exists and is merely
     * locked is a route somebody will eventually make fail open.
     */
    console.warn('[recall] rejected: RECALL_WEBHOOK_SECRET is not set');
    return new NextResponse('Not found', { status: 404 });
  }

  /*
   * ⚠ The RAW bytes, verified before anything is parsed. A `JSON.parse` →
   * `JSON.stringify` round trip reorders keys and drops whitespace, and the
   * digest would never match.
   */
  const rawBody = await request.text();

  const check = verifyRecallSignature({
    rawBody,
    id: firstHeader(request, ID_HEADERS),
    timestamp: firstHeader(request, TIMESTAMP_HEADERS),
    signature: firstHeader(request, SIGNATURE_HEADERS),
    secret,
  });

  if (!check.ok) {
    /*
     * The reason is LOGGED, never returned. It is genuinely useful while
     * setting the integration up and it is a gift to anybody probing the
     * endpoint — "stale-timestamp" tells them the signature was otherwise fine.
     */
    console.warn('[recall] rejected', { reason: check.reason });
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn('[recall] rejected: body is not JSON');
    return new NextResponse('Bad request', { status: 400 });
  }

  const botId = botIdOf(payload);
  const eventName = eventNameOf(payload);

  if (!isPlausibleBotId(botId)) {
    /*
     * ⚠ This is the failure mode the Vapi integration actually hit, and the
     * log line is written to make it obvious rather than mysterious. If
     * Recall's real shape differs from the documented one, `botId` is undefined
     * here and THIS line says so, naming the event it came from — instead of
     * every delivery failing identically somewhere further down.
     */
    console.warn('[recall] no usable bot id in payload', {
      event: eventName || '(none)',
      keys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
    });
    return new NextResponse('Bad request', { status: 400 });
  }

  const supabase = createServiceClient();

  /*
   * ⚠⚠ THE TENANT BOUNDARY. The owner comes from THIS row and from nowhere
   * else. Nothing in `payload` may influence it — see the header note and
   * ADR-026.
   */
  const { data: session, error: sessionError } = await supabase
    .from('meeting_bot_sessions')
    .select('owner_id, channel_id, expires_at')
    .eq('recall_bot_id', botId)
    .maybeSingle();

  if (sessionError) {
    // A real failure, not a rejection. 500 so Svix retries — losing a
    // transcript to a transient database blip would be silent data loss.
    console.error('[recall] session lookup failed', { event: eventName });
    return new NextResponse('Server error', { status: 500 });
  }

  if (!session) {
    console.warn('[recall] unknown bot id — refusing', { event: eventName });
    return new NextResponse('Not found', { status: 404 });
  }

  const { owner_id: ownerId, channel_id: channelId, expires_at: expiresAt } = session as {
    owner_id: string;
    channel_id: string;
    expires_at: string;
  };

  if (new Date(expiresAt).getTime() <= Date.now()) {
    /*
     * ⚠ Fails CLOSED. Refusing a legitimate delivery is an inconvenience;
     * accepting one for a session we no longer vouch for is not.
     *
     * 200, not an error: this is a deliberate refusal, and a 4xx would make
     * Svix retry a decision that will never change.
     */
    console.warn('[recall] expired bot session — refusing', { event: eventName });
    return NextResponse.json({ received: true, stored: false }, { status: 200 });
  }

  /*
   * ⚠ Recorded BEFORE the payload is interpreted, and recorded even when the
   * event is one we do nothing with. This is migration 0015's lesson applied
   * ahead of the failure instead of after it: when something goes wrong, the
   * first question is always "what did they actually send?", and this column
   * answers it without keeping a transcript.
   */
  await supabase
    .from('meeting_bot_sessions')
    .update({ last_event_at: new Date().toISOString(), last_event_type: eventName || null })
    .eq('recall_bot_id', botId);

  /*
   * The payload, untouched, filed against the right tenant.
   *
   * ⚠ `external_id` is Svix's delivery id, not Recall's bot id — Svix
   * redelivers on any non-2xx, and a bot emits many events, so the bot id would
   * collide across them. The delivery id is the thing that is unique per
   * attempt and is what a dedup check would key on.
   */
  const { error: insertError } = await supabase.from('raw_events').insert({
    owner_id: ownerId,
    channel_id: channelId,
    external_id: firstHeader(request, ID_HEADERS),
    payload,
  });

  if (insertError) {
    console.error('[recall] could not store raw event', { event: eventName });
    // 500 so it is retried. See the note on the lookup failure above.
    return new NextResponse('Server error', { status: 500 });
  }

  /*
   * 200 immediately. ADR-011: verify, persist, return — all slow work happens
   * in the worker. A webhook that answers slowly gets retried and eventually
   * disabled by the provider.
   */
  return NextResponse.json({ received: true, stored: true }, { status: 200 });
}

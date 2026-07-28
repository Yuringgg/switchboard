import { parseWebhookPayload } from '@switchboard/adapter-whatsapp/parse';
import { safeEqual, verifyHubSignature } from '@switchboard/core';
import { NextResponse, type NextRequest } from 'next/server';

import { createServiceClient } from '@/lib/supabase/service';

/**
 * WhatsApp Cloud API webhook.
 *
 * Verify → insert → 200. See ../README.md before adding anything to this file.
 *
 * ── Why this route returns 200 for almost everything ─────────────────────────
 *
 * Meta treats any non-200 as a delivery failure and retries with decreasing
 * frequency for **up to 7 days**, then disables the endpoint. A 500 that repeats
 * therefore does not merely lose one message — it takes the channel offline in
 * a way nothing in this system reports. So the only non-2xx answers here are
 * `401` for a body that failed the HMAC (which is an intruder, not Meta) and
 * `500` for a database fault (which is transient and worth a retry). Everything
 * else — an unknown number, a shape we cannot read, a duplicate — is a 200,
 * because retrying it will never produce a different result.
 */

// Reading the raw body requires the Node runtime, not Edge.
export const runtime = 'nodejs';

/**
 * Meta's subscription handshake. Meta GETs this endpoint with a challenge and
 * expects the challenge echoed back verbatim as plain text.
 */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected) {
    return new NextResponse('Not configured', { status: 503 });
  }

  if (mode === 'subscribe' && token && safeEqual(token, expected) && challenge) {
    // Plain text, not JSON — Meta compares the body byte for byte.
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }

  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    // Fail closed. Unset config must never mean "skip verification".
    return new NextResponse('Not configured', { status: 503 });
  }

  // ⚠ The RAW body, before any parsing. The HMAC is over these exact bytes;
  //   a parse/re-stringify round trip changes key order and whitespace and the
  //   signature will not match.
  const rawBody = await request.text();

  const signature = request.headers.get('x-hub-signature-256');
  if (!verifyHubSignature(rawBody, signature, appSecret)) {
    // Unverified means attacker-controlled. Do not parse it, do not log it.
    console.warn('[webhooks/whatsapp] rejected: bad or missing signature');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Verified, so this is genuinely Meta — but still a shape we may not know.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn('[webhooks/whatsapp] verified body was not JSON; ignoring');
    return NextResponse.json({ received: true, ignored: true });
  }

  const { events, skipped } = parseWebhookPayload(payload);

  if (events.length === 0) {
    // The ordinary case in a live account: delivery receipts and nothing else.
    // Counts only, never content (docs/02-ARCHITECTURE.md §6) — and they are
    // logged so a quiet webhook can be told apart from a broken one.
    console.info(
      `[webhooks/whatsapp] nothing to queue statuses=${skipped.statuses} ` +
        `otherFields=${skipped.otherFields} unusable=${skipped.unusable}`,
    );
    return NextResponse.json({ received: true, queued: 0 });
  }

  // Service role: a Meta webhook has no user, so there is no session for RLS to
  // scope. See lib/supabase/service.ts for why that is contained rather than
  // convenient.
  const supabase = createServiceClient();

  /*
   * ── owner_id comes from the CHANNEL, never the payload ────────────────────
   *
   * Rule 1 of the ingest contract. `phone_number_id` is a claim made by a
   * request; this lookup is what turns it into "a business number we know,
   * owned by a specific tenant". Getting it wrong puts one user's messages in
   * another's console, and RLS cannot catch it because this client bypasses
   * RLS.
   *
   * One POST can carry messages for more than one business number — see
   * fixtures/whatsapp/batch.json — so the numbers are resolved as a set and
   * each message is queued against the channel its OWN number resolved to.
   */
  const accountRefs = [...new Set(events.map((event) => event.phoneNumberId))];

  const { data: channelRows, error: lookupError } = await supabase
    .from('channels')
    .select('id, owner_id, external_account_id')
    .eq('type', 'whatsapp')
    .in('external_account_id', accountRefs);

  if (lookupError) {
    // A database problem, not a bad request. 500 so Meta retries with backoff
    // rather than dropping real messages.
    console.error(`[webhooks/whatsapp] channel lookup failed: ${lookupError.message}`);
    return new NextResponse('Lookup failed', { status: 500 });
  }

  const channels = new Map(
    (channelRows ?? []).map((row) => [row.external_account_id as string, row]),
  );

  let queued = 0;
  let duplicates = 0;
  let unknown = 0;

  for (const event of events) {
    const channel = channels.get(event.phoneNumberId);

    if (!channel) {
      /*
       * An authentic message for a number this deployment does not have
       * provisioned — most likely the app is subscribed to a WABA whose number
       * was never assigned an owner. Counted and dropped, NOT guessed at:
       * there is no safe default owner, and inventing one is the single
       * mistake in this system that no policy will catch.
       */
      unknown += 1;
      continue;
    }

    const { error: insertError } = await supabase.from('raw_events').insert({
      owner_id: channel.owner_id,
      channel_id: channel.id,
      // The wamid — stable across Meta's redeliveries, so it is the
      // idempotency key. Migration 0004 enforces it.
      external_id: event.externalId,
      /*
       * The whole envelope, self-sufficient by design: this message, the
       * sender's profile, and the business number it arrived on. The worker
       * normalizes from exactly this and needs nothing else — the rule Phase
       * 2's refactor checkpoint produced (see ChannelAdapter in core).
       */
      payload: event.envelope,
      status: 'pending',
    });

    if (insertError) {
      // 23505 is unique_violation: Meta redelivered something already queued.
      // At-least-once delivery is normal operation, and a duplicate is a
      // success from our side.
      if (insertError.code === '23505') {
        duplicates += 1;
        continue;
      }

      console.error(`[webhooks/whatsapp] failed to queue: ${insertError.message}`);
      return new NextResponse('Queue failed', { status: 500 });
    }

    queued += 1;
  }

  // IDs and counts only — never a number, never content. §6.
  console.info(
    `[webhooks/whatsapp] queued=${queued} duplicates=${duplicates} ` +
      `unknownNumber=${unknown} statuses=${skipped.statuses} unusable=${skipped.unusable}`,
  );

  return NextResponse.json({ received: true, queued });
}

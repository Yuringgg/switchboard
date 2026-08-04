import { parseWebhookPayload } from '@switchboard/adapter-whatsapp/parse';
import { resolveSigningScheme, safeEqual, verifySignature } from '@switchboard/core';
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
  /*
   * Which upstream is delivering this — Meta directly, or a Business Solution
   * Provider forwarding Meta's envelope? The payload is identical either way
   * (verified against 360dialog's webhook reference, 2026-08-04); only the
   * signature header and secret differ. See `resolveSigningScheme` in core.
   */
  const scheme = resolveSigningScheme(process.env);
  if (!scheme) {
    // Fail closed. Unset config must never mean "skip verification".
    return new NextResponse('Not configured', { status: 503 });
  }

  // ⚠ The RAW body, before any parsing. The HMAC is over these exact bytes;
  //   a parse/re-stringify round trip changes key order and whitespace and the
  //   signature will not match.
  const rawBody = await request.text();

  const signature = request.headers.get(scheme.header);
  if (!verifySignature(rawBody, signature, scheme)) {
    /*
     * Unverified means attacker-controlled. Do not parse it, do not store it.
     *
     * ⚠ But say enough to tell the two causes apart. "Bad or missing signature"
     * collapses **wrong secret** and **we are reading a header nobody sent**
     * into one sentence, and they have opposite fixes — rotate a value versus
     * change a provider setting. Setting this up cost hours to exactly that
     * ambiguity.
     *
     * So: the scheme label, whether our header was present at all, and the
     * NAMES of any auth-shaped headers that did arrive. Names are not secrets;
     * values are, and no value is logged. That list is also how you discover
     * a provider signs with something undocumented — which is the position this
     * integration was in an hour ago.
     */
    const offered = [...request.headers.keys()]
      .filter((name) => /signature|hmac|hub|token|auth/i.test(name))
      .sort();

    console.warn(
      `[webhooks/whatsapp] rejected: bad or missing credential ` +
        `(scheme=${scheme.label} expected=${scheme.header} ` +
        `present=${signature !== null} offered=[${offered.join(' ')}])`,
    );
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
  const unknownRefs = new Set<string>();

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
      unknownRefs.add(event.phoneNumberId);
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

  /*
   * ⚠ Name the unresolved business ids, not just how many there were.
   *
   * `phone_number_id` is the ONLY thing that can be provisioned against, and
   * during setup it is the thing you do not yet have: an unprovisioned number
   * returns 200 and stores nothing, deliberately, so the first real message
   * leaves no trace anywhere. Meta's dashboard at least prints the id on its API
   * Setup page; a BSP may not, and then `unknownNumber=1` is the whole story —
   * a count that says work is needed and withholds the one value needed to do
   * it. This line is what makes provisioning possible from a live delivery.
   *
   * §6 permits it: the rule is "never log message bodies or credentials; log
   * message IDs." A `phone_number_id` is an opaque business identifier, not a
   * credential and not a person's number. ⚠ `display_phone_number` IS a phone
   * number and is deliberately not logged here — that distinction is the same
   * one the tenant lookup is built on.
   */
  if (unknownRefs.size > 0) {
    console.warn(
      `[webhooks/whatsapp] no channel provisioned for phone_number_id=${[...unknownRefs].join(',')} ` +
        `— run: pnpm --filter @switchboard/db provision-whatsapp`,
    );
  }

  return NextResponse.json({ received: true, queued });
}

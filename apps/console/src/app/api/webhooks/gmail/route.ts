import { parsePushNotification, verifyPushToken } from '@switchboard/adapter-gmail';
import { NextResponse, type NextRequest } from 'next/server';

import { createServiceClient } from '@/lib/supabase/service';

/**
 * Gmail webhook — a Google Cloud Pub/Sub push subscription.
 *
 * Verify → insert → 200. See ../README.md before adding anything to this file.
 *
 * The notification carries **no message content**, only the mailbox address and
 * a `historyId`. The worker then calls `users.history.list` from the stored
 * cursor. So this route queues "go look", not a message.
 */

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const audience = process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE;
  const serviceAccountEmail = process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT;

  if (!audience || !serviceAccountEmail) {
    // Fail closed. Unset config must never mean "skip verification".
    return new NextResponse('Not configured', { status: 503 });
  }

  const verification = await verifyPushToken({
    authorization: request.headers.get('authorization'),
    audience,
    serviceAccountEmail,
  });

  if (!verification.ok) {
    // Unverified means attacker-controlled. Do not parse the body.
    console.warn(`[webhooks/gmail] rejected: ${verification.reason}`);
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const parsed = parsePushNotification(await request.json().catch(() => null));

  if (!parsed.ok) {
    // 200, not 400. The token was ours, so this is a shape we don't understand
    // rather than an intruder — and a non-2xx counts against the subscription's
    // health with Pub/Sub, which retries and eventually escalates. Dropping one
    // malformed notification is recoverable; a throttled subscription is the
    // primary ingestion path degrading.
    console.warn(`[webhooks/gmail] unparseable notification: ${parsed.reason}`);
    return NextResponse.json({ received: true, ignored: true });
  }

  const { emailAddress, historyId, messageId } = parsed.notification;

  // Service role: a Pub/Sub push has no user, so there is no session for RLS to
  // scope. See lib/supabase/service.ts for why that is contained rather than
  // convenient.
  const supabase = createServiceClient();

  // ── owner_id comes from the CHANNEL, never the payload ────────────────────
  // Rule 1 of the ingest contract. The payload is attacker-influenceable input;
  // this lookup is what turns "some address claimed by a request" into "a
  // mailbox we know, owned by a specific tenant". Getting it wrong puts one
  // user's mail in another's console, and RLS cannot catch it because this
  // client bypasses RLS.
  const { data: channel, error: lookupError } = await supabase
    .from('channels')
    .select('id, owner_id')
    .eq('type', 'gmail')
    .eq('display_name', emailAddress)
    .maybeSingle();

  if (lookupError) {
    // A database problem, not a bad request. 500 so Pub/Sub retries with
    // backoff rather than dropping a real notification.
    console.error(`[webhooks/gmail] channel lookup failed: ${lookupError.message}`);
    return new NextResponse('Lookup failed', { status: 500 });
  }

  if (!channel) {
    // Authentic notification for a mailbox we do not have connected — most
    // likely a watch outliving a disconnect. 200, because retrying will never
    // make a channel appear and repeated failures degrade the subscription.
    console.warn('[webhooks/gmail] no channel for the notified mailbox; ignoring');
    return NextResponse.json({ received: true, ignored: true });
  }

  // ── Queue it ──────────────────────────────────────────────────────────────
  // The notification carries no message content — only a cursor. The worker
  // calls history.list from here. Ingest does no more than this by design
  // (ADR-011): providers disable webhooks that answer slowly.
  const { error: insertError } = await supabase.from('raw_events').insert({
    owner_id: channel.owner_id,
    channel_id: channel.id,
    // Pub/Sub's messageId is stable across redeliveries, so it is the
    // idempotency key. Migration 0004 enforces it.
    external_id: messageId,
    payload: { emailAddress, historyId, pubsubMessageId: messageId },
    status: 'pending',
  });

  if (insertError) {
    // 23505 is unique_violation: Pub/Sub redelivered something already queued.
    // That is normal at-least-once behaviour and a success from our side —
    // returning non-2xx would make Pub/Sub retry a duplicate even harder.
    if (insertError.code === '23505') {
      console.info(`[webhooks/gmail] duplicate delivery ignored pubsubId=${messageId}`);
      return NextResponse.json({ received: true, duplicate: true });
    }

    console.error(`[webhooks/gmail] failed to queue: ${insertError.message}`);
    return new NextResponse('Queue failed', { status: 500 });
  }

  // IDs only — never the address, never content. docs/02-ARCHITECTURE.md §6.
  console.info(
    `[webhooks/gmail] queued channel=${channel.id} historyId=${historyId} pubsubId=${messageId}`,
  );

  return NextResponse.json({ received: true });
}

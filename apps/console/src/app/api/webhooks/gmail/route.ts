import { parsePushNotification, verifyPushToken } from '@switchboard/adapter-gmail';
import { NextResponse, type NextRequest } from 'next/server';

import { fanOutToChannels } from '@/lib/ingest';
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
  //
  // ⚠ NOT `.maybeSingle()`. A shared mailbox has more than one owner.
  //   Migration 0003 keys `channels` on (owner_id, type, display_name) and says
  //   in as many words that two tenants connecting one mailbox is legitimate —
  //   so this query can match several rows, and `.maybeSingle()` treated that
  //   as an error, 500'd, and left Pub/Sub retrying the mailbox forever.
  //   `.limit(1)` would have been worse: it would deliver one tenant's mail to
  //   whichever row sorted first.
  const { data: channelRows, error: lookupError } = await supabase
    .from('channels')
    .select('id, owner_id')
    .eq('type', 'gmail')
    .eq('display_name', emailAddress);

  if (lookupError) {
    // A database problem, not a bad request. 500 so Pub/Sub retries with
    // backoff rather than dropping a real notification.
    console.error(`[webhooks/gmail] channel lookup failed: ${lookupError.message}`);
    return new NextResponse('Lookup failed', { status: 500 });
  }

  // ── Queue it, once per owner ──────────────────────────────────────────────
  // The notification carries no message content — only a cursor. The worker
  // calls history.list from here. Ingest does no more than this by design
  // (ADR-011): providers disable webhooks that answer slowly.
  //
  // Pub/Sub's messageId is stable across redeliveries, so it is the idempotency
  // key, and it repeats across these rows on purpose: `raw_events` is keyed
  // (channel_id, external_id) per migration 0004, so two channels queuing the
  // same notification are two distinct rows while a redelivery to either still
  // collides.
  const rows = fanOutToChannels(channelRows ?? [], messageId, {
    emailAddress,
    historyId,
    pubsubMessageId: messageId,
  });

  if (rows.length === 0) {
    // Authentic notification for a mailbox nobody has connected — most likely a
    // watch outliving a disconnect. 200, because retrying will never make a
    // channel appear and repeated failures degrade the subscription.
    console.warn('[webhooks/gmail] no channel for the notified mailbox; ignoring');
    return NextResponse.json({ received: true, ignored: true });
  }

  let queued = 0;
  let duplicates = 0;

  for (const row of rows) {
    const { error: insertError } = await supabase.from('raw_events').insert(row);

    if (insertError) {
      // 23505 is unique_violation: Pub/Sub redelivered something already
      // queued. That is normal at-least-once behaviour and a success from our
      // side — returning non-2xx would make Pub/Sub retry a duplicate harder.
      if (insertError.code === '23505') {
        duplicates += 1;
        continue;
      }

      // One tenant's insert failed. 500 so Pub/Sub retries the whole
      // notification: the rows that did land are protected by the same unique
      // index, so the retry re-queues only the one that did not.
      console.error(`[webhooks/gmail] failed to queue: ${insertError.message}`);
      return new NextResponse('Queue failed', { status: 500 });
    }

    queued += 1;
  }

  // IDs and counts only — never the address, never content. §6.
  console.info(
    `[webhooks/gmail] queued=${queued} duplicates=${duplicates} owners=${rows.length} ` +
      `historyId=${historyId} pubsubId=${messageId}`,
  );

  return NextResponse.json({ received: true, queued });
}

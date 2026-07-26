import { parsePushNotification, verifyPushToken } from '@switchboard/adapter-gmail';
import { NextResponse, type NextRequest } from 'next/server';

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

  // TODO(next): look up the channels row for `emailAddress` to get owner_id —
  // NEVER from the payload — then upsert one raw_events row keyed on
  // (channel_id, messageId) so Pub/Sub redelivery cannot double-queue.
  //
  // Address only, never content. docs/02-ARCHITECTURE.md §6.
  console.info(
    `[webhooks/gmail] verified notification for ${emailAddress} historyId=${historyId} pubsubId=${messageId}`,
  );

  return NextResponse.json({ received: true });
}

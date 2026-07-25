import { NextResponse, type NextRequest } from 'next/server';

/**
 * Gmail webhook — a Google Cloud Pub/Sub push subscription.
 *
 * Verify → insert → 200. See ../README.md before adding anything to this file.
 *
 * Gmail is hybrid push/pull: this notification only says *something changed*
 * and carries a `historyId`. It contains no message content. The worker then
 * calls `users.history.list` from the stored cursor to fetch the delta. So this
 * route inserts a single raw_event meaning "go look", not a message.
 */

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const audience = process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE;
  if (!audience) {
    return new NextResponse('Not configured', { status: 503 });
  }

  // Pub/Sub authenticates push requests with a Google-signed OIDC token, not an
  // HMAC over the body. Anyone can POST here, so an unverified request is
  // attacker-controlled input.
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    console.warn('[webhooks/gmail] rejected: no bearer token');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // TODO(Phase 1): verify the OIDC token against Google's public keys —
  // issuer https://accounts.google.com, audience GOOGLE_PUBSUB_PUSH_AUDIENCE,
  // and the service account email we granted publish rights to. Verify the
  // SIGNATURE; decoding the claims without checking it verifies nothing.
  //
  // Then: decode the base64 `message.data`, read `emailAddress` and `historyId`,
  // look up the channels row for that address to get owner_id — never take
  // owner_id from the payload — and insert one raw_events row.
  console.warn('[webhooks/gmail] token verification not implemented; rejecting');

  // Rejecting rather than accepting while unverified. Pub/Sub retries with
  // backoff and the subscription survives; silently trusting an unverified
  // token would not be recoverable.
  return new NextResponse('Not implemented', { status: 401 });
}

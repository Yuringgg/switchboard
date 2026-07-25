import { safeEqual, verifyHubSignature } from '@switchboard/core';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * WhatsApp Cloud API webhook.
 *
 * Verify → insert → 200. See ../README.md before adding anything to this file.
 *
 * Phase 2 completes the insert; the verification half is here now because it is
 * the part that is easy to get subtly, silently wrong.
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

  // TODO(Phase 2): parse via the WhatsApp adapter, resolve owner_id from the
  // channels row matching the destination phone_number_id — NEVER from the
  // payload — and insert one raw_events row per message.
  //
  // Returning 200 rather than 501: a non-2xx counts against the endpoint's
  // health with Meta, and repeated failures get the webhook disabled. Dropping
  // a message during development is recoverable; a disabled webhook is not.
  console.info('[webhooks/whatsapp] verified payload received, ingestion not yet wired');

  return NextResponse.json({ received: true });
}


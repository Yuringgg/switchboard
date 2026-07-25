import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signature verification.
 *
 * Lives in core rather than in the route because it is security-critical and
 * therefore has to be testable without spinning up a Next request — and because
 * the WhatsApp adapter needs the same function.
 */

/**
 * Constant-time string comparison.
 *
 * `===` short-circuits at the first differing byte, so how long it takes leaks
 * how much of the secret you guessed correctly. That is enough to recover a
 * signature one byte at a time.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, and the throw is itself a
  // timing signal, so lengths are checked separately and first.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify Meta's `X-Hub-Signature-256` header: `sha256=<hex>`, HMAC-SHA256 over
 * the **raw request body**, keyed with the app secret.
 *
 * ⚠ `rawBody` must be the exact bytes received. A `JSON.parse` →
 * `JSON.stringify` round trip reorders keys and drops whitespace, and the
 * resulting digest will never match. Read the body as text, verify, and only
 * then parse.
 */
export function verifyHubSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;

  const digest = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  return safeEqual(signatureHeader, `sha256=${digest}`);
}

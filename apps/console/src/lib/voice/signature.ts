import { createHmac } from 'node:crypto';

import { safeEqual } from '@switchboard/core';

/**
 * Verifying Vapi's HMAC signature.
 *
 * ⚠ Its own module, not inline in the route, for the reason
 * `packages/core/src/webhook.ts` gives for the same decision: this is
 * security-critical and therefore has to be testable without spinning up a Next
 * request. A signature check nobody can unit-test is a signature check nobody
 * checks.
 *
 * ── What Vapi actually signs, read off the credential form 2026-09-10 ───────
 *
 * NOT the body alone. The default payload format is:
 *
 *     {timestamp}.{body}
 *
 * with the timestamp sent alongside in its own header. The first version of
 * this route signed the raw body only and would have rejected every genuine
 * delivery — which reads as a wrong secret, and is the kind of thing that eats
 * an evening.
 *
 * **Their default is kept rather than turned off**, and that is a deliberate
 * choice, not convenience. Signing the body alone means a captured request
 * stays valid forever: anyone who records one can replay it and re-run its tool
 * calls against the same call session. Binding a timestamp into the signature
 * and refusing stale ones closes that. On a route whose whole job is deciding
 * whose private mail to read aloud, replay protection is worth the extra field.
 */

/**
 * How far out of step with our clock a request may be.
 *
 * Five minutes each way. Wide enough to survive ordinary clock drift between
 * Vapi's servers and Vercel's, narrow enough that a captured request is useless
 * within the length of a coffee break.
 *
 * ⚠ Both directions. A timestamp in the FUTURE is just as suspicious as an old
 * one — accepting them would let someone mint a signature now and hold it.
 */
export const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export type SignatureFailure =
  | 'no-secret'
  | 'missing-signature'
  | 'missing-timestamp'
  | 'unreadable-timestamp'
  | 'stale-timestamp'
  | 'bad-signature';

export type SignatureCheck = { ok: true } | { ok: false; reason: SignatureFailure };

/**
 * Read Vapi's timestamp header into milliseconds.
 *
 * ⚠ The unit is NOT documented, and this project's rule is not to guess at
 * provider behaviour — so both are accepted rather than one being assumed.
 * Anything past roughly 2001 in milliseconds is far beyond any plausible
 * seconds value, so the two ranges cannot be confused.
 *
 * ⚠⚠ This parse does NOT affect the signature. The HMAC is computed over the
 * header's exact characters, whatever they are. Getting the unit wrong here can
 * only make a fresh request look stale — it can never make a forged one verify.
 */
function timestampToMs(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > 1e12 ? value : value * 1000;
}

/**
 * Is this request genuinely from Vapi, and recent?
 *
 * `rawBody` must be the exact bytes received. A `JSON.parse` →
 * `JSON.stringify` round trip reorders keys and drops whitespace, and the
 * digest will never match. Read as text, verify, and only then parse.
 */
export function verifyVapiSignature({
  rawBody,
  signature,
  timestamp,
  secret,
  now = Date.now(),
}: {
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  secret: string;
  now?: number;
}): SignatureCheck {
  // Unset config means DISABLED, never "skip the check". The route turns this
  // into a 404 so an unconfigured endpoint does not advertise that it exists.
  if (!secret) return { ok: false, reason: 'no-secret' };

  if (!signature) return { ok: false, reason: 'missing-signature' };

  /*
   * ⚠ A missing timestamp is a REJECTION, not a fallback to body-only signing.
   *
   * The tempting version accepts either shape "for compatibility". That hands
   * an attacker the choice of which scheme to be checked under, and they will
   * pick the one without replay protection. Both sides of this are configured
   * by us; there is no compatibility to preserve.
   */
  if (!timestamp) return { ok: false, reason: 'missing-timestamp' };

  const sentAt = timestampToMs(timestamp);
  if (sentAt === null) return { ok: false, reason: 'unreadable-timestamp' };

  // Checked BEFORE the HMAC. A stale request is refused whether or not its
  // signature is good — that is the entire point of binding the timestamp in.
  if (Math.abs(now - sentAt) > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: 'stale-timestamp' };
  }

  // The timestamp's exact characters, a literal dot, then the exact body —
  // Vapi's `{timestamp}.{body}` payload format.
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');

  // Timing-safe: `===` short-circuits at the first differing byte, which leaks
  // how much of the digest was guessed correctly.
  if (!safeEqual(signature, digest)) return { ok: false, reason: 'bad-signature' };

  return { ok: true };
}

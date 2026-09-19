import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifying Recall.ai's webhook signature.
 *
 * ⚠ Its own module, not inline in the route, for the reason
 * `packages/core/src/webhook.ts` and `lib/voice/signature.ts` both give for the
 * same decision: this is security-critical and therefore has to be testable
 * without spinning up a Next request. A signature check nobody can unit-test is
 * a signature check nobody checks.
 *
 * ── What Recall actually signs ──────────────────────────────────────────────
 *
 * Recall does not sign webhooks itself. It delivers them **through Svix**,
 * which means the scheme is Svix's, not Recall's — and Svix publishes it.
 * Read from Svix's own verification reference on 2026-09-18:
 *
 *   headers   svix-id · svix-timestamp · svix-signature
 *   content   `{svix-id}.{svix-timestamp}.{body}`
 *   digest    HMAC-SHA256, base64 encoded
 *   secret    `whsec_<base64>` — the part AFTER the underscore is base64 and
 *             must be DECODED to raw bytes before it is used as the HMAC key
 *   header    a SPACE-DELIMITED list of `v1,<signature>` entries
 *
 * ── ⚠ The three ways this is easy to get wrong ──────────────────────────────
 *
 * 1. **The key is decoded bytes, not the string.** Using the secret verbatim as
 *    the HMAC key produces a digest that never matches, and the failure reads
 *    as a wrong secret rather than as wrong code. This is the single most
 *    common Svix integration bug.
 *
 * 2. **The header holds a LIST.** Svix sends more than one signature during key
 *    rotation. Comparing against the whole header string fails the moment a
 *    secret is rotated — quietly, and only in production.
 *
 * 3. **`v1,` is a prefix to strip, not part of the digest.**
 *
 * None of this was guessed. The Vapi integration lost most of a day to a
 * payload shape taken from documentation that did not match the API, and the
 * rule that came out of it is the reason this comment cites a date and a
 * source: **verify the scheme, then write the verifier.**
 */

/**
 * How far out of step with our clock a delivery may be.
 *
 * Five minutes each way, matching what Svix's own libraries use and what
 * `lib/voice/signature.ts` allows for Vapi. Wide enough to survive ordinary
 * clock drift between Svix's servers and Vercel's, narrow enough that a
 * captured request is useless within the length of a coffee break.
 *
 * ⚠ Both directions. A timestamp in the FUTURE is just as suspicious as an old
 * one — accepting them would let someone mint a signature now and hold it.
 */
export const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export type SignatureFailure =
  | 'no-secret'
  | 'missing-id'
  | 'missing-signature'
  | 'missing-timestamp'
  | 'unreadable-timestamp'
  | 'stale-timestamp'
  | 'unusable-secret'
  | 'bad-signature';

export type SignatureCheck = { ok: true } | { ok: false; reason: SignatureFailure };

/**
 * Constant-time compare.
 *
 * ⚠ Local rather than imported from `@switchboard/core`: that package's
 * `safeEqual` is the right function, but this module is in the console app and
 * the console's dependency on core is already load-bearing elsewhere. Keeping
 * the comparison here means this file can be read, and audited, on its own.
 * The implementation is deliberately identical.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, and the throw is itself a
  // timing signal, so lengths are checked separately and first.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Svix timestamps are unix SECONDS.
 *
 * ⚠ Unlike Vapi's, this unit *is* documented, so it is not guessed at — but a
 * value that is obviously milliseconds is still rejected rather than silently
 * reinterpreted. Quietly accepting both would hide a caller sending the wrong
 * thing, and this is not a field worth being generous about.
 *
 * ⚠⚠ This parse does NOT affect the signature. The HMAC is computed over the
 * header's exact characters, whatever they are. Getting this wrong can only
 * make a fresh request look stale — it can never make a forged one verify.
 */
function timestampToMs(raw: string): number | null {
  if (!/^\d{1,12}$/.test(raw.trim())) return null;
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1000;
}

/**
 * Turn `whsec_<base64>` into the raw key bytes Svix actually signs with.
 *
 * The prefix is optional here because it is optional in practice — Svix's
 * dashboard shows it, some users store the whole string and some strip it, and
 * refusing one of those two forms would be a footgun with no security benefit.
 * What is NOT optional is the base64 decode. See note 1 at the top.
 */
function secretToKey(secret: string): Buffer | null {
  const body = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  if (!body) return null;

  const key = Buffer.from(body, 'base64');
  // A non-base64 secret decodes to something short and meaningless rather than
  // throwing, so emptiness is the only signal available.
  return key.length > 0 ? key : null;
}

export interface VerifyInput {
  /** The EXACT bytes received. See the warning below. */
  rawBody: string;
  id: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  secret: string | undefined;
  now?: Date;
}

/**
 * Is this delivery genuinely from Recall, and recent?
 *
 * ⚠ `rawBody` must be the exact bytes received. A `JSON.parse` →
 * `JSON.stringify` round trip reorders keys and drops whitespace, and the
 * digest will never match. Read as text, verify, and only then parse — the same
 * rule `verifyHubSignature` spells out for Meta and `verifyVapiSignature` for
 * Vapi.
 */
export function verifyRecallSignature({
  rawBody,
  id,
  timestamp,
  signature,
  secret,
  now = new Date(),
}: VerifyInput): SignatureCheck {
  if (!secret) return { ok: false, reason: 'no-secret' };
  if (!id) return { ok: false, reason: 'missing-id' };
  if (!signature) return { ok: false, reason: 'missing-signature' };

  /*
   * ⚠ A missing timestamp is REFUSED rather than treated as "sign the body
   * alone". Falling back to a weaker scheme when a field is absent hands an
   * attacker the weaker scheme on request — they simply omit the header. Same
   * decision as `verifyVapiSignature`.
   */
  if (!timestamp) return { ok: false, reason: 'missing-timestamp' };

  const sentAt = timestampToMs(timestamp);
  if (sentAt === null) return { ok: false, reason: 'unreadable-timestamp' };

  if (Math.abs(now.getTime() - sentAt) > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: 'stale-timestamp' };
  }

  const key = secretToKey(secret);
  if (!key) return { ok: false, reason: 'unusable-secret' };

  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`, 'utf8')
    .digest('base64');

  /*
   * ⚠ The header is a LIST. See note 2 at the top — during a secret rotation
   * Svix signs with both the old and the new key and sends both, so matching
   * ANY entry is correct and matching the whole header is a rotation outage.
   *
   * `every`-style short-circuiting is avoided deliberately: every candidate is
   * compared so the work does not depend on which one matches.
   */
  let matched = false;
  for (const entry of signature.split(' ')) {
    const comma = entry.indexOf(',');
    // No version prefix means a malformed entry, not a bare signature. Treat it
    // as a non-match rather than guessing at what was meant.
    if (comma < 0) continue;

    const version = entry.slice(0, comma);
    if (version !== 'v1') continue;

    if (safeEqual(entry.slice(comma + 1), expected)) matched = true;
  }

  return matched ? { ok: true } : { ok: false, reason: 'bad-signature' };
}

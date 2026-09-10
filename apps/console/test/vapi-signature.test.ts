import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MAX_TIMESTAMP_SKEW_MS, verifyVapiSignature } from '../src/lib/voice/signature';

/**
 * Vapi's webhook signature.
 *
 * ⚠ This is the door. Everything behind it runs as `service_role` and reads
 * private mail out loud, so the tests below are less about "does the happy path
 * work" and more about which forgeries are refused.
 *
 * The payload format is Vapi's own default, read off the credential form on
 * 2026-09-10: `{timestamp}.{body}`, hex, SHA256. The first version of this
 * route signed the body alone and would have rejected every genuine delivery.
 */

const SECRET = 'a'.repeat(64);
const NOW = 1_757_400_000_000; // a fixed clock, so "stale" is deterministic
const BODY = JSON.stringify({ message: { type: 'tool-calls' } });

/** Sign the way Vapi does. */
function sign(body: string, timestamp: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

function check(overrides: Partial<Parameters<typeof verifyVapiSignature>[0]> = {}) {
  const timestamp = String(NOW);
  return verifyVapiSignature({
    rawBody: BODY,
    timestamp,
    signature: sign(BODY, timestamp),
    secret: SECRET,
    now: NOW,
    ...overrides,
  });
}

describe('verifyVapiSignature', () => {
  it('accepts a correctly signed, fresh request', () => {
    expect(check()).toEqual({ ok: true });
  });

  it('signs {timestamp}.{body}, not the body alone', () => {
    /*
     * The bug this file was written after. A body-only digest is what the
     * route computed first, and it fails against every real delivery — which
     * looks exactly like a wrong secret.
     */
    const bodyOnly = createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');

    expect(check({ signature: bodyOnly })).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a body altered after signing', () => {
    // The property a bearer token cannot give you: proof the payload is intact.
    // A swapped call id here would be a swapped TENANT.
    const timestamp = String(NOW);
    expect(
      verifyVapiSignature({
        rawBody: JSON.stringify({ message: { type: 'tool-calls', call: { id: 'someone-else' } } }),
        timestamp,
        signature: sign(BODY, timestamp),
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a replay from beyond the window', () => {
    const old = String(NOW - MAX_TIMESTAMP_SKEW_MS - 1000);
    // Correctly signed — and still refused. That is the whole point of keeping
    // Vapi's timestamp rather than switching it off for simplicity.
    expect(
      check({ timestamp: old, signature: sign(BODY, old) }),
    ).toEqual({ ok: false, reason: 'stale-timestamp' });
  });

  it('rejects a timestamp from the future', () => {
    const ahead = String(NOW + MAX_TIMESTAMP_SKEW_MS + 1000);
    // Otherwise someone could mint a signature now and hold on to it.
    expect(
      check({ timestamp: ahead, signature: sign(BODY, ahead) }),
    ).toEqual({ ok: false, reason: 'stale-timestamp' });
  });

  it('accepts one at the edge of the window', () => {
    const edge = String(NOW - MAX_TIMESTAMP_SKEW_MS + 1);
    expect(check({ timestamp: edge, signature: sign(BODY, edge) })).toEqual({ ok: true });
  });

  it('accepts a timestamp in seconds as well as milliseconds', () => {
    /*
     * ⚠ Vapi does not document the unit, and this project's rule is not to
     * guess at provider behaviour. Both are accepted.
     *
     * Getting the unit wrong can only make a fresh request look stale — the
     * HMAC is over the header's exact characters either way, so it can never
     * make a forgery verify.
     */
    const seconds = String(Math.floor(NOW / 1000));
    expect(check({ timestamp: seconds, signature: sign(BODY, seconds) })).toEqual({ ok: true });
  });

  it('rejects a missing timestamp rather than falling back to body-only', () => {
    /*
     * ⚠ The tempting "accept either shape for compatibility" hands an attacker
     * the choice of scheme, and they pick the one with no replay protection.
     * Both ends of this are configured by us; there is nothing to be compatible
     * with.
     */
    expect(check({ timestamp: null })).toEqual({ ok: false, reason: 'missing-timestamp' });
    expect(check({ timestamp: '' })).toEqual({ ok: false, reason: 'missing-timestamp' });
  });

  it('rejects an unreadable timestamp', () => {
    expect(check({ timestamp: 'yesterday' })).toEqual({
      ok: false,
      reason: 'unreadable-timestamp',
    });
  });

  it('rejects a missing signature', () => {
    expect(check({ signature: null })).toEqual({ ok: false, reason: 'missing-signature' });
  });

  it('rejects a signature made with the wrong secret', () => {
    const timestamp = String(NOW);
    expect(
      check({ signature: sign(BODY, timestamp, 'b'.repeat(64)) }),
    ).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses when no secret is configured, rather than waving it through', () => {
    // Unset config must mean DISABLED. The route turns this into a 404 so an
    // unconfigured endpoint does not advertise that it exists and is locked.
    expect(check({ secret: '' })).toEqual({ ok: false, reason: 'no-secret' });
  });
});

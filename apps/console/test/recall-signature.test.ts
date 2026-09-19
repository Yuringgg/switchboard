import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  MAX_TIMESTAMP_SKEW_MS,
  verifyRecallSignature,
} from '../src/lib/meetings/signature';

/**
 * Verifying Recall.ai's Svix-delivered webhook signature.
 *
 * This route decides whose inbox a private meeting transcript is filed into, so
 * the check in front of it is worth testing properly rather than trusting.
 *
 * ⚠ The three traps these tests exist to pin down, all from Svix's published
 * scheme (read 2026-09-18) rather than from guesswork:
 *
 *   1. The HMAC key is the BASE64-DECODED part after `whsec_`, not the string.
 *   2. The signature header is a SPACE-DELIMITED LIST — more than one during a
 *      key rotation — so any entry matching is a pass.
 *   3. `v1,` is a version prefix to strip, not part of the digest.
 */

const SECRET = `whsec_${Buffer.from('switchboard-test-signing-key').toString('base64')}`;
const ID = 'msg_2abcDEF';
const BODY = JSON.stringify({
  event: 'bot.status_change',
  data: { bot: { id: '4f0d5e2a-1b2c-4d3e-8f90-aabbccddeeff' } },
});

/** Sign the way Svix does, so a passing test means the real thing passes. */
function sign(body: string, id: string, timestamp: string, secret = SECRET): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`, 'utf8').digest('base64');
}

const now = new Date('2026-09-18T02:00:00.000Z');
const stamp = String(Math.floor(now.getTime() / 1000));

describe('verifyRecallSignature', () => {
  it('accepts a genuine delivery', () => {
    const result = verifyRecallSignature({
      rawBody: BODY,
      id: ID,
      timestamp: stamp,
      signature: `v1,${sign(BODY, ID, stamp)}`,
      secret: SECRET,
      now,
    });

    expect(result).toEqual({ ok: true });
  });

  it('accepts a secret stored without the whsec_ prefix', () => {
    // Both forms are in circulation — the dashboard shows the prefix, plenty of
    // people strip it when pasting into an env var. Refusing one would be a
    // footgun with no security benefit.
    const bare = SECRET.replace(/^whsec_/, '');

    const result = verifyRecallSignature({
      rawBody: BODY,
      id: ID,
      timestamp: stamp,
      signature: `v1,${sign(BODY, ID, stamp, bare)}`,
      secret: bare,
      now,
    });

    expect(result).toEqual({ ok: true });
  });

  it('accepts when the header carries several signatures — a key rotation', () => {
    /*
     * ⚠ The one that would break in production and nowhere else. During a
     * rotation Svix signs with both keys and sends both, space-delimited.
     * Comparing against the whole header string passes every test written with
     * a single signature and fails the day the secret is rotated.
     */
    const other = `whsec_${Buffer.from('some-other-key').toString('base64')}`;
    const header = [
      `v1,${sign(BODY, ID, stamp, other)}`,
      `v1,${sign(BODY, ID, stamp)}`,
    ].join(' ');

    expect(
      verifyRecallSignature({
        rawBody: BODY,
        id: ID,
        timestamp: stamp,
        signature: header,
        secret: SECRET,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a body that was altered in flight', () => {
    // The whole point of signing the body rather than holding a token.
    const tampered = BODY.replace('4f0d5e2a', '00000000');

    expect(
      verifyRecallSignature({
        rawBody: tampered,
        id: ID,
        timestamp: stamp,
        signature: `v1,${sign(BODY, ID, stamp)}`,
        secret: SECRET,
        now,
      }),
    ).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a signature made with a different secret', () => {
    const other = `whsec_${Buffer.from('not-our-key').toString('base64')}`;

    expect(
      verifyRecallSignature({
        rawBody: BODY,
        id: ID,
        timestamp: stamp,
        signature: `v1,${sign(BODY, ID, stamp, other)}`,
        secret: SECRET,
        now,
      }),
    ).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a replayed delivery once it is stale', () => {
    const old = new Date(now.getTime() - MAX_TIMESTAMP_SKEW_MS - 1_000);
    const oldStamp = String(Math.floor(old.getTime() / 1000));

    expect(
      verifyRecallSignature({
        rawBody: BODY,
        id: ID,
        timestamp: oldStamp,
        signature: `v1,${sign(BODY, ID, oldStamp)}`,
        secret: SECRET,
        now,
      }),
    ).toEqual({ ok: false, reason: 'stale-timestamp' });
  });

  it('rejects a timestamp from the future as well as one from the past', () => {
    // Accepting these would let someone mint a signature now and hold it.
    const ahead = new Date(now.getTime() + MAX_TIMESTAMP_SKEW_MS + 1_000);
    const aheadStamp = String(Math.floor(ahead.getTime() / 1000));

    expect(
      verifyRecallSignature({
        rawBody: BODY,
        id: ID,
        timestamp: aheadStamp,
        signature: `v1,${sign(BODY, ID, aheadStamp)}`,
        secret: SECRET,
        now,
      }),
    ).toEqual({ ok: false, reason: 'stale-timestamp' });
  });

  it('refuses a missing timestamp instead of falling back to signing the body', () => {
    /*
     * ⚠ The important negative. Falling back to a weaker scheme when a field is
     * absent hands an attacker the weaker scheme on request — they just omit
     * the header.
     */
    expect(
      verifyRecallSignature({
        rawBody: BODY,
        id: ID,
        timestamp: null,
        signature: `v1,${sign(BODY, ID, stamp)}`,
        secret: SECRET,
        now,
      }),
    ).toEqual({ ok: false, reason: 'missing-timestamp' });
  });

  it('refuses a missing id — it is part of the signed content', () => {
    expect(
      verifyRecallSignature({
        rawBody: BODY,
        id: null,
        timestamp: stamp,
        signature: `v1,${sign(BODY, ID, stamp)}`,
        secret: SECRET,
        now,
      }),
    ).toEqual({ ok: false, reason: 'missing-id' });
  });

  it('ignores an entry with an unknown version rather than trusting it', () => {
    expect(
      verifyRecallSignature({
        rawBody: BODY,
        id: ID,
        timestamp: stamp,
        signature: `v2,${sign(BODY, ID, stamp)}`,
        secret: SECRET,
        now,
      }),
    ).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('treats a bare signature with no version prefix as a non-match', () => {
    // Guessing at what was meant is how a malformed header becomes a bypass.
    expect(
      verifyRecallSignature({
        rawBody: BODY,
        id: ID,
        timestamp: stamp,
        signature: sign(BODY, ID, stamp),
        secret: SECRET,
        now,
      }),
    ).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('is disabled, not open, when no secret is configured', () => {
    expect(
      verifyRecallSignature({
        rawBody: BODY,
        id: ID,
        timestamp: stamp,
        signature: `v1,${sign(BODY, ID, stamp)}`,
        secret: undefined,
        now,
      }),
    ).toEqual({ ok: false, reason: 'no-secret' });
  });

  it('rejects milliseconds where seconds are required', () => {
    /*
     * Svix sends unix seconds. Silently reinterpreting a millisecond value
     * would hide a caller sending the wrong thing.
     *
     * ⚠ The reason is `unreadable-timestamp`, not `stale-timestamp`, and the
     * distinction is worth keeping: a 13-digit value fails the FORMAT check
     * before any clock comparison happens. "Unreadable" points at the sender's
     * units; "stale" points at a clock. Logging the wrong one sends whoever is
     * debugging this to NTP instead of to the header.
     */
    const ms = String(now.getTime());

    expect(
      verifyRecallSignature({
        rawBody: BODY,
        id: ID,
        timestamp: ms,
        signature: `v1,${sign(BODY, ID, ms)}`,
        secret: SECRET,
        now,
      }),
    ).toEqual({ ok: false, reason: 'unreadable-timestamp' });
  });
});

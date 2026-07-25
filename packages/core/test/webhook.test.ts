import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { safeEqual, verifyHubSignature } from '../src/webhook';

const SECRET = 'test-app-secret';
const BODY = '{"object":"whatsapp_business_account","entry":[{"id":"123"}]}';

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

describe('verifyHubSignature', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyHubSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it('rejects a body that was modified after signing', () => {
    const signature = sign(BODY);
    const tampered = BODY.replace('123', '456');
    expect(verifyHubSignature(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyHubSignature(BODY, sign(BODY, 'wrong-secret'), SECRET)).toBe(false);
  });

  it('rejects a missing or malformed signature header', () => {
    expect(verifyHubSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyHubSignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifyHubSignature(BODY, '', SECRET)).toBe(false);
    expect(verifyHubSignature(BODY, 'sha256=', SECRET)).toBe(false);
    expect(verifyHubSignature(BODY, 'garbage', SECRET)).toBe(false);
  });

  it('rejects a bare hex digest with no sha256= prefix', () => {
    const bare = sign(BODY).replace('sha256=', '');
    expect(verifyHubSignature(BODY, bare, SECRET)).toBe(false);
  });

  it('rejects when the secret is empty rather than signing with nothing', () => {
    expect(verifyHubSignature(BODY, sign(BODY, ''), '')).toBe(false);
  });

  it('is sensitive to re-serialisation, which is why raw bytes are required', () => {
    // The exact failure this function exists to make loud: semantically
    // identical JSON, different bytes. Verify against
    // JSON.stringify(JSON.parse(body)) and every signature check fails, for
    // reasons that look nothing like formatting.
    //
    // Note the whitespace — this body is NOT already in canonical stringify
    // form, which is the only way the round trip can be shown to change it.
    const pretty = '{\n  "object": "whatsapp_business_account",\n  "entry": [ { "id": "123" } ]\n}';
    const signature = sign(pretty);

    // Signed as received: passes.
    expect(verifyHubSignature(pretty, signature, SECRET)).toBe(true);

    // Same data, re-serialised: fails.
    const reserialised = JSON.stringify(JSON.parse(pretty));
    expect(reserialised).not.toBe(pretty);
    expect(JSON.parse(reserialised)).toEqual(JSON.parse(pretty));
    expect(verifyHubSignature(reserialised, signature, SECRET)).toBe(false);
  });
});

describe('safeEqual', () => {
  it('matches identical strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });

  it('rejects different strings of equal length', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('rejects different lengths without throwing', () => {
    // timingSafeEqual throws on a length mismatch; this must not propagate.
    expect(() => safeEqual('short', 'much longer string')).not.toThrow();
    expect(safeEqual('short', 'much longer string')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('', 'x')).toBe(false);
  });
});

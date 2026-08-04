import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  resolveSigningScheme,
  safeEqual,
  verifyHubSignature,
  verifySignature,
  type SigningEnv,
  type SigningScheme,
} from '../src/webhook';

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

const META: SigningScheme = {
  kind: 'hmac',
  header: 'x-hub-signature-256',
  secret: SECRET,
  prefix: 'sha256=',
  label: 'meta',
};

const BSP: SigningScheme = {
  kind: 'hmac',
  header: 'x-360dialog-signature',
  secret: 'bsp-webhook-secret',
  prefix: '',
  label: '360dialog-hmac',
};

const TOKEN: SigningScheme = {
  kind: 'shared-token',
  header: 'x-switchboard-webhook-token',
  secret: 'a-256-bit-random-token-in-real-life',
  prefix: '',
  label: '360dialog-token',
};

function hmac(body: string, secret: string, enc: 'hex' | 'base64'): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest(enc);
}

describe('verifySignature', () => {
  it('behaves identically to verifyHubSignature under the Meta scheme', () => {
    // The regression that matters most: Phase 2 has been in production behind
    // verifyHubSignature, and swapping the route onto the general function must
    // not change a single verdict for Meta.
    const cases: [string, string | null][] = [
      [BODY, sign(BODY)],
      [BODY.replace('123', '456'), sign(BODY)],
      [BODY, sign(BODY, 'wrong-secret')],
      [BODY, null],
      [BODY, 'garbage'],
      [BODY, sign(BODY).replace('sha256=', '')],
    ];

    for (const [body, header] of cases) {
      expect(verifySignature(body, header, META)).toBe(verifyHubSignature(body, header, SECRET));
    }
  });

  /*
   * 360dialog forwards Meta's envelope verbatim but signs it themselves, with
   * their own header and no `sha256=` prefix. Their docs do not state whether
   * the digest is hex or base64, so both are accepted — see the note on
   * verifySignature for why that costs nothing.
   */
  it('accepts a BSP signature as bare hex', () => {
    expect(verifySignature(BODY, hmac(BODY, BSP.secret, 'hex'), BSP)).toBe(true);
  });

  it('accepts a BSP signature as bare base64', () => {
    expect(verifySignature(BODY, hmac(BODY, BSP.secret, 'base64'), BSP)).toBe(true);
  });

  it('still rejects a tampered body under either encoding', () => {
    const tampered = BODY.replace('123', '456');
    expect(verifySignature(tampered, hmac(BODY, BSP.secret, 'hex'), BSP)).toBe(false);
    expect(verifySignature(tampered, hmac(BODY, BSP.secret, 'base64'), BSP)).toBe(false);
  });

  it('still rejects the wrong secret under either encoding', () => {
    expect(verifySignature(BODY, hmac(BODY, 'not-the-secret', 'hex'), BSP)).toBe(false);
    expect(verifySignature(BODY, hmac(BODY, 'not-the-secret', 'base64'), BSP)).toBe(false);
  });

  it('does not accept a Meta-prefixed digest under the BSP scheme, or the reverse', () => {
    // A deployment configured for one provider must not silently validate the
    // other's header format — that would hide a misconfiguration until the
    // secrets happened to differ.
    expect(verifySignature(BODY, `sha256=${hmac(BODY, BSP.secret, 'hex')}`, BSP)).toBe(false);
    expect(verifySignature(BODY, hmac(BODY, SECRET, 'hex'), META)).toBe(false);
  });

  it('refuses an empty secret rather than signing with nothing', () => {
    const empty: SigningScheme = { ...BSP, secret: '' };
    expect(verifySignature(BODY, hmac(BODY, '', 'hex'), empty)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifySignature(BODY, null, BSP)).toBe(false);
    expect(verifySignature(BODY, undefined, BSP)).toBe(false);
    expect(verifySignature(BODY, '', BSP)).toBe(false);
  });
});

describe('verifySignature — shared-token scheme', () => {
  it('accepts the exact token', () => {
    expect(verifySignature(BODY, TOKEN.secret, TOKEN)).toBe(true);
  });

  it('rejects a wrong or truncated token', () => {
    expect(verifySignature(BODY, 'wrong', TOKEN)).toBe(false);
    expect(verifySignature(BODY, TOKEN.secret.slice(0, -1), TOKEN)).toBe(false);
    expect(verifySignature(BODY, `${TOKEN.secret}x`, TOKEN)).toBe(false);
  });

  it('does not care about the body, which is exactly its weakness', () => {
    // Stated as a test so the property is impossible to forget: a shared token
    // proves the caller holds the secret and NOTHING about what they sent.
    // Under HMAC these two calls disagree; under a token they cannot.
    expect(verifySignature(BODY, TOKEN.secret, TOKEN)).toBe(true);
    expect(verifySignature('{"totally":"different"}', TOKEN.secret, TOKEN)).toBe(true);
  });

  it('refuses an empty secret rather than matching an empty header', () => {
    const empty: SigningScheme = { ...TOKEN, secret: '' };
    expect(verifySignature(BODY, '', empty)).toBe(false);
    expect(verifySignature(BODY, 'anything', empty)).toBe(false);
  });

  it('does not accept an HMAC of the body in place of the token', () => {
    expect(verifySignature(BODY, hmac(BODY, TOKEN.secret, 'hex'), TOKEN)).toBe(false);
  });
});

describe('resolveSigningScheme', () => {
  it('returns null when nothing is configured, so the caller must refuse', () => {
    // ⚠ The property that keeps the route fail-closed: there is no scheme that
    // means "skip". Absence is unrepresentable as a passing verification.
    expect(resolveSigningScheme({})).toBeNull();
    expect(
      resolveSigningScheme({
        WHATSAPP_APP_SECRET: undefined,
        WHATSAPP_BSP_WEBHOOK_SECRET: undefined,
        WHATSAPP_BSP_SHARED_TOKEN: undefined,
      }),
    ).toBeNull();
    expect(resolveSigningScheme({ WHATSAPP_APP_SECRET: '' })).toBeNull();
    expect(resolveSigningScheme({ WHATSAPP_BSP_SHARED_TOKEN: '' })).toBeNull();
  });

  it('picks Meta when the app secret is set', () => {
    expect(resolveSigningScheme({ WHATSAPP_APP_SECRET: 'a' })).toMatchObject({
      header: 'x-hub-signature-256',
      prefix: 'sha256=',
      label: 'meta',
    });
  });

  it('picks the BSP HMAC scheme when only its secret is set', () => {
    expect(resolveSigningScheme({ WHATSAPP_BSP_WEBHOOK_SECRET: 'b' })).toMatchObject({
      kind: 'hmac',
      header: 'x-360dialog-signature',
      label: '360dialog-hmac',
    });
  });

  it('falls back to the shared token when it is all that is configured', () => {
    expect(resolveSigningScheme({ WHATSAPP_BSP_SHARED_TOKEN: 'c' })).toMatchObject({
      kind: 'shared-token',
      header: 'x-switchboard-webhook-token',
      label: '360dialog-token',
    });
  });

  /*
   * ⚠⚠ The property that matters most in this file.
   *
   * Adding a weaker credential must NEVER downgrade a deployment. A shared
   * token left behind after a real Meta App Secret arrives has to be inert, or
   * the strongest check silently stops being the one that runs — and nothing
   * about the system's behaviour would reveal it.
   */
  it('always picks the strongest scheme configured, never a weaker one', () => {
    const strongestFor: [SigningEnv, string][] = [
      [{ WHATSAPP_APP_SECRET: 'a', WHATSAPP_BSP_WEBHOOK_SECRET: 'b' }, 'meta'],
      [{ WHATSAPP_APP_SECRET: 'a', WHATSAPP_BSP_SHARED_TOKEN: 'c' }, 'meta'],
      [{ WHATSAPP_BSP_WEBHOOK_SECRET: 'b', WHATSAPP_BSP_SHARED_TOKEN: 'c' }, '360dialog-hmac'],
      [
        { WHATSAPP_APP_SECRET: 'a', WHATSAPP_BSP_WEBHOOK_SECRET: 'b', WHATSAPP_BSP_SHARED_TOKEN: 'c' },
        'meta',
      ],
    ];

    for (const [env, label] of strongestFor) {
      expect(resolveSigningScheme(env)?.label).toBe(label);
    }
  });

  it('only ever calls the shared token weak — every other scheme is hmac', () => {
    expect(resolveSigningScheme({ WHATSAPP_APP_SECRET: 'a' })?.kind).toBe('hmac');
    expect(resolveSigningScheme({ WHATSAPP_BSP_WEBHOOK_SECRET: 'b' })?.kind).toBe('hmac');
    expect(resolveSigningScheme({ WHATSAPP_BSP_SHARED_TOKEN: 'c' })?.kind).toBe('shared-token');
  });

  it('never returns a scheme without a secret', () => {
    for (const env of [
      {},
      { WHATSAPP_APP_SECRET: 'a' },
      { WHATSAPP_BSP_WEBHOOK_SECRET: 'b' },
      { WHATSAPP_BSP_SHARED_TOKEN: 'c' },
      { WHATSAPP_APP_SECRET: 'a', WHATSAPP_BSP_WEBHOOK_SECRET: 'b', WHATSAPP_BSP_SHARED_TOKEN: 'c' },
    ]) {
      const scheme = resolveSigningScheme(env);
      if (scheme) expect(scheme.secret.length).toBeGreaterThan(0);
    }
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

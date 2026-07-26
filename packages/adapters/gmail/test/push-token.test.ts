import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyIdToken = vi.fn();

// Stubbed so the suite runs offline and without a real Google token. What is
// under test is our decision logic around the verified payload — the signature
// check itself is the library's job and is not ours to re-implement.
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdToken;
  },
}));

const { verifyPushToken } = await import('../src/push-token');

const AUDIENCE = 'https://switchboard-console-beryl.vercel.app/api/webhooks/gmail';
const SERVICE_ACCOUNT = 'gmail-push-invoker@switchboard-503613.iam.gserviceaccount.com';

function ticket(payload: Record<string, unknown> | undefined) {
  return { getPayload: () => payload };
}

function goodPayload(overrides: Record<string, unknown> = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: AUDIENCE,
    email: SERVICE_ACCOUNT,
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  };
}

const base = { audience: AUDIENCE, serviceAccountEmail: SERVICE_ACCOUNT };

beforeEach(() => {
  verifyIdToken.mockReset();
});

describe('verifyPushToken', () => {
  it('accepts a token from the expected service account', async () => {
    verifyIdToken.mockResolvedValue(ticket(goodPayload()));

    const result = await verifyPushToken({ ...base, authorization: 'Bearer good-token' });

    expect(result.ok).toBe(true);
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'good-token',
      audience: AUDIENCE,
    });
  });

  it('REJECTS a validly-signed Google token from a different service account', async () => {
    // The attack this exists to stop: anyone can create a GCP project, mint an
    // ID token with our endpoint as the audience, and POST it here. It is
    // genuinely Google-signed and passes signature and audience checks. Only
    // the identity claim distinguishes it from a real delivery.
    verifyIdToken.mockResolvedValue(
      ticket(goodPayload({ email: 'attacker@evil-project.iam.gserviceaccount.com' })),
    );

    const result = await verifyPushToken({ ...base, authorization: 'Bearer attacker-token' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/service account/);
  });

  it('rejects an unverified service account email', async () => {
    verifyIdToken.mockResolvedValue(ticket(goodPayload({ email_verified: false })));
    const result = await verifyPushToken({ ...base, authorization: 'Bearer t' });
    expect(result.ok).toBe(false);
  });

  it('rejects an unexpected issuer', async () => {
    verifyIdToken.mockResolvedValue(ticket(goodPayload({ iss: 'https://evil.example.com' })));
    const result = await verifyPushToken({ ...base, authorization: 'Bearer t' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/issuer/);
  });

  it('rejects when the library throws (bad signature, expired, wrong audience)', async () => {
    verifyIdToken.mockRejectedValue(new Error('Invalid token signature: eyJhbGciOi...'));
    const result = await verifyPushToken({ ...base, authorization: 'Bearer t' });
    expect(result.ok).toBe(false);
    // The library's message can carry token fragments; ours must not.
    if (!result.ok) expect(result.reason).not.toContain('eyJ');
  });

  it('rejects an empty payload', async () => {
    verifyIdToken.mockResolvedValue(ticket(undefined));
    const result = await verifyPushToken({ ...base, authorization: 'Bearer t' });
    expect(result.ok).toBe(false);
  });

  it.each([
    ['missing header', null],
    ['undefined header', undefined],
    ['empty string', ''],
    ['no Bearer prefix', 'some-raw-token'],
    ['Bearer with no token', 'Bearer '],
    ['wrong scheme', 'Basic abc123'],
  ])('rejects %s without calling the verifier', async (_label, authorization) => {
    const result = await verifyPushToken({ ...base, authorization });
    expect(result.ok).toBe(false);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('accepts a case-insensitive bearer scheme', async () => {
    verifyIdToken.mockResolvedValue(ticket(goodPayload()));
    const result = await verifyPushToken({ ...base, authorization: 'bearer good-token' });
    expect(result.ok).toBe(true);
  });

  it('refuses to verify anything when misconfigured', async () => {
    // Fail closed. An unset audience must never mean "skip the check".
    for (const bad of [
      { audience: '', serviceAccountEmail: SERVICE_ACCOUNT },
      { audience: AUDIENCE, serviceAccountEmail: '' },
    ]) {
      const result = await verifyPushToken({ ...bad, authorization: 'Bearer t' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/not configured/);
    }
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});

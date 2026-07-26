import { OAuth2Client } from 'google-auth-library';

/**
 * Verify the OIDC token on a Gmail Pub/Sub push request.
 *
 * ⚠ CHECKING THE AUDIENCE ALONE IS NOT ENOUGH, and this is the trap.
 *
 * `aud` is chosen by whoever requests the token. Anyone can create their own
 * Google Cloud project, make a service account, mint an ID token with
 * `aud = https://our-console/api/webhooks/gmail`, and POST it to us. It is
 * genuinely signed by Google and it verifies perfectly.
 *
 * What makes the token *ours* is the identity inside it: the `email` claim must
 * be the service account we attached to our subscription. That is the check
 * that turns "a valid Google token" into "a request from our Pub/Sub topic".
 *
 * Verified, in order:
 *   1. Signature, against Google's published keys (fetched and cached by the
 *      library — never decode-without-verify).
 *   2. Expiry.
 *   3. `iss` is Google.
 *   4. `aud` matches the configured audience.
 *   5. `email` matches the expected service account, and `email_verified`.
 */

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

// One client instance so the JWKS cache is shared rather than refetched per
// request — a webhook that fetches Google's keys on every delivery is slow in
// exactly the path that must never be slow (ADR-011).
const client = new OAuth2Client();

export interface PushTokenClaims {
  email: string;
  audience: string;
}

export interface VerifyPushTokenOptions {
  /** `Authorization` header value, or the bare token. */
  authorization: string | null | undefined;
  /** Exactly the audience configured on the push subscription. */
  audience: string;
  /** The service account attached to the push subscription. */
  serviceAccountEmail: string;
}

export type VerifyPushTokenResult =
  | { ok: true; claims: PushTokenClaims }
  | { ok: false; reason: string };

export async function verifyPushToken({
  authorization,
  audience,
  serviceAccountEmail,
}: VerifyPushTokenOptions): Promise<VerifyPushTokenResult> {
  if (!audience || !serviceAccountEmail) {
    return { ok: false, reason: 'push verification is not configured' };
  }

  const token = extractBearer(authorization);
  if (!token) return { ok: false, reason: 'missing bearer token' };

  let payload;
  try {
    // verifyIdToken checks the signature, expiry and audience. It throws rather
    // than returning a falsy value on any failure.
    const ticket = await client.verifyIdToken({ idToken: token, audience });
    payload = ticket.getPayload();
  } catch (error) {
    // The message can contain token fragments; keep it out of logs.
    return { ok: false, reason: 'token failed verification' };
  }

  if (!payload) return { ok: false, reason: 'token had no payload' };

  if (!GOOGLE_ISSUERS.includes(payload.iss)) {
    return { ok: false, reason: 'unexpected issuer' };
  }

  // The check that actually scopes this to our subscription.
  if (payload.email !== serviceAccountEmail) {
    return { ok: false, reason: 'token identity is not the expected service account' };
  }

  if (payload.email_verified !== true) {
    return { ok: false, reason: 'service account email is not verified' };
  }

  return { ok: true, claims: { email: payload.email, audience } };
}

function extractBearer(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const trimmed = authorization.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    const token = trimmed.slice(7).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

import { OAuth2Client } from 'google-auth-library';

/**
 * Google OAuth for connecting a Gmail channel.
 *
 * One consent covers Gmail *and* Calendar (ADR-010). Asking for
 * `calendar.events` now costs nothing extra and saves a second consent screen
 * in Phase 5, when calendar write-back lands.
 */

/**
 * ⚠ `gmail.readonly` is a RESTRICTED scope and `calendar.events` is SENSITIVE.
 *
 * The consent screen must stay in **Testing** mode with allowlisted users.
 * Publishing it with a restricted scope triggers a Google CASA security
 * assessment — weeks of work and real money. Testing mode caps at ~100
 * manually-added users, which is ample for iOzera.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
] as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} — see docs/03-RESOURCES.md §6.`);
  return value;
}

export function createOAuthClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    redirectUri: required('GOOGLE_OAUTH_REDIRECT_URI'),
  });
}

export function buildConsentUrl(state: string): string {
  return createOAuthClient().generateAuthUrl({
    // `offline` is what makes Google return a refresh token at all. Without it
    // you get an access token that expires in an hour and no way to renew it,
    // and the channel silently stops working after that hour.
    access_type: 'offline',

    // ⚠ Forcing the consent prompt is NOT redundant with access_type.
    //
    // Google returns a refresh token only on the FIRST authorisation for a
    // client/user pair. Reconnect without this and the response contains an
    // access token and NO refresh_token — so a naive "reconnect to fix it"
    // overwrites a working stored credential with nothing. This is the single
    // most common way Google OAuth integrations break.
    prompt: 'consent',

    scope: [...GOOGLE_SCOPES],
    state,

    // Keep the granted set to exactly what we asked for, so the scope check on
    // the callback is meaningful.
    include_granted_scopes: false,
  });
}

export interface ExchangedTokens {
  refreshToken: string;
  accessToken: string;
  scopes: string[];
  expiryDate: number | null;
}

export type ExchangeResult =
  | { ok: true; tokens: ExchangedTokens }
  | { ok: false; reason: string };

export async function exchangeCode(code: string): Promise<ExchangeResult> {
  const client = createOAuthClient();

  let tokens;
  try {
    ({ tokens } = await client.getToken(code));
  } catch {
    // The error can echo the code and client secret. Never surface it.
    return { ok: false, reason: 'Google rejected the authorisation code.' };
  }

  if (!tokens.refresh_token) {
    // With prompt=consent this should not happen; if it does, storing the row
    // anyway would create a channel that dies in an hour and is hard to
    // diagnose. Fail now, loudly.
    return {
      ok: false,
      reason: 'Google returned no refresh token. Remove Switchboard at myaccount.google.com/permissions and try again.',
    };
  }

  const granted = (tokens.scope ?? '').split(' ').filter(Boolean);

  // ⚠ Users can UNTICK individual scopes on the consent screen. Google still
  //   returns a perfectly valid token — for a narrower grant than we need. Left
  //   unchecked, the channel is created, looks connected, and every history
  //   call fails with a 403 later.
  const missing = GOOGLE_SCOPES.filter((scope) => !granted.includes(scope));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Switchboard needs all requested permissions. Not granted: ${missing
        .map((s) => s.split('/').pop())
        .join(', ')}.`,
    };
  }

  return {
    ok: true,
    tokens: {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? '',
      scopes: granted,
      expiryDate: tokens.expiry_date ?? null,
    },
  };
}

/**
 * Which mailbox did we just connect?
 *
 * The token has no identity in it — we asked for Gmail and Calendar, not
 * `openid`/`email`. `users.getProfile` is covered by `gmail.readonly` and
 * returns the authoritative address, which also confirms the token works
 * before anything is persisted.
 */
export async function fetchMailboxAddress(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;

    const profile: unknown = await response.json();
    if (
      typeof profile === 'object' &&
      profile !== null &&
      'emailAddress' in profile &&
      typeof profile.emailAddress === 'string'
    ) {
      return profile.emailAddress;
    }
    return null;
  } catch {
    return null;
  }
}

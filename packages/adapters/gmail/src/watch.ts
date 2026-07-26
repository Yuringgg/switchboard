/**
 * Gmail `users.watch` — the registration that makes Gmail publish at all.
 *
 * Until a watch exists, the Pub/Sub topic and subscription sit there correctly
 * configured and completely silent. Nothing about the setup looks wrong.
 *
 * ⚠ A watch EXPIRES after 7 days and must be renewed. When it lapses, Gmail
 * simply stops publishing — no error, no callback, no signal anywhere except
 * messages quietly ceasing to arrive. Renewal is not optional maintenance; it
 * is what keeps the primary channel alive. See the renewal task in the worker.
 */

const WATCH_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/watch';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface WatchRegistration {
  /** Mailbox cursor at registration time. Kept as a string — see parseWatchResponse. */
  historyId: string;
  /** When Gmail stops publishing unless renewed. */
  expiresAt: Date;
}

export type WatchResult =
  | { ok: true; watch: WatchRegistration }
  | { ok: false; reason: string };

/**
 * Parse a watch response.
 *
 * Separated from the request so the parsing — where the precision trap lives —
 * is testable without a network call or a live mailbox.
 */
export function parseWatchResponse(raw: string): WatchResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'watch response was not JSON' };
  }

  if (typeof decoded !== 'object' || decoded === null) {
    return { ok: false, reason: 'watch response was not an object' };
  }

  const body = decoded as Record<string, unknown>;

  // Both fields come back as JSON numbers large enough to lose precision as
  // doubles, so they are read from the RAW TEXT rather than the parsed object.
  // historyId rounded by one lands the cursor mid-history and the symptom is
  // "some emails never arrive"; expiration rounded is harmless in practice but
  // is read the same way so the two cannot drift apart in how they are handled.
  const historyMatch = /"historyId"\s*:\s*"?(\d+)"?/.exec(raw);
  if (!historyMatch?.[1]) return { ok: false, reason: 'watch response had no historyId' };

  const expirationMatch = /"expiration"\s*:\s*"?(\d+)"?/.exec(raw);
  if (!expirationMatch?.[1]) return { ok: false, reason: 'watch response had no expiration' };

  const expirationMs = Number(expirationMatch[1]);
  if (!Number.isFinite(expirationMs) || expirationMs <= 0) {
    return { ok: false, reason: 'watch expiration was not a timestamp' };
  }

  void body;

  return {
    ok: true,
    watch: { historyId: historyMatch[1], expiresAt: new Date(expirationMs) },
  };
}

/**
 * Register (or re-register) a watch on the user's mailbox.
 *
 * Calling this again for the same mailbox is safe and is exactly how renewal
 * works — Gmail replaces the existing watch and returns a fresh expiration.
 */
export async function registerWatch(
  accessToken: string,
  topicName: string,
): Promise<WatchResult> {
  let response: Response;
  try {
    response = await fetch(WATCH_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topicName,
        // INBOX only. Watching every label republishes on drafts, sent mail and
        // label changes — a large multiple of the notifications we can use,
        // against a quota we share with everything else.
        labelIds: ['INBOX'],
        labelFilterBehavior: 'INCLUDE',
      }),
    });
  } catch {
    return { ok: false, reason: 'could not reach Gmail to register the watch' };
  }

  const text = await response.text();

  if (!response.ok) {
    // The body can echo the topic and project. Report the status and a short,
    // non-sensitive hint for the one failure that is genuinely common.
    const hint =
      response.status === 403
        ? ' — check gmail-api-push@system.gserviceaccount.com has Pub/Sub Publisher on the topic'
        : '';
    return { ok: false, reason: `Gmail refused the watch (HTTP ${response.status})${hint}` };
  }

  return parseWatchResponse(text);
}

export type AccessTokenResult =
  | { ok: true; accessToken: string; expiresInSeconds: number }
  | { ok: false; reason: string };

/**
 * Mint a fresh access token from a stored refresh token.
 *
 * Access tokens last about an hour; the refresh token is the durable
 * credential, which is why it is the only one persisted.
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<AccessTokenResult> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    });
  } catch {
    return { ok: false, reason: 'could not reach Google to refresh the token' };
  }

  if (!response.ok) {
    // 400 invalid_grant means the user revoked access or changed their
    // password. That is terminal: the channel needs reconnecting by hand, and
    // retrying forever will not fix it.
    const terminal = response.status === 400 || response.status === 401;
    return {
      ok: false,
      reason: terminal
        ? 'refresh token is no longer valid — the channel must be reconnected'
        : `token refresh failed (HTTP ${response.status})`,
    };
  }

  const body: unknown = await response.json().catch(() => null);
  if (
    typeof body !== 'object' ||
    body === null ||
    !('access_token' in body) ||
    typeof body.access_token !== 'string'
  ) {
    return { ok: false, reason: 'token refresh returned no access token' };
  }

  const expiresIn =
    'expires_in' in body && typeof body.expires_in === 'number' ? body.expires_in : 3600;

  return { ok: true, accessToken: body.access_token, expiresInSeconds: expiresIn };
}

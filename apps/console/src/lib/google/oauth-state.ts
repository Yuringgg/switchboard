import { randomBytes } from 'node:crypto';

import { safeEqual } from '@switchboard/core';

/**
 * CSRF protection for the OAuth redirect.
 *
 * Without it, an attacker can start their own Google consent, capture the
 * resulting `code`, and feed it to a signed-in victim's callback URL. The
 * victim's account then has the ATTACKER's mailbox connected to it — and every
 * message the attacker sends themselves lands in the victim's console looking
 * like their own data. The reverse is worse: a victim tricked into connecting
 * their real mailbox to a flow the attacker controls.
 *
 * Standard double-submit: a random value goes into an httpOnly cookie and into
 * the `state` parameter, and the callback requires them to match.
 */

export const OAUTH_STATE_COOKIE = 'sb_google_oauth_state';

export function createState(): string {
  return randomBytes(32).toString('base64url');
}

export const OAUTH_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  // Must be 'lax', not 'strict'. Google's callback is a cross-site top-level
  // navigation; under 'strict' the browser withholds the cookie and every
  // connection attempt fails state validation with nothing obviously wrong.
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  // Long enough to read a consent screen, short enough to limit replay.
  maxAge: 60 * 10,
} as const;

export function statesMatch(
  fromCookie: string | undefined,
  fromQuery: string | null,
): boolean {
  if (!fromCookie || !fromQuery) return false;
  return safeEqual(fromCookie, fromQuery);
}

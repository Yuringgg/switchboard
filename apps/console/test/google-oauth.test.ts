import { beforeEach, describe, expect, it } from 'vitest';

import { GOOGLE_SCOPES, buildConsentUrl } from '../src/lib/google/oauth';
import { createState, statesMatch } from '../src/lib/google/oauth-state';

const CLIENT_ID = '468794256088-test.apps.googleusercontent.com';
const REDIRECT = 'https://switchboard-console-beryl.vercel.app/api/auth/google/callback';

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = REDIRECT;
});

describe('buildConsentUrl', () => {
  function params(state = 'test-state') {
    return new URL(buildConsentUrl(state)).searchParams;
  }

  it('points at Google with our client and redirect', () => {
    const url = new URL(buildConsentUrl('s'));
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('requests offline access', () => {
    // Without this Google issues an access token only, it expires in an hour,
    // and the channel dies with no way to renew.
    expect(params().get('access_type')).toBe('offline');
  });

  it('forces the consent prompt', () => {
    // NOT redundant with access_type. Google returns a refresh token only on
    // the first authorisation for a client/user pair; on reconnect without
    // this, the response has no refresh_token at all — so "reconnect to fix
    // it" silently replaces a working credential with nothing.
    expect(params().get('prompt')).toBe('consent');
  });

  it('requests Gmail and Calendar in one consent', () => {
    // ADR-010: asking for calendar.events now avoids a second consent screen
    // in Phase 5.
    const scope = params().get('scope') ?? '';
    for (const required of GOOGLE_SCOPES) {
      expect(scope).toContain(required);
    }
  });

  it('does not silently widen the grant', () => {
    // include_granted_scopes would fold in previously-granted scopes, making
    // the callback's scope check meaningless.
    expect(params().get('include_granted_scopes')).not.toBe('true');
  });

  it('carries the CSRF state through', () => {
    expect(params('abc123').get('state')).toBe('abc123');
  });

  it('fails loudly when unconfigured rather than building a broken URL', () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(() => buildConsentUrl('s')).toThrow(/GOOGLE_CLIENT_SECRET/);
  });
});

describe('oauth state', () => {
  it('generates unpredictable, distinct states', () => {
    const states = new Set(Array.from({ length: 50 }, () => createState()));
    expect(states.size).toBe(50);
    expect(createState().length).toBeGreaterThanOrEqual(32);
  });

  it('matches a state with itself', () => {
    const state = createState();
    expect(statesMatch(state, state)).toBe(true);
  });

  it('rejects a mismatched state', () => {
    expect(statesMatch(createState(), createState())).toBe(false);
  });

  it('rejects when either side is missing', () => {
    // The failure mode this guards: treating "no cookie" as "nothing to check"
    // and letting the callback proceed, which is the CSRF hole itself.
    const state = createState();
    expect(statesMatch(undefined, state)).toBe(false);
    expect(statesMatch(state, null)).toBe(false);
    expect(statesMatch(undefined, null)).toBe(false);
    expect(statesMatch('', '')).toBe(false);
  });

  it('rejects a truncated state rather than prefix-matching', () => {
    const state = createState();
    expect(statesMatch(state, state.slice(0, -1))).toBe(false);
  });
});

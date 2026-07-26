import { encryptSecret } from '@switchboard/core';
import { NextResponse, type NextRequest } from 'next/server';

import { exchangeCode, fetchMailboxAddress } from '@/lib/google/oauth';
import { OAUTH_STATE_COOKIE, statesMatch } from '@/lib/google/oauth-state';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/** Send the user back to /channels with a message, never with a token in the URL. */
function back(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/channels';
  url.search = new URLSearchParams(params).toString();

  const response = NextResponse.redirect(url);
  // The state is single-use. Clear it whatever the outcome.
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Under `/api`, so the proxy does not gate this. Check here.
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '?next=/channels';
    return NextResponse.redirect(url);
  }

  const params = request.nextUrl.searchParams;

  // The user can decline on the consent screen. That is not an error.
  const googleError = params.get('error');
  if (googleError) {
    return back(request, {
      error:
        googleError === 'access_denied'
          ? 'Connection cancelled.'
          : 'Google could not complete the connection.',
    });
  }

  // ── CSRF ──────────────────────────────────────────────────────────────────
  // Checked BEFORE the code is exchanged. Exchanging first would let an
  // attacker's authorisation code be spent against a victim's session.
  const cookieState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!statesMatch(cookieState, params.get('state'))) {
    console.warn('[auth/google] rejected: state mismatch');
    return back(request, { error: 'That connection attempt expired. Please try again.' });
  }

  const code = params.get('code');
  if (!code) return back(request, { error: 'Google did not return an authorisation code.' });

  const exchanged = await exchangeCode(code);
  if (!exchanged.ok) return back(request, { error: exchanged.reason });

  // Confirms the token actually works before anything is persisted, and tells
  // us which mailbox this is — the token itself carries no identity.
  const mailbox = await fetchMailboxAddress(exchanged.tokens.accessToken);
  if (!mailbox) {
    return back(request, { error: 'Connected, but Gmail would not identify the mailbox.' });
  }

  // ── Store ─────────────────────────────────────────────────────────────────
  // Only the refresh token is kept. The access token expires within the hour
  // and is re-minted from the refresh token on demand, so persisting it would
  // widen the blast radius of a database leak for no benefit.
  const key = process.env.CHANNEL_CREDENTIALS_KEY;
  if (!key) {
    console.error('[auth/google] CHANNEL_CREDENTIALS_KEY is not set');
    return back(request, { error: 'Server is not configured to store credentials.' });
  }

  const encrypted = encryptSecret(
    JSON.stringify({ refresh_token: exchanged.tokens.refreshToken, scopes: exchanged.tokens.scopes }),
    key,
  );

  // PostgREST takes bytea as a Postgres hex literal.
  const credentials = `\\x${encrypted.toString('hex')}`;

  // Written through supabase-js on the user's session, so RLS applies and this
  // row cannot be created for anyone but the signed-in user — the WITH CHECK
  // clause enforces owner_id = auth.uid() regardless of what is sent.
  const { error } = await supabase.from('channels').upsert(
    {
      owner_id: user.id,
      type: 'gmail',
      display_name: mailbox,
      credentials,
      status: 'active',
      last_error: null,
    },
    // Reconnecting the same mailbox refreshes the credential rather than
    // creating a second channel that would ingest everything twice.
    { onConflict: 'owner_id,type,display_name' },
  );

  if (error) {
    console.error(`[auth/google] failed to store channel: ${error.message}`);
    return back(request, { error: 'Could not save the connection.' });
  }

  console.info(`[auth/google] connected gmail channel for user=${user.id}`);
  return back(request, { connected: mailbox });
}

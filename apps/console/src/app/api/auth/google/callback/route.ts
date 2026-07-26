import { registerWatch } from '@switchboard/adapter-gmail';
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
  const { data: channel, error } = await supabase
    .from('channels')
    .upsert(
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
    )
    .select('id')
    .single();

  if (error || !channel) {
    console.error(`[auth/google] failed to store channel: ${error?.message ?? 'no row returned'}`);
    return back(request, { error: 'Could not save the connection.' });
  }

  // ── Register the watch ────────────────────────────────────────────────────
  // Without this Gmail never publishes. The topic and subscription can be
  // perfectly configured and the mailbox stays silent, with nothing anywhere
  // indicating why — so it happens here, at connect time, rather than being
  // left as a separate step someone has to remember.
  const topic = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!topic) {
    console.error('[auth/google] GOOGLE_PUBSUB_TOPIC is not set');
    return back(request, {
      connected: mailbox,
      error: 'Connected, but no Pub/Sub topic is configured, so no mail will arrive yet.',
    });
  }

  const watch = await registerWatch(exchanged.tokens.accessToken, topic);

  if (!watch.ok) {
    // The credential is saved and valid; only the subscription failed. Say so
    // on the channel rather than discarding a working connection — reconnecting
    // retries the watch.
    console.error(`[auth/google] watch registration failed: ${watch.reason}`);
    await supabase
      .from('channels')
      .update({ status: 'error', last_error: watch.reason })
      .eq('id', channel.id);

    return back(request, {
      connected: mailbox,
      error: `Connected, but Gmail would not start sending updates: ${watch.reason}`,
    });
  }

  // sync_state is keyed by channel_id, so reconnecting moves the cursor rather
  // than accumulating stale ones.
  const { error: syncError } = await supabase.from('sync_state').upsert(
    {
      channel_id: channel.id,
      owner_id: user.id,
      cursor: watch.watch.historyId,
      expires_at: watch.watch.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'channel_id' },
  );

  if (syncError) {
    // The watch is live but we have no cursor and no expiry, so nothing could
    // renew it and history polling has no starting point. Not a usable state.
    console.error(`[auth/google] failed to store sync state: ${syncError.message}`);
    return back(request, {
      connected: mailbox,
      error: 'Connected, but the sync cursor could not be saved. Please reconnect.',
    });
  }

  console.info(
    `[auth/google] connected gmail channel=${channel.id} watch expires ${watch.watch.expiresAt.toISOString()}`,
  );
  return back(request, { connected: mailbox });
}

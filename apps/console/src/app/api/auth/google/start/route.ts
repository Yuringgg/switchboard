import { NextResponse, type NextRequest } from 'next/server';

import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_OPTIONS,
  createState,
} from '@/lib/google/oauth-state';
import { buildConsentUrl } from '@/lib/google/oauth';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Begin connecting a Gmail channel.
 *
 * ⚠ This route lives under `/api`, which `proxy.ts` treats as public so that
 * machine callers (Pub/Sub, Meta) are not redirected to a login page. It must
 * therefore check the session ITSELF — the gate will not do it here.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // A channel is owned by a user; there is nobody to own this one.
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '?next=/channels';
    return NextResponse.redirect(url);
  }

  const state = createState();

  let consentUrl: string;
  try {
    consentUrl = buildConsentUrl(state);
  } catch (error) {
    // Almost always a missing environment variable on this deployment — Vercel
    // binds env vars when a deployment is CREATED, so adding one afterwards
    // does nothing until the next build.
    //
    // An uncaught throw here is an opaque 500 with the reason only in the
    // platform logs. Name it on screen instead, and point at the endpoint that
    // reports exactly which variable is missing.
    const message = error instanceof Error ? error.message : 'Unknown configuration error';
    console.error(`[auth/google] cannot start OAuth: ${message}`);

    const url = request.nextUrl.clone();
    url.pathname = '/channels';
    url.search = new URLSearchParams({
      error: `${message} Check /api/health/config while signed in.`,
    }).toString();
    return NextResponse.redirect(url);
  }

  const response = NextResponse.redirect(consentUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, OAUTH_STATE_COOKIE_OPTIONS);
  return response;
}

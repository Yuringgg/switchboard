import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';

/**
 * Session refresh + route gate.
 *
 * This is Next 16's `proxy` convention — the old `middleware` filename still
 * works but warns on every boot.
 */

/**
 * Routes reachable without a session. Everything else requires one.
 *
 * ⚠ `/api` is here deliberately. Google's Pub/Sub push and Meta's webhooks
 * arrive with no cookie and no user — gating them on a session would redirect
 * every delivery to /login, which providers read as a failure and eventually
 * respond to by DISABLING the webhook. Those routes authenticate themselves,
 * per request, by signature or bearer token; that is the correct boundary for
 * machine callers. Anything added under /api must do its own auth.
 */
const PUBLIC_PATHS = ['/login', '/auth', '/api'];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser(), not getSession(). getSession() reads the cookie and trusts it;
  // getUser() revalidates the token with Supabase. In the code deciding whether
  // to let a request through, trusting an unverified cookie is the whole
  // vulnerability.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Come back to where they were headed once signed in.
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets. The negative lookahead is what keeps a
     * getUser() round trip off every image request.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

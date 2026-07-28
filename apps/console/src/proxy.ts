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
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/auth',
  '/api',

  /*
   * The design preview (`app/preview/page.tsx`) — DEVELOPMENT ONLY, and the
   * only entry in this list that is conditional.
   *
   * Next inlines `NODE_ENV` at build time, here as much as in the route, so a
   * production build does not contain this string at all rather than
   * evaluating a check per request. The route ALSO calls `notFound()` on the
   * same condition: two independent guards, because this is the security
   * boundary of a multi-tenant system and one `&&` is not a boundary.
   *
   * It is safe to expose because it reads nothing — every row it renders is a
   * literal in that file, and no Supabase client is constructed. If that ever
   * stops being true, this entry must go.
   */
  ...(process.env.NODE_ENV === 'development' ? ['/preview'] : []),
];

/** Signing in or up while already signed in should just go to the console. */
const AUTH_PAGES = ['/login', '/signup'];

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

  if (user && AUTH_PAGES.includes(pathname)) {
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
     *
     * ⚠ `icon` is Next's generated metadata route (`app/icon.tsx`), and it has
     * no file extension — so without an explicit exclusion it falls through to
     * the gate below and an unauthenticated request for the tab icon is
     * answered with a 307 to /login. The visible symptom is the browser
     * falling back to a blank page icon on /login and /signup, the two screens
     * where nobody is signed in yet. `apple-icon` and `opengraph-image` are
     * named here too so adding either later cannot reintroduce this.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon$|apple-icon$|opengraph-image$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

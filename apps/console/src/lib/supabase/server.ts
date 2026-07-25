import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';

/**
 * Server-side Supabase client for Server Components, Route Handlers and Server
 * Actions. Same publishable key, same RLS — the only difference is where the
 * session cookie is read from.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Harmless here: middleware
          // refreshes the session on every request, so the write this call
          // would have made has already happened there.
        }
      },
    },
  });
}

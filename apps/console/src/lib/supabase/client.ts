import { createBrowserClient } from '@supabase/ssr';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';

/**
 * Browser-side Supabase client.
 *
 * Publishable key + the user's session, so **RLS applies** and this client can
 * only ever reach rows the signed-in user owns. That is the entire security
 * model — see ADR-009. The `service_role` key must never appear on this side of
 * the app; it bypasses RLS and would silently disable every isolation policy.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}

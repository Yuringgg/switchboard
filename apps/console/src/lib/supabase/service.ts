import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * ⚠⚠ SERVICE ROLE CLIENT — BYPASSES ROW LEVEL SECURITY ⚠⚠
 *
 * Every policy in packages/db/migrations/0002_rls_policies.sql is inert for
 * this client. It reads and writes every tenant's rows.
 *
 * ── Why this exists in the console at all ────────────────────────────────────
 *
 * docs/02-ARCHITECTURE.md §6 says the service_role key "lives only in the
 * worker's server-side environment". ADR-011 puts the ingest webhooks in the
 * console. Those two cannot both hold: a Pub/Sub push arrives with no cookie
 * and no user, so an RLS-scoped client sees nothing and cannot insert the
 * raw_event the whole pipeline depends on.
 *
 * §6's intent is "never in a browser bundle", and that still holds — this is a
 * server-only module read from a non-NEXT_PUBLIC_ variable, so it is never
 * bundled into client JavaScript. But the wording needs amending, and that is
 * flagged for Yuri rather than silently redefined.
 *
 * ── The real risk, and the guard ─────────────────────────────────────────────
 *
 * The danger is not the browser. It is a future page using this client for a
 * user-facing query and silently bypassing tenant isolation for everyone.
 *
 * So its use is CONFINED TO THE WEBHOOK ROUTES, and that confinement is
 * enforced by a test (apps/console/test/service-client-boundary.test.ts) that
 * fails if anything else imports it. A rule nobody checks is a rule that lasts
 * until the first person in a hurry.
 *
 * If you need data for a signed-in user, use `./server` instead — it applies
 * RLS to their session, which is almost always what you actually want.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'Ingest cannot persist without it. Add SUPABASE_SERVICE_ROLE_KEY in ' +
        'Vercel (server-side only — never prefix it with NEXT_PUBLIC_).',
    );
  }

  return createSupabaseClient(url, serviceKey, {
    auth: {
      // No session, no refresh, nothing persisted. This client is a machine
      // caller and must never pick up a user's identity from anywhere.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

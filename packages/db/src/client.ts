import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

/**
 * The worker's database client.
 *
 * ⚠ This connects with credentials that BYPASS ROW LEVEL SECURITY. Every policy
 * in `../migrations/0002_rls_policies.sql` is inert here. That is deliberate —
 * the worker has to write rows on behalf of every tenant — but it means this
 * client is the single place in the system where a cross-tenant leak is
 * possible, and no policy will catch it.
 *
 * The rule that prevents it: **derive `ownerId` from the channel row being
 * processed, never from anything in the provider payload.**
 *
 * Never import this from `apps/console`. The console uses supabase-js with the
 * publishable key so that RLS applies to the signed-in user.
 */
/**
 * Supavisor's transaction mode (port 6543) multiplexes one server connection
 * across many clients, so a prepared statement created on one request may not
 * exist on the next — prepared statements must be off. Session mode (5432)
 * holds a dedicated connection, so they work and are worth having.
 *
 * Derived from the port rather than hardcoded: getting this wrong produces
 * intermittent "prepared statement does not exist" errors under load, which
 * look like anything but a pooling-mode mismatch.
 */
function supportsPreparedStatements(connectionString: string): boolean {
  try {
    return new URL(connectionString).port !== '6543';
  } catch {
    return false; // Unparseable: assume the safer of the two.
  }
}

export function createDbClient(connectionString: string) {
  const sql = postgres(connectionString, {
    // The worker is one long-lived process consuming a queue; it does not need
    // a wide pool, and Supabase's free tier has a modest connection ceiling.
    max: 5,
    prepare: supportsPreparedStatements(connectionString),
  });

  return { db: drizzle(sql, { schema }), sql };
}

export type Database = ReturnType<typeof createDbClient>['db'];

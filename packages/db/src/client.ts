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
export function createDbClient(connectionString: string) {
  const sql = postgres(connectionString, {
    // The worker is one long-lived process consuming a queue; it does not need
    // a wide pool, and Supabase's free tier has a modest connection ceiling.
    max: 5,
    // `prepare: false` is required when connecting through Supabase's pooler in
    // transaction mode — prepared statements are not supported there.
    prepare: false,
  });

  return { db: drizzle(sql, { schema }), sql };
}

export type Database = ReturnType<typeof createDbClient>['db'];

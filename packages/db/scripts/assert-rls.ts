/**
 * ADR-012's mitigation: assert the tenant-isolation boundary is intact.
 *
 * Migrations are hand-written SQL, and `packages/db/src/schema.ts` is a mirror
 * that can drift silently. This is the check that catches the drift that
 * matters — the kind `drizzle-kit generate` proposed on 2026-07-26, which would
 * have disabled RLS on all ten tables and dropped all ten policies.
 *
 * The point is that it runs in CI on every push. The other mitigations in
 * ADR-012 (a gitignored `out` dir, remembering to run `pull`) depend on someone
 * being careful forever, on the one file where being careless is unrecoverable.
 * This one does not.
 *
 * Run:  pnpm --filter @switchboard/db assert-rls
 * Needs DATABASE_URL.
 */
import postgres from 'postgres';

/**
 * Every table that holds tenant data. Hardcoded, not discovered: a check that
 * asks the database which tables to check would happily pass on a database
 * where a table had been dropped.
 */
const EXPECTED_TABLES = [
  'attachments',
  'channels',
  'contact_identities',
  'contacts',
  'conversations',
  'extractions',
  'message_chunks',
  'messages',
  'raw_events',
  'sync_state',
] as const;

interface Row {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policies: number;
  policies_with_using: number;
  policies_with_check: number;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'DATABASE_URL is not set.\n' +
        'This check is ADR-012’s mitigation for a silent loss of tenant\n' +
        'isolation. It fails rather than skips when it cannot run, because a\n' +
        'check that quietly does nothing is worse than no check at all.',
    );
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: new URL(url).port !== '6543' });

  try {
    const rows = await sql<Row[]>`
      select
        c.relname                                          as table_name,
        c.relrowsecurity                                   as rls_enabled,
        c.relforcerowsecurity                              as rls_forced,
        count(p.polname)::int                              as policies,
        count(p.polqual)::int                              as policies_with_using,
        count(p.polwithcheck)::int                         as policies_with_check
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
      where n.nspname = 'public'
        and c.relkind = 'r'
      group by c.relname, c.relrowsecurity, c.relforcerowsecurity
      order by c.relname
    `;

    const byName = new Map(rows.map((r) => [r.table_name, r]));
    const failures: string[] = [];

    for (const table of EXPECTED_TABLES) {
      const row = byName.get(table);

      if (!row) {
        failures.push(`${table}: TABLE IS MISSING`);
        continue;
      }

      // Without ENABLE, policies are inert and every row is world-readable to
      // any authenticated session.
      if (!row.rls_enabled) failures.push(`${table}: row level security is DISABLED`);

      // Without FORCE, policies do not apply to the table owner role — a hole
      // that only shows up under a role you didn't test with.
      if (!row.rls_forced) failures.push(`${table}: row level security is not FORCED`);

      // RLS enabled with no policy denies everything, which is safe but means
      // the console is broken. Either way it is not the intended state.
      if (row.policies < 1) failures.push(`${table}: has NO policy`);

      // A policy with no USING clause does not restrict reads.
      if (row.policies_with_using < row.policies) {
        failures.push(`${table}: a policy has no USING clause (reads unrestricted)`);
      }

      // A policy with no WITH CHECK does not restrict writes — a tenant could
      // insert rows owned by someone else.
      if (row.policies_with_check < row.policies) {
        failures.push(`${table}: a policy has no WITH CHECK clause (writes unrestricted)`);
      }
    }

    // A new tenant-data table that nobody added here would go unchecked.
    const unexpected = rows
      .map((r) => r.table_name)
      .filter((n) => !(EXPECTED_TABLES as readonly string[]).includes(n));

    if (unexpected.length > 0) {
      failures.push(
        `unrecognised table(s) in public: ${unexpected.join(', ')} — ` +
          'add them to EXPECTED_TABLES so they are checked too',
      );
    }

    if (failures.length > 0) {
      console.error('\n  TENANT ISOLATION CHECK FAILED\n');
      for (const f of failures) console.error(`  × ${f}`);
      console.error(
        '\n  This is the security boundary of a multi-tenant system (ADR-009).\n' +
          '  A failure here means one user can potentially read another’s\n' +
          '  private client communications. Do not merge past it.\n' +
          '  See packages/db/migrations/0002_rls_policies.sql\n',
      );
      process.exit(1);
    }

    console.log(
      `  All ${EXPECTED_TABLES.length} tables: RLS enabled, forced, ` +
        'and policed with USING + WITH CHECK.',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('RLS check errored:', error instanceof Error ? error.message : error);
  process.exit(1);
});

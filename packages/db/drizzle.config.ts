import { defineConfig } from 'drizzle-kit';

/**
 * ⚠⚠ DO NOT RUN `drizzle-kit generate` OR `drizzle-kit migrate` ⚠⚠
 *
 * This config exists for **introspection only** (`drizzle-kit pull`), which is
 * safe and useful as a drift check.
 *
 * ── What happened when generate was run, 2026-07-26 ──────────────────────────
 *
 * It produced a 116-line migration that would have:
 *
 *   · DISABLE ROW LEVEL SECURITY on all ten tables
 *   · DROP all ten `tenant_isolation` policies
 *   · DROP every unique constraint, including the (channel_id, external_id)
 *     idempotency guard on `messages`
 *   · DROP every check constraint and foreign key
 *
 * In other words: it would have silently dismantled the entire tenant-isolation
 * boundary — the thing ADR-009 calls "the security boundary, not defense in
 * depth" — and left the database looking fine.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * Not a drizzle-kit bug. `src/schema.ts` does not model RLS, policies, or check
 * constraints, so the differ correctly concluded the live database had drifted
 * from the schema and proposed removing everything the schema does not declare.
 *
 * The fix would be to make `src/schema.ts` model all of it: `.enableRLS()`,
 * `pgPolicy(...)`, `check(...)`, explicit constraint and index names, and an
 * `auth.users` table so the `owner_id` foreign keys can be expressed. That is
 * possible, but every expression has to match the database TEXTUALLY or the
 * differ keeps emitting diffs — and a small plausible-looking diff is more
 * dangerous than this obviously-wrong one, because someone might apply it.
 *
 * ── So, for now ─────────────────────────────────────────────────────────────
 *
 * Migrations are the hand-written SQL in `./migrations`, applied through
 * Supabase and reviewed as SQL. Drizzle is used as an ORM — typed queries and
 * inferred types — which is where its value is here and which this does not
 * affect.
 *
 * This deviates from docs/02-ARCHITECTURE.md §8 ("Migrations: Drizzle Kit").
 * Raised with Yuri rather than changed unilaterally; §8 needs an amendment
 * either way.
 *
 * ── Safe usage ──────────────────────────────────────────────────────────────
 *
 *   pnpm exec drizzle-kit pull --dialect postgresql --url "$DATABASE_URL" \
 *     --out ./.drizzle-introspect
 *
 * Then diff the introspected schema against src/schema.ts by eye. `.drizzle-*`
 * is gitignored.
 */
export default defineConfig({
  schema: './src/schema.ts',

  // Intentionally NOT './migrations'. If `out` pointed at the real migrations
  // directory, a stray `generate` would drop a destructive file straight into
  // the folder someone later runs.
  out: './.drizzle-introspect',

  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  schemaFilter: ['public'],
  verbose: true,
  strict: true,
});

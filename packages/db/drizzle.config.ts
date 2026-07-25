import { defineConfig } from 'drizzle-kit';

/**
 * ⚠ `migrations/0001` and `0002` were applied as hand-written SQL and are the
 * baseline. `src/schema.ts` mirrors them; it did not generate them.
 *
 * So the first time you run `drizzle-kit generate` against an empty journal it
 * will happily propose creating all ten tables again. Before generating
 * anything, run `drizzle-kit pull` (or introspect) so Drizzle's snapshot matches
 * what is actually deployed. From that point on, schema-first diffs are safe.
 *
 * DATABASE_URL is the direct Postgres connection string from the Supabase
 * dashboard (Settings → Database), not the project API URL and not a
 * publishable key. It contains the database password, so it belongs in
 * .env.local and nowhere else.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  // Supabase owns these; a diff must never propose touching them.
  schemaFilter: ['public'],
  verbose: true,
  strict: true,
});

/**
 * Read Supabase config once, loudly.
 *
 * A missing key here fails at startup with a name, rather than surfacing later
 * as an opaque 401 from PostgREST that looks like an auth bug.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}.\n` +
        `  · Local: copy .env.example to apps/console/.env.local and fill it in.\n` +
        `  · Vercel: add it under Project → Settings → Environment Variables,\n` +
        `    for Production, Preview AND Development, then redeploy.\n` +
        `  See docs/03-RESOURCES.md §6.`,
    );
  }
  return value;
}

/*
 * Note this throws at MODULE LOAD, which fails `next build` rather than
 * deploying an app that 500s on every request. That is the intended trade.
 *
 * The cost: Next reports it as "Failed to collect page data for /login" and
 * buries the real reason under `[cause]`. If you hit that on a first deploy,
 * the answer is almost always an unset environment variable — read the
 * `[cause]` line.
 */

export const SUPABASE_URL = required(
  'NEXT_PUBLIC_SUPABASE_URL',
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_PUBLISHABLE_KEY = required(
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

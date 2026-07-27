import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The service-role client bypasses RLS entirely, so where it may be used is a
 * security boundary — and a boundary nobody checks is a boundary that lasts
 * until the first person in a hurry.
 *
 * Only the ingest webhooks legitimately need it: a Pub/Sub push arrives with no
 * user, so there is no session for RLS to scope. Every other surface has a
 * signed-in user and must go through `lib/supabase/server`, which applies their
 * policies.
 *
 * The failure this prevents is quiet: a page that "works" while returning every
 * tenant's rows to whoever asks.
 */

const SRC = join(import.meta.dirname, '..', 'src');

/** Paths permitted to import the service client, relative to src/. */
const ALLOWED = [join('app', 'api', 'webhooks'), join('lib', 'supabase', 'service.ts')];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('service-role client boundary', () => {
  const files = walk(SRC).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

  it('finds source files to check', () => {
    // Guards against the test silently passing because the glob broke.
    expect(files.length).toBeGreaterThan(10);
  });

  it('is imported only by the ingest webhooks', () => {
    const offenders = files
      .filter((file) => {
        const rel = relative(SRC, file);
        if (ALLOWED.some((allowed) => rel === allowed || rel.startsWith(allowed + sep))) {
          return false;
        }
        return /from\s+['"][^'"]*supabase\/service['"]/.test(readFileSync(file, 'utf8'));
      })
      .map((file) => relative(SRC, file));

    expect(
      offenders,
      `These import the service-role client, which bypasses RLS:\n  ${offenders.join(
        '\n  ',
      )}\nUse lib/supabase/server (RLS applies to the signed-in user) unless this is a machine caller with no session.`,
    ).toEqual([]);
  });

  it('never exposes the service key through a NEXT_PUBLIC_ variable', () => {
    // NEXT_PUBLIC_ variables are inlined into client JavaScript at build time,
    // so this would put a key that bypasses every policy into a browser.
    const offenders = files
      .filter((file) => /NEXT_PUBLIC_[A-Z_]*SERVICE/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));

    expect(offenders).toEqual([]);
  });
});

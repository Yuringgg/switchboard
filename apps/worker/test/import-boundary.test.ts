import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The worker must never import `@switchboard/adapter-gmail` by its package
 * ROOT.
 *
 * The root re-exports the Pub/Sub OIDC verifier, which depends on
 * google-auth-library — a CommonJS package using dynamic `require`. tsup
 * bundles this worker into one ESM file, and `require('child_process')` throws
 * the moment the bundle loads. The container then crashloops with an error
 * naming a module nothing in the worker imports on purpose, which is a long
 * way from the import that caused it.
 *
 * Subpaths (`/history`, `/normalize`, `/watch`) pull in only plain `fetch`
 * code and bundle cleanly.
 *
 * This has already happened twice — once in gmail-watch.ts, then again in
 * gmail-ingest.ts written from habit. Typecheck cannot see it, tests cannot
 * see it, and it only appears when the bundle actually runs. Hence a test.
 */

const SRC = join(import.meta.dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('worker import boundary', () => {
  const files = walk(SRC).filter((f) => f.endsWith('.ts'));

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('never imports the gmail adapter by its package root', () => {
    const offenders = files
      .filter((file) =>
        // Matches the bare package name, but not `.../adapter-gmail/history`.
        /from\s+['"]@switchboard\/adapter-gmail['"]/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(SRC, file));

    expect(
      offenders,
      `These import @switchboard/adapter-gmail by its root, which bundles\n` +
        `google-auth-library into an ESM build and crashes at startup:\n  ${offenders.join(
          '\n  ',
        )}\nImport a subpath instead: /history, /normalize, /watch.`,
    ).toEqual([]);
  });
});

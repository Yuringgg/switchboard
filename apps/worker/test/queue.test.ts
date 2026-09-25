import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Database } from '@switchboard/db';
import { describe, expect, it } from 'vitest';

import { queueIsIdle, reclaimStaleEvents, STALE_CLAIM_MINUTES } from '../src/queue';

/**
 * The queue's housekeeping (`src/queue.ts`).
 *
 * ⚠ These exist because of a measured failure. On 2026-09-24 the live database
 * held 27 events stuck in 'processing' — the oldest since 4 August — and the
 * extraction catch-up, which only ran when the queue was idle and counted
 * 'processing' as busy, had been switched off by them the whole time: 183 of
 * 393 messages never extracted, nothing in any log.
 *
 * The SQL cannot be executed here — there is no Postgres in the unit suite —
 * so the behavioural half was measured against the live database when
 * migration 0018 was applied, and these pin what CAN be pinned without one:
 * what each function makes of what the database answers, and, at source level,
 * the two properties that fail silently if they drift.
 */

function stubDb(responses: unknown[][]): { db: Database } {
  let index = 0;
  const db = {
    execute: async () => {
      const next = responses[index] ?? [];
      index += 1;
      return next;
    },
  } as unknown as Database;
  return { db };
}

const source = (file: string) =>
  readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf8');

describe('reclaimStaleEvents', () => {
  it('counts what went back to the queue and what was parked', async () => {
    const { db } = stubDb([[{ status: 'pending' }, { status: 'pending' }, { status: 'failed' }]]);

    const result = await reclaimStaleEvents(db, 5);

    expect(result).toEqual({ requeued: 2, failed: 1 });
  });

  it('reports nothing when nothing was stranded — the healthy steady state', async () => {
    const { db } = stubDb([[]]);

    expect(await reclaimStaleEvents(db, 5)).toEqual({ requeued: 0, failed: 0 });
  });

  /*
   * ⚠ The attempt a dead process spent must COUNT. An event that kills the
   * worker every time it is processed would otherwise be reclaimed and re-run
   * forever — the reaper turning one poison payload into a crash loop.
   */
  it('parks an event that is out of attempts instead of re-queueing it forever', () => {
    const text = source('queue.ts');
    expect(text).toMatch(/case when attempts >= \$\{maxAttempts\} then 'failed' else 'pending' end/);
    // And never resets the counter.
    expect(text).not.toMatch(/attempts\s*=\s*0/);
  });
});

describe('queueIsIdle', () => {
  it('is idle when nothing is live', async () => {
    const { db } = stubDb([[{ pending: 0 }]]);
    expect(await queueIsIdle(db)).toBe(true);
  });

  it('is busy when anything is live', async () => {
    const { db } = stubDb([[{ pending: 1 }]]);
    expect(await queueIsIdle(db)).toBe(false);
  });

  /*
   * ⚠⚠ The bug itself, pinned at source level.
   *
   * `status in ('pending', 'processing')` is the obvious idle check, and it is
   * the one that switched the extraction catch-up off for seven weeks: a row
   * stranded in 'processing' is busy forever. The check must exclude stale
   * claims, using the SAME predicate the reaper uses — if the two ever
   * disagreed about "stale", a row the reaper ignores would hold the catch-ups
   * off again.
   */
  it('does not count a stale processing row as live work', () => {
    const text = source('queue.ts');
    expect(text).not.toMatch(/status in \('pending',\s*'processing'\)/);
    expect(text).toMatch(/status = 'processing' and not \(\$\{staleClaim\(staleMinutes\)\}\)/);
    expect(text).toMatch(/where \$\{staleClaim\(staleMinutes\)\}/);
  });

  it('no catch-up carries its own idle check any more', () => {
    for (const file of ['extract-catchup.ts', 'summary-catchup.ts', 'embed-catchup.ts']) {
      const text = source(file);
      expect(text, `${file} must use queue.ts`).toMatch(/from '\.\/queue'/);
      expect(text, `${file} must not define its own idle check`).not.toMatch(
        /function queueIsIdle/,
      );
    }
  });
});

describe('the claim records when it happened', () => {
  /*
   * Without `claimed_at` the reaper can only guess from `received_at`, which is
   * wrong for exactly the case that matters: an event received long ago and
   * claimed a second ago — a backlog after an outage — would look stale and be
   * pulled back while it was being worked on.
   */
  it('sets claimed_at in the same statement that flips the status', () => {
    const text = source('claim.ts');
    expect(text).toMatch(/set status = 'processing',[\s\S]*?claimed_at = now\(\)/);
  });

  it('falls back to received_at only for rows claimed before migration 0018', () => {
    expect(source('queue.ts')).toMatch(/coalesce\(claimed_at, received_at\)/);
  });

  it('waits far longer than any real event takes before calling one stale', () => {
    // A Gmail history replay is the slowest real event: minutes, not half an hour.
    expect(STALE_CLAIM_MINUTES).toBeGreaterThanOrEqual(15);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CompletionProvider } from '@switchboard/ai';
import type { Database } from '@switchboard/db';
import { describe, expect, it } from 'vitest';

import { catchUpExtractions } from '../src/extract-catchup';

/**
 * The extraction catch-up sweep (`src/extract-catchup.ts`).
 *
 * ⚠ These tests exist because of a measured hole, not a hypothetical one. On
 * 2026-08-03 the live database held **84 messages and 78 extraction runs**, and
 * four of the six gaps were ordinary mail from the previous 24 hours —
 * summarised, embedded, never extracted, and with nothing scheduled that would
 * ever come back for them. The sweep is the missing half; these pin the two
 * properties that make it safe to run forever.
 */

/**
 * A `db.execute` that answers from a queue, in call order.
 *
 * Deliberately order-based rather than matching on the SQL text: matching would
 * couple every test to the wording of a query, which is the thing most likely
 * to be edited for good reasons.
 */
function stubDb(responses: unknown[][]): { db: Database; calls: () => number } {
  let index = 0;
  const db = {
    execute: async () => {
      const next = responses[index] ?? [];
      index += 1;
      return next;
    },
  } as unknown as Database;
  return { db, calls: () => index };
}

function stubProvider(
  complete: CompletionProvider['complete'],
): { provider: CompletionProvider; calls: () => number } {
  let calls = 0;
  const provider = {
    model: 'llama-3.1-8b-instant',
    complete: async (...args: Parameters<CompletionProvider['complete']>) => {
      calls += 1;
      return complete(...args);
    },
  } as CompletionProvider;
  return { provider, calls: () => calls };
}

const neverCalled: CompletionProvider['complete'] = async () => {
  throw new Error('the provider must not be called');
};

/** Long enough to clear `shouldExtract`'s minimum-body rule. */
const BODY = 'Can we meet on Thursday at 3pm to go through the Phase 5 scope?';

function candidateRow(id: string) {
  return {
    id,
    owner_id: 'ec7645a6-11b8-456a-bbcc-03b94e5841db',
    subject: 'Scope',
    body_text: BODY,
    sent_at: '2026-08-03T04:00:00.000Z',
    sender_display_name: 'Maria',
    channel_type: 'gmail',
  };
}

describe('extraction catch-up sweep', () => {
  /*
   * ⚠ The property that keeps this from recreating the bug it fixes.
   *
   * The sweep and live ingest draw on ONE 6,000 tokens/minute window. A sweep
   * grinding through last week's newsletters while today's mail arrives would
   * starve the step someone is about to look at — the same starvation, with the
   * priorities inverted, which is strictly worse than the original fault.
   */
  it('does nothing at all while the queue still has work', async () => {
    const { db, calls } = stubDb([[{ pending: 3 }]]);
    const { provider, calls: providerCalls } = stubProvider(neverCalled);

    const result = await catchUpExtractions(db, provider, 5, 0);

    expect(result.deferred).toBe(true);
    expect(result.considered).toBe(0);
    expect(providerCalls()).toBe(0);
    // Exactly one query: the idle check. It must not even look for candidates.
    expect(calls()).toBe(1);
  });

  it('sweeps when the queue is empty', async () => {
    const { db } = stubDb([
      [{ pending: 0 }], // idle check
      [{ id: 'm1' }], // candidates
      [], // extractMessage: no existing run
      [candidateRow('m1')], // extractMessage: the message
    ]);
    const { provider, calls } = stubProvider(async () => ({
      ok: false as const,
      reason: 'stubbed',
      retryable: false,
    }));

    const result = await catchUpExtractions(db, provider, 5, 0);

    expect(result.deferred).toBe(false);
    expect(result.considered).toBe(1);
    expect(calls()).toBe(1);
  });

  /*
   * Stopping is safe HERE in a way it is not in `extractBatch`, and that
   * difference is the whole point of this file: no run is recorded on a
   * failure, and the next sweep is fifteen minutes away, so the message is
   * simply first in line again. Grinding on would turn one 429 into five.
   */
  it('stops on a retryable failure rather than burning the whole batch', async () => {
    const { db } = stubDb([
      [{ pending: 0 }],
      [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
      [],
      [candidateRow('m1')],
      // If it wrongly continued, these would serve m2 and it would call again.
      [],
      [candidateRow('m2')],
    ]);
    const { provider, calls } = stubProvider(async () => ({
      ok: false as const,
      reason: 'groq rate limit (per-minute window)',
      retryable: true,
    }));

    const result = await catchUpExtractions(db, provider, 5, 0);

    expect(result.considered).toBe(3);
    expect(result.failed).toBe(1);
    expect(calls()).toBe(1);
  });

  it('keeps going past a NON-retryable failure', async () => {
    const { db } = stubDb([
      [{ pending: 0 }],
      [{ id: 'm1' }, { id: 'm2' }],
      [],
      [candidateRow('m1')],
      [],
      [candidateRow('m2')],
    ]);
    const { provider, calls } = stubProvider(async () => ({
      ok: false as const,
      // A malformed answer reproduces at temperature 0, so it is not worth
      // retrying — but it says nothing about the NEXT message.
      reason: 'answered in prose',
      retryable: false,
    }));

    const result = await catchUpExtractions(db, provider, 5, 0);

    expect(result.failed).toBe(2);
    expect(calls()).toBe(2);
  });

  it('skips a message that has already been through the pass', async () => {
    const { db } = stubDb([
      [{ pending: 0 }],
      [{ id: 'm1' }],
      [{ message_id: 'm1' }], // a run already exists
    ]);
    const { provider, calls } = stubProvider(neverCalled);

    const result = await catchUpExtractions(db, provider, 5, 0);

    expect(result.skipped).toBe(1);
    expect(calls()).toBe(0);
  });

  /*
   * ⚠ A source-level assertion, in the style of `import-boundary.test.ts`,
   * because this one cannot fail in a unit test — it fails against Postgres,
   * silently, forever.
   *
   * `btrim(x)` with one argument trims SPACES ONLY. `shouldExtract` uses
   * JavaScript's `.trim()`, which also strips \t, \r and \n. Mismatched, a body
   * that is nothing but `\r\n` is SELECTED by this query and then SKIPPED by
   * the decision — so it is never recorded as a run, and every sweep from then
   * until forever picks up the same message, calls nothing, and reports work it
   * did not do. This corpus contains exactly such a message, which is how the
   * backfill found it first.
   */
  it('trims newlines and tabs in the candidate query, not just spaces', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'extract-catchup.ts'),
      'utf8',
    );

    const bare = /btrim\(\s*m\.body_text\s*\)/.test(source);
    const full = /btrim\(\s*m\.body_text\s*,\s*E'[^']*\\t[^']*\\r[^']*\\n[^']*'\s*\)/.test(
      source,
    );

    expect(
      bare,
      "btrim(m.body_text) trims SPACES ONLY. shouldExtract uses JS .trim(), " +
        'which also strips \\t\\r\\n — so a \\r\\n-only body would be selected ' +
        "here and skipped there, and re-selected on every sweep forever.",
    ).toBe(false);

    expect(
      full,
      "The candidate query must trim with an explicit character set, e.g.\n" +
        "  btrim(m.body_text, E' \\t\\r\\n')\n" +
        'so that it agrees with shouldExtract about what "empty" means.',
    ).toBe(true);
  });
});

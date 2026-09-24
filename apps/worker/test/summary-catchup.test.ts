import { SUMMARY_COMPLETION_OPTIONS, type CompletionOptions, type CompletionProvider } from '@switchboard/ai';
import type { Database } from '@switchboard/db';
import { describe, expect, it } from 'vitest';

import { catchUpSummaries } from '../src/summary-catchup';
import { summariseMessage } from '../src/summarize';

/**
 * The summary catch-up (`src/summary-catchup.ts`) and the options every
 * summary request carries.
 *
 * ⚠ Measured on 2026-09-24: no summary written since 2026-08-14, and 153
 * eligible messages with none. Two faults stacked — the gpt-oss model asked
 * with no room to answer, and no sweep to come back once that was fixed. One
 * test file for both, because either one alone leaves the backlog where it is.
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
  answer: Awaited<ReturnType<CompletionProvider['complete']>>,
): { provider: CompletionProvider; calls: () => number; options: () => CompletionOptions[] } {
  let calls = 0;
  const seen: CompletionOptions[] = [];
  const provider = {
    model: 'openai/gpt-oss-20b',
    complete: async (_system: string, _user: string, options?: CompletionOptions) => {
      calls += 1;
      seen.push(options ?? {});
      return answer;
    },
  } as CompletionProvider;
  return { provider, calls: () => calls, options: () => seen };
}

/** Over `SUMMARY_MIN_BODY` (280), so `shouldSummarise` says yes. */
const BODY =
  'Hi Yuri, following up on the landing page copy. Two changes before Thursday: ' +
  'cut the hero line to under ten words, and move the disclaimer above the fold. ' +
  'I can do 3pm Thursday to go through both, or Friday morning if that is easier. ' +
  'Also, the invoice for the July retainer still needs a PO number from accounting.';

function messageRow(id: string) {
  return {
    id,
    owner_id: 'ec7645a6-11b8-456a-bbcc-03b94e5841db',
    subject: 'Landing page copy',
    body_text: BODY,
    sender_display_name: 'Maria Santos',
    channel_type: 'gmail',
  };
}

const WRITTEN = { ok: true as const, text: 'Maria wants two landing page changes before Thursday.', model: 'openai/gpt-oss-20b' };
const EMPTY = { ok: false as const, reason: 'groq returned an empty completion', retryable: true };
const PROSE = { ok: false as const, reason: 'stubbed non-retryable', retryable: false };

describe('summary requests on a reasoning model', () => {
  /*
   * ⚠⚠ The fault that stopped every summary. `provider.complete(system, prompt)`
   * with no options means 160 tokens and default reasoning, and on gpt-oss the
   * thinking alone overruns 160 — the answer comes back empty.
   */
  it('sends SUMMARY_COMPLETION_OPTIONS, never the provider defaults', async () => {
    const { db } = stubDb([[], [messageRow('m1')], []]);
    const { provider, options } = stubProvider(WRITTEN);

    const outcome = await summariseMessage(db, provider, 'm1');

    expect(outcome.status).toBe('written');
    expect(options()[0]).toEqual(SUMMARY_COMPLETION_OPTIONS);
  });

  it('limits the thinking and leaves room for the answer', () => {
    expect(SUMMARY_COMPLETION_OPTIONS.reasoningEffort).toBe('low');
    // 160 was the default that failed. Anything at or under it fails the same way.
    expect(SUMMARY_COMPLETION_OPTIONS.maxTokens).toBeGreaterThan(160);
  });
});

describe('summary catch-up sweep', () => {
  it('does nothing at all while the queue has live work', async () => {
    const { db, calls } = stubDb([[{ pending: 2 }]]);
    const { provider, calls: providerCalls } = stubProvider(WRITTEN);

    const result = await catchUpSummaries(db, provider, 5, 0);

    expect(result.deferred).toBe(true);
    expect(providerCalls()).toBe(0);
    // Only the idle check ran — it did not even look for candidates.
    expect(calls()).toBe(1);
  });

  it('writes the backlog when the queue is idle', async () => {
    const { db } = stubDb([
      [{ pending: 0 }], // idle check
      [{ id: 'm1' }, { id: 'm2' }], // candidates
      [], [messageRow('m1')], [], // m1: no summary yet, the message, the insert
      [], [messageRow('m2')], [], // m2
    ]);
    const { provider, calls } = stubProvider(WRITTEN);

    const result = await catchUpSummaries(db, provider, 5, 0);

    expect(result).toMatchObject({ considered: 2, written: 2, failed: 0, deferred: false });
    expect(calls()).toBe(2);
  });

  /*
   * A retryable failure — a 429, or the empty completion this whole file exists
   * because of — hits the next message identically. Stopping is free: nothing
   * was recorded, so the next sweep starts with the same message.
   */
  it('stops on a retryable failure rather than burning the batch', async () => {
    const { db } = stubDb([
      [{ pending: 0 }],
      [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
      [], [messageRow('m1')],
      [], [messageRow('m2')],
    ]);
    const { provider, calls } = stubProvider(EMPTY);

    const result = await catchUpSummaries(db, provider, 5, 0);

    expect(result.failed).toBe(1);
    expect(calls()).toBe(1);
  });

  /*
   * ⚠ Without the give-up set, a message the model cannot summarise heads the
   * list on every sweep — nothing is recorded for a failure — and five of them
   * would stop the sweep ever reaching anything older.
   */
  it('gives up on a message that fails non-retryably, and does not select it again', async () => {
    const giveUp = new Set<string>();

    const first = stubDb([
      [{ pending: 0 }],
      [{ id: 'bad' }],
      [], [messageRow('bad')],
    ]);
    await catchUpSummaries(first.db, stubProvider(PROSE).provider, 5, 0, giveUp);
    expect(giveUp.has('bad')).toBe(true);

    // Next sweep: the database still returns it first, and it is skipped.
    const second = stubDb([
      [{ pending: 0 }],
      [{ id: 'bad' }, { id: 'good' }],
      [], [messageRow('good')], [],
    ]);
    const { provider, calls } = stubProvider(WRITTEN);
    const result = await catchUpSummaries(second.db, provider, 1, 0, giveUp);

    expect(result).toMatchObject({ considered: 1, written: 1 });
    expect(calls()).toBe(1);
  });
});

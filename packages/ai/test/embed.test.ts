import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `embedPassages` must never hand the model more than `EMBED_BATCH_SIZE` texts
 * in one call.
 *
 * It used to hand it every chunk of a message at once, and a 22k-character
 * newsletter (26 chunks) took the worker past its 1 GiB limit — OOM-killed
 * every ~16 minutes from 2026-09-25 until this was fixed. Nothing about that
 * failure is visible in a unit test's own memory, so this pins the thing that
 * caused it: the size of each call.
 *
 * The real model is never loaded. `@huggingface/transformers` is replaced with
 * a pipeline that records what it was given and returns a vector per text whose
 * first value identifies the text, so order can be checked too.
 */

const calls: string[][] = [];

vi.mock('@huggingface/transformers', () => ({
  env: {},
  pipeline: async () => async (texts: string[]) => {
    calls.push(texts);
    return {
      tolist: () => texts.map((text) => [Number(text.replace(/\D/g, '')), ...Array(383).fill(0)]),
    };
  },
}));

const { EMBED_BATCH_SIZE, embedPassages, embedQuery } = await import('../src/embed');

beforeEach(() => {
  calls.length = 0;
});

describe('embedPassages', () => {
  it('never sends the model more than EMBED_BATCH_SIZE texts in one call', async () => {
    const texts = Array.from({ length: 26 }, (_, i) => `chunk ${i}`);

    await embedPassages(texts);

    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) expect(call.length).toBeLessThanOrEqual(EMBED_BATCH_SIZE);
  });

  it('is one text per call — the measured size, not a guess', () => {
    // Raising this is a memory decision. Re-measure first; see embed.ts.
    expect(EMBED_BATCH_SIZE).toBe(1);
  });

  it('returns one vector per text, in the order given', async () => {
    const texts = Array.from({ length: 7 }, (_, i) => `chunk ${i}`);

    const vectors = await embedPassages(texts);

    expect(vectors).toHaveLength(7);
    expect(vectors.map((v) => v[0])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('still applies the passage prefix to every text', async () => {
    await embedPassages(['a', 'b', 'c']);

    expect(calls.flat()).toEqual(['passage: a', 'passage: b', 'passage: c']);
  });

  it('makes no call at all for an empty list', async () => {
    expect(await embedPassages([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('embedQuery', () => {
  it('is unchanged: one text, the query prefix, one vector', async () => {
    const vector = await embedQuery('question 42');

    expect(calls).toEqual([['query: question 42']]);
    expect(vector).toHaveLength(384);
  });
});

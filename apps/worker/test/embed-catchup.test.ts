import type { Database } from '@switchboard/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The embedding catch-up (`src/embed-catchup.ts`).
 *
 * Measured on 2026-09-24: 36 messages with a body and no chunks — findable by
 * keyword, invisible to the assistant, and nothing anywhere to say so.
 *
 * The model itself is mocked: loading 129 MB of ONNX weights is not a unit
 * test, and what is under test here is which messages get sent to it.
 */

const state = vi.hoisted(() => ({
  loaded: true,
  outcomes: new Map<string, { status: string; chunks?: number; reason?: string }>(),
  embedded: [] as string[],
}));

vi.mock('@switchboard/ai', () => ({
  isEmbedderLoaded: () => state.loaded,
}));

vi.mock('../src/embed-messages', () => ({
  embedMessage: async (_db: Database, id: string) => {
    state.embedded.push(id);
    return state.outcomes.get(id) ?? { status: 'embedded', chunks: 2 };
  },
}));

const { catchUpEmbeddings } = await import('../src/embed-catchup');

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

beforeEach(() => {
  state.loaded = true;
  state.outcomes.clear();
  state.embedded = [];
});

describe('embedding catch-up sweep', () => {
  it('does nothing, and asks nothing, when the model never loaded', async () => {
    state.loaded = false;
    const { db, calls } = stubDb([]);

    const result = await catchUpEmbeddings(db, 20);

    expect(result.considered).toBe(0);
    expect(result.deferred).toBe(false);
    expect(calls()).toBe(0);
  });

  it('waits while the queue has live work', async () => {
    const { db, calls } = stubDb([[{ pending: 1 }]]);

    const result = await catchUpEmbeddings(db, 20);

    expect(result.deferred).toBe(true);
    expect(calls()).toBe(1);
    expect(state.embedded).toEqual([]);
  });

  it('embeds the backlog when idle', async () => {
    const { db } = stubDb([[{ pending: 0 }], [{ id: 'm1' }, { id: 'm2' }]]);

    const result = await catchUpEmbeddings(db, 20);

    expect(result).toMatchObject({ considered: 2, embedded: 2, chunks: 4 });
    expect(state.embedded).toEqual(['m1', 'm2']);
  });

  /*
   * A body that chunks to nothing is skipped and writes no chunk — so without
   * the give-up set it is selected again on every sweep, forever.
   */
  it('does not select a skipped message again on the next sweep', async () => {
    const giveUp = new Set<string>();
    state.outcomes.set('empty', { status: 'skipped', reason: 'no text to embed' });

    await catchUpEmbeddings(stubDb([[{ pending: 0 }], [{ id: 'empty' }]]).db, 20, giveUp);
    expect(giveUp.has('empty')).toBe(true);

    state.embedded = [];
    await catchUpEmbeddings(
      stubDb([[{ pending: 0 }], [{ id: 'empty' }, { id: 'm3' }]]).db,
      20,
      giveUp,
    );
    expect(state.embedded).toEqual(['m3']);
  });
});

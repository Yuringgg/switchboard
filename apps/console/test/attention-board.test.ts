import { describe, expect, it } from 'vitest';

// Relative, not the `@/` alias: the root vitest config has no path mapping, so
// an aliased import here fails to resolve while typechecking perfectly. Every
// other test in this directory does the same.
import {
  ATTENTION_STATUSES,
  groupForBoard,
  isAttentionStatus,
  neighbourStatus,
  type AttentionItem,
} from '../src/lib/attention';

/**
 * The board's grouping and its move rules (Ms. Maria, 2026-08-05).
 *
 * ⚠ The two things tested here are the two that fail *quietly*. A card that
 * lands in no column simply is not drawn — a real commitment disappears with
 * nothing logged — and a Done column sorted by the wrong key looks perfectly
 * plausible until somebody notices last week's work above this morning's.
 */

const NOW = new Date('2026-08-06T12:00:00+08:00');

const base = {
  quote: 'a sentence from the message',
  location: null,
  participants: [],
  model: 'llama-3.1-8b-instant',
  calendarEventId: null,
  confirmedAt: null,
  startsAt: null,
  dueAt: null,
  confidence: null,
  statusChangedAt: null,
};

function item(id: string, overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id,
    kind: 'action_item',
    status: 'not_started',
    title: id,
    ...base,
    ...overrides,
    message: {
      id: `m-${id}`,
      subject: null,
      sentAt: '2026-08-01T09:00:00+08:00',
      channelId: 'ch',
      senderName: null,
      senderRef: null,
    },
  };
}

describe('groupForBoard', () => {
  it('returns all three columns even when every card is in one', () => {
    const columns = groupForBoard([item('a'), item('b')], NOW);

    expect(columns.map((c) => c.status)).toEqual([...ATTENTION_STATUSES]);
    expect(columns.map((c) => c.items.length)).toEqual([2, 0, 0]);
  });

  it('puts every card in exactly one column and loses none', () => {
    const items = [
      item('a', { status: 'not_started' }),
      item('b', { status: 'in_progress' }),
      item('c', { status: 'done', statusChangedAt: '2026-08-06T09:00:00+08:00' }),
      item('d', { status: 'in_progress' }),
    ];

    const columns = groupForBoard(items, NOW);
    const placed = columns.flatMap((c) => c.items.map((i) => i.id));

    expect(placed.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('orders the outstanding columns by when the thing happens, overdue first', () => {
    // The whole product decision of this screen, unchanged by the board: a
    // meeting starting in an hour must not sit under one that already passed.
    const columns = groupForBoard(
      [
        item('upcoming', { status: 'not_started', startsAt: '2026-08-06T15:00:00+08:00' }),
        item('missed', { status: 'not_started', dueAt: '2026-08-05T15:00:00+08:00' }),
        item('undated', { status: 'not_started' }),
      ],
      NOW,
    );

    expect(columns[0]!.items.map((i) => i.id)).toEqual(['missed', 'upcoming', 'undated']);
  });

  it('orders Done by when it was cleared, newest first — NOT by deadline', () => {
    /*
     * ⚠ The regression this exists to catch. Everything finished is eventually
     * "overdue", so reusing `sortForAttention` here fills the Done column with
     * a stack of missed deadlines ordered by how badly they were missed — for
     * work that was actually completed. `status_changed_at` is the only field
     * that answers "what did I just clear", and it is why migration 0012 added
     * it.
     */
    const columns = groupForBoard(
      [
        item('cleared-first', {
          status: 'done',
          dueAt: '2026-07-01T09:00:00+08:00', // long overdue
          statusChangedAt: '2026-08-06T11:00:00+08:00', // cleared an hour ago
        }),
        item('cleared-just-now', {
          status: 'done',
          dueAt: '2026-08-06T09:00:00+08:00', // barely overdue
          statusChangedAt: '2026-08-06T11:59:00+08:00', // cleared a minute ago
        }),
      ],
      NOW,
    );

    expect(columns[2]!.items.map((i) => i.id)).toEqual([
      'cleared-just-now',
      'cleared-first',
    ]);
  });

  it('sorts a Done card with no recorded move last, never first', () => {
    // Should not be reachable — nothing arrives in Done without being moved —
    // but an unknown completion time is not evidence of a recent one.
    const columns = groupForBoard(
      [
        item('never-moved', { status: 'done', statusChangedAt: null }),
        item('moved', { status: 'done', statusChangedAt: '2026-08-06T10:00:00+08:00' }),
      ],
      NOW,
    );

    expect(columns[2]!.items.map((i) => i.id)).toEqual(['moved', 'never-moved']);
  });
});

describe('neighbourStatus', () => {
  it('walks one column at a time and stops at both ends', () => {
    expect(neighbourStatus('not_started', -1)).toBeNull();
    expect(neighbourStatus('not_started', 1)).toBe('in_progress');
    expect(neighbourStatus('in_progress', -1)).toBe('not_started');
    expect(neighbourStatus('in_progress', 1)).toBe('done');
    expect(neighbourStatus('done', 1)).toBeNull();
    expect(neighbourStatus('done', -1)).toBe('in_progress');
  });
});

describe('isAttentionStatus', () => {
  it('accepts the three columns and nothing else', () => {
    for (const status of ATTENTION_STATUSES) {
      expect(isAttentionStatus(status)).toBe(true);
    }
  });

  it('rejects anything a form could put on the wire', () => {
    // The values checked before an UPDATE reaches the database. Migration
    // 0012's CHECK is the real boundary; this is what stops a Postgres error
    // string reaching a person's screen.
    for (const bad of ['', 'DONE', 'archived', 'summary', null, undefined, 3, {}]) {
      expect(isAttentionStatus(bad)).toBe(false);
    }
  });
});

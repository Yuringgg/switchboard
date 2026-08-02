import { describe, expect, it } from 'vitest';

// Relative, not the `@/` alias: the root vitest config has no path mapping, so
// an aliased import here fails to resolve while typechecking perfectly. Every
// other test in this directory does the same.
import { itemWhen, sortForAttention, type AttentionItem } from '../src/lib/attention';

/**
 * The queue's ordering, tested as a pure function.
 *
 * ⚠ This is the whole product decision of the "needs attention" screen. A queue
 * ordered by when the *message arrived* buries a meeting starting in an hour
 * under six newsletters that arrived since — which is precisely the failure
 * ADR-017 measured for the assistant, arriving through the UI instead of the
 * model. Sorting is not presentation here; it is the feature.
 */

const base = {
  quote: 'a sentence from the message',
  location: null,
  participants: [],
  model: 'llama-3.1-8b-instant',
  calendarEventId: null,
  confirmedAt: null,
};

const NOW = new Date('2026-08-03T12:00:00+08:00');

function item(
  id: string,
  overrides: Partial<AttentionItem> & { sentAt?: string } = {},
): AttentionItem {
  const { sentAt, ...rest } = overrides;
  return {
    id,
    kind: 'action_item',
    title: id,
    startsAt: null,
    dueAt: null,
    confidence: null,
    ...base,
    ...rest,
    message: {
      id: `m-${id}`,
      subject: null,
      sentAt: sentAt ?? '2026-08-01T09:00:00+08:00',
      channelId: 'ch',
      senderName: null,
      senderRef: null,
    },
  };
}

describe('itemWhen', () => {
  it('reads a meeting from its start and a task from its due date', () => {
    expect(itemWhen(item('a', { kind: 'meeting', startsAt: '2026-08-05T09:00:00+08:00' })))
      .toBe('2026-08-05T09:00:00+08:00');
    expect(itemWhen(item('b', { dueAt: '2026-08-05T09:00:00+08:00' })))
      .toBe('2026-08-05T09:00:00+08:00');
  });

  it('is null when the message named no time — the common case', () => {
    expect(itemWhen(item('c'))).toBeNull();
  });

  it('prefers a start over a due date when a row somehow has both', () => {
    const both = item('d', {
      kind: 'meeting',
      startsAt: '2026-08-04T09:00:00+08:00',
      dueAt: '2026-08-09T09:00:00+08:00',
    });
    expect(itemWhen(both)).toBe('2026-08-04T09:00:00+08:00');
  });
});

describe('sortForAttention', () => {
  it('puts what has already passed above what has not', () => {
    // The ones with a real cost. Below tomorrow's lunch, they are invisible.
    const upcoming = item('upcoming', { startsAt: '2026-08-04T09:00:00+08:00' });
    const passed = item('passed', { startsAt: '2026-08-02T09:00:00+08:00' });

    expect(sortForAttention([upcoming, passed], NOW).map((i) => i.id)).toEqual([
      'passed',
      'upcoming',
    ]);
  });

  it('orders overdue items soonest-missed first', () => {
    const older = item('older', { dueAt: '2026-07-28T09:00:00+08:00' });
    const recent = item('recent', { dueAt: '2026-08-02T09:00:00+08:00' });

    expect(sortForAttention([recent, older], NOW).map((i) => i.id)).toEqual([
      'older',
      'recent',
    ]);
  });

  it('orders upcoming items soonest first', () => {
    const soon = item('soon', { startsAt: '2026-08-03T15:00:00+08:00' });
    const later = item('later', { startsAt: '2026-08-09T15:00:00+08:00' });

    expect(sortForAttention([later, soon], NOW).map((i) => i.id)).toEqual([
      'soon',
      'later',
    ]);
  });

  it('puts undated items last, however recent their message', () => {
    // An action item with no deadline is real work, but a meeting that starts
    // today outranks it — otherwise "needs attention" is just an inbox again.
    const undatedButNew = item('undated', { sentAt: '2026-08-03T11:00:00+08:00' });
    const datedButOld = item('dated', {
      startsAt: '2026-08-06T09:00:00+08:00',
      sentAt: '2026-07-20T09:00:00+08:00',
    });

    expect(sortForAttention([undatedButNew, datedButOld], NOW).map((i) => i.id)).toEqual([
      'dated',
      'undated',
    ]);
  });

  it('falls back to the newest message among undated items', () => {
    const old = item('old', { sentAt: '2026-07-25T09:00:00+08:00' });
    const fresh = item('fresh', { sentAt: '2026-08-02T09:00:00+08:00' });

    expect(sortForAttention([old, fresh], NOW).map((i) => i.id)).toEqual(['fresh', 'old']);
  });

  it('uses confidence only as a last tiebreak, never as a rank', () => {
    /*
     * ⚠ Confidence is the model's self-report, not a calibrated probability.
     * Ranking by it would put a confidently-extracted newsletter above a hedged
     * real meeting; filtering by it would be ADR-016's mistake in a new
     * costume — a threshold on a number that does not separate the classes.
     */
    const sent = '2026-08-01T09:00:00+08:00';
    const hedged = item('hedged', { startsAt: '2026-08-04T09:00:00+08:00', confidence: 0.4, sentAt: sent });
    const certain = item('certain', { startsAt: '2026-08-06T09:00:00+08:00', confidence: 1, sentAt: sent });

    // Time wins: the hedged one is sooner.
    expect(sortForAttention([certain, hedged], NOW).map((i) => i.id)).toEqual([
      'hedged',
      'certain',
    ]);

    // With everything else equal, confidence finally breaks the tie.
    const a = item('a', { confidence: 0.2, sentAt: sent });
    const b = item('b', { confidence: 0.9, sentAt: sent });
    expect(sortForAttention([a, b], NOW).map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the array it was given', () => {
    // The page renders from the same list it counts overdue items from.
    const items = [item('z', { startsAt: '2026-08-09T09:00:00+08:00' }), item('a')];
    const before = items.map((i) => i.id);
    sortForAttention(items, NOW);
    expect(items.map((i) => i.id)).toEqual(before);
  });

  it('is stable at the exact boundary instant', () => {
    // An item starting exactly now is upcoming, not passed. Off-by-one here
    // flips a row between two groups on a page refresh.
    const exactly = item('exactly', { startsAt: NOW.toISOString() });
    const passed = item('passed', { startsAt: '2026-08-03T11:59:00+08:00' });

    expect(sortForAttention([exactly, passed], NOW).map((i) => i.id)).toEqual([
      'passed',
      'exactly',
    ]);
  });
});

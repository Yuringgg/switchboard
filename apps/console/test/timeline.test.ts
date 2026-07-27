import { describe, expect, it } from 'vitest';

import { groupByDay, preview, type TimelineMessage } from '../src/lib/timeline';

function message(overrides: Partial<TimelineMessage> = {}): TimelineMessage {
  return {
    id: 'm1',
    direction: 'inbound',
    subject: 'Subject',
    body_text: 'Body',
    sent_at: '2026-07-27T02:00:00.000Z',
    channel_id: 'c1',
    sender: { external_id: 'a@b.com', display_name: 'A B' },
    ...overrides,
  };
}

describe('groupByDay', () => {
  it('groups by the Manila date, not the UTC date', () => {
    // 2026-07-27T17:00Z is 2026-07-28 01:00 in Manila. Grouping on UTC puts it
    // under the wrong day — and PH is UTC+8, so that is every message sent
    // after 4pm local, i.e. a third of each day disagreeing with the wall clock.
    const days = groupByDay([message({ sent_at: '2026-07-27T17:00:00.000Z' })]);
    expect(days[0]?.date).toBe('2026-07-28');
  });

  it('keeps messages from one local day together across the UTC boundary', () => {
    const days = groupByDay([
      message({ id: 'a', sent_at: '2026-07-27T15:00:00.000Z' }), // 23:00 Manila
      message({ id: 'b', sent_at: '2026-07-27T16:30:00.000Z' }), // 00:30 next day
    ]);
    expect(days).toHaveLength(2);
    expect(days.map((d) => d.date)).toEqual(['2026-07-27', '2026-07-28']);
  });

  it('preserves the order it was given', () => {
    // The query sorts by sent_at desc; grouping must not reshuffle.
    const days = groupByDay([
      message({ id: 'a', sent_at: '2026-07-27T02:00:00.000Z' }),
      message({ id: 'b', sent_at: '2026-07-27T01:00:00.000Z' }),
    ]);
    expect(days[0]?.messages.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('returns nothing for no messages', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('preview', () => {
  it('takes the first non-empty line', () => {
    expect(preview('\n\n  \nActual first line\nSecond')).toBe('Actual first line');
  });

  it('truncates with an ellipsis', () => {
    expect(preview('x'.repeat(200), 20)).toHaveLength(20);
    expect(preview('x'.repeat(200), 20).endsWith('…')).toBe(true);
  });

  it('handles an empty body without throwing', () => {
    // body_text is NOT NULL but can legitimately be a whitespace-only body.
    expect(preview('')).toBe('');
    expect(preview('   \n  ')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';

import {
  BODY_LIMIT,
  bodyForDisplay,
  channelChangePoints,
  formatAge,
  groupByDay,
  newMessagesLabel,
  preview,
  type TimelineMessage,
} from '../src/lib/timeline';

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

describe('newMessagesLabel', () => {
  it('is singular for one', () => {
    expect(newMessagesLabel(1)).toBe('1 new message');
  });

  it('is plural for more than one', () => {
    expect(newMessagesLabel(2)).toBe('2 new messages');
    expect(newMessagesLabel(14)).toBe('14 new messages');
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

/**
 * The device that stops channel identity resting on colour alone. Gmail red
 * against WhatsApp green is unreadable for red/green colour blindness, and
 * "which line did this come in on" is the question this console exists to
 * answer — so these are accessibility tests, not formatting ones.
 */
describe('channelChangePoints', () => {
  const types = new Map([
    ['c-gmail', 'gmail'],
    ['c-whatsapp', 'whatsapp'],
  ]);

  const run = (channelIds: string[]) =>
    channelChangePoints(
      channelIds.map((channel_id, i) => message({ id: `m${i}`, channel_id })),
      types,
    );

  it('always marks the first message', () => {
    // Otherwise a single-channel timeline never names its channel at all.
    expect([...run(['c-gmail'])]).toEqual(['m0']);
  });

  it('marks only where the line actually switches', () => {
    const marked = run([
      'c-gmail',
      'c-gmail',
      'c-whatsapp',
      'c-whatsapp',
      'c-whatsapp',
      'c-gmail',
    ]);
    expect([...marked].sort()).toEqual(['m0', 'm2', 'm5']);
  });

  it('marks one run of a single channel exactly once', () => {
    // The whole point: a badge on all fifty rows is noise, and noise is what
    // gets skimmed past.
    expect(run(Array(50).fill('c-gmail')).size).toBe(1);
  });

  it('marks every row when two channels alternate', () => {
    const ids = Array.from({ length: 6 }, (_, i) =>
      i % 2 === 0 ? 'c-gmail' : 'c-whatsapp',
    );
    expect(run(ids).size).toBe(6);
  });

  it('treats an unknown channel as its own state, and back again', () => {
    // A message whose channel row failed to load renders no label; it must
    // still count as a change, or the next real one is swallowed.
    const marked = run(['c-gmail', 'c-missing', 'c-gmail']);
    expect([...marked].sort()).toEqual(['m0', 'm1', 'm2']);
  });

  it('returns nothing for no messages', () => {
    expect(channelChangePoints([], types).size).toBe(0);
  });
});

describe('formatAge', () => {
  const now = Date.parse('2026-07-28T12:00:00.000Z');
  const ago = (seconds: number) =>
    new Date(now - seconds * 1000).toISOString();

  it('returns null before the client has mounted', () => {
    // `now === 0` is lib/now.ts's not-mounted sentinel. The row falls back to
    // the absolute clock time, which is what the server can render without
    // guessing at a clock it does not share.
    expect(formatAge(ago(60), 0)).toBeNull();
  });

  it('says "just now" for the first three quarters of a minute', () => {
    expect(formatAge(ago(0), now)).toBe('just now');
    expect(formatAge(ago(44), now)).toBe('just now');
  });

  it('never says "0m ago" or "1m ago" twice at the boundary', () => {
    // Rounding minutes without the 45/90s steps produces "0m ago" just after
    // sending, which reads as broken.
    expect(formatAge(ago(45), now)).toBe('1m ago');
    expect(formatAge(ago(89), now)).toBe('1m ago');
    expect(formatAge(ago(90), now)).toBe('2m ago');
  });

  it('counts minutes up to the hour', () => {
    expect(formatAge(ago(14 * 60), now)).toBe('14m ago');
    expect(formatAge(ago(59 * 60), now)).toBe('59m ago');
  });

  it('hands back to the clock at an hour', () => {
    // Past an hour "4h ago" is vaguer than 14:12, and the day heading above
    // the row already carries the date.
    expect(formatAge(ago(3600), now)).toBeNull();
    expect(formatAge(ago(86_400), now)).toBeNull();
  });

  it('does not produce a negative age from clock skew', () => {
    // A sender's machine running 40 seconds fast is ordinary. Without the
    // catch this reads "-1m ago".
    expect(formatAge(ago(-40), now)).toBe('just now');
    expect(formatAge(ago(-5000), now)).toBe('just now');
  });
});

describe('bodyForDisplay', () => {
  it('leaves an ordinary body alone', () => {
    expect(bodyForDisplay('Hello there')).toEqual({
      text: 'Hello there',
      truncated: false,
      limit: BODY_LIMIT,
    });
  });

  it('reports truncation as a flag rather than appending an ellipsis', () => {
    // The UI says "showing the first 4,000 characters" outright. A trailing …
    // is the same claim made too quietly to act on, and indistinguishable from
    // an ellipsis the sender typed.
    const result = bodyForDisplay('x'.repeat(BODY_LIMIT + 500));
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(BODY_LIMIT);
    expect(result.text.endsWith('…')).toBe(false);
  });

  it('does not truncate at exactly the limit', () => {
    expect(bodyForDisplay('x'.repeat(BODY_LIMIT)).truncated).toBe(false);
  });

  it('collapses a whitespace-only body to empty so the UI can say so', () => {
    // '' is a legal, meaningful value — normalize looked and there was
    // nothing. docs/02-ARCHITECTURE.md §2. The row renders a sentence for it
    // rather than an unexplained gap, and that branch keys off this being ''.
    expect(bodyForDisplay('   \n\n  ').text).toBe('');
    expect(bodyForDisplay('').text).toBe('');
  });
});

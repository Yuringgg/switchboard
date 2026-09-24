import { describe, expect, it } from 'vitest';

import {
  channelLines,
  nameTokens,
  openItems,
  rollUpAffiliations,
  titleNames,
  type BriefRow,
} from '../src/lib/brief';

/**
 * The per-person brief (`src/lib/brief.ts`).
 *
 * ⚠ The rule these pin was found by checking the live database BEFORE
 * building: the one affiliation row in production (2026-09-24) sat in a
 * message the reader SENT, and its title names somebody else. Attributed by
 * sender, that person's company would have been printed on the reader's own
 * contact as fact.
 */

function row(overrides: Partial<BriefRow> & { payload?: BriefRow['payload'] }): BriefRow {
  return {
    id: 'ex-1',
    kind: 'affiliation',
    status: 'not_started',
    model: 'openai/gpt-oss-20b',
    messageId: 'msg-1',
    sentAt: '2026-09-10T02:00:00.000Z',
    channelId: 'ch-gmail',
    ...overrides,
    payload: { title: 'Maria Santos — procurement at Acme', quote: 'I run procurement at Acme.', ...overrides.payload },
  };
}

describe('whose affiliation is it', () => {
  const tokens = nameTokens(['Maria Santos', 'maria@iozera.example']);

  it('takes whole-word names of three letters or more', () => {
    expect(tokens).toEqual(expect.arrayContaining(['maria', 'santos']));
    // An address is not a name. "iozera" and "example" are words, but the
    // title test is whole-word, and they are cheap noise rather than a match.
    expect(nameTokens(['+63 917 000 0001'])).toEqual([]);
    expect(nameTokens(['Jo Li'])).toEqual([]);
  });

  it('matches whole words only — "Ana" is not in "Banana"', () => {
    expect(titleNames('Banana Corp — supplier', ['ana'])).toBe(false);
    expect(titleNames('Ana Cruz — supplier', ['ana'])).toBe(true);
  });

  it('rolls up a row that names this person', () => {
    const result = rollUpAffiliations(
      [row({ payload: { company: 'Acme Logistics', role: 'Procurement', decision_maker: true } })],
      tokens,
    );
    expect(result.facts.company?.value).toBe('Acme Logistics');
    expect(result.facts.role?.value).toBe('Procurement');
    expect(result.facts.decisionMaker?.value).toBe(true);
    expect(result.others).toEqual([]);
  });

  /*
   * ⚠⚠ The live case. A row in their conversation that names somebody else
   * must be SHOWN — as "also mentioned" — and never become their fact.
   */
  it('never pins another person’s company on this contact', () => {
    const result = rollUpAffiliations(
      [row({ payload: { title: 'Luis Reyes — accounting at Acme', company: 'Acme Logistics' } })],
      tokens,
    );
    expect(result.facts.company).toBeNull();
    expect(result.others).toHaveLength(1);
    expect(result.others[0]?.source.title).toContain('Luis');
  });

  it('a contact known only by a number gets no facts, and loses no rows', () => {
    const result = rollUpAffiliations(
      [row({ payload: { company: 'Acme Logistics' } })],
      nameTokens(['+63 917 000 0001']),
    );
    expect(result.facts.company).toBeNull();
    expect(result.others).toHaveLength(1);
  });
});

describe('rolling up', () => {
  const tokens = ['maria'];

  it('prefers the newest row for each fact — people change jobs', () => {
    const result = rollUpAffiliations(
      [
        row({ id: 'old', sentAt: '2026-08-01T00:00:00Z', payload: { company: 'Old Co' } }),
        row({ id: 'new', sentAt: '2026-09-01T00:00:00Z', payload: { company: 'New Co' } }),
      ],
      tokens,
    );
    expect(result.facts.company?.value).toBe('New Co');
    // The older one is still there, underneath, as evidence.
    expect(result.about.map((a) => a.source.extractionId)).toEqual(['new', 'old']);
  });

  it('a newer row that says nothing about a fact does not erase it', () => {
    const result = rollUpAffiliations(
      [
        row({ id: 'old', sentAt: '2026-08-01T00:00:00Z', payload: { company: 'Acme' } }),
        row({ id: 'new', sentAt: '2026-09-01T00:00:00Z', payload: { role: 'CFO', company: null } }),
      ],
      tokens,
    );
    expect(result.facts.company?.value).toBe('Acme');
    expect(result.facts.role?.value).toBe('CFO');
  });

  it('every fact carries the sentence and the message it came from', () => {
    const result = rollUpAffiliations([row({ payload: { relationship: 'client' } })], tokens);
    expect(result.facts.relationship).toEqual({
      value: 'client',
      source: expect.objectContaining({ quote: 'I run procurement at Acme.', messageId: 'msg-1' }),
    });
  });

  it('keeps "decides: no" — it is as useful as yes', () => {
    const result = rollUpAffiliations([row({ payload: { decision_maker: false } })], tokens);
    expect(result.facts.decisionMaker?.value).toBe(false);
  });

  it('drops a row with no quote rather than showing a claim with no evidence', () => {
    const result = rollUpAffiliations([row({ payload: { quote: '', company: 'Acme' } })], tokens);
    expect(result.facts.company).toBeNull();
    expect(result.about).toEqual([]);
  });
});

describe('open items', () => {
  it('leaves out Done and anything that is not an attention kind', () => {
    const items = openItems([
      row({ id: 'a', kind: 'action_item', status: 'not_started', payload: { title: 'A', quote: 'q' } }),
      row({ id: 'b', kind: 'action_item', status: 'done', payload: { title: 'B', quote: 'q' } }),
      row({ id: 'c', kind: 'affiliation', payload: { title: 'C', quote: 'q' } }),
      row({ id: 'd', kind: 'summary', payload: { title: 'D', quote: 'q' } }),
    ]);
    expect(items.map((i) => i.id)).toEqual(['a']);
  });

  it('orders by when it is about, soonest first, then undated by newest message', () => {
    const items = openItems([
      row({ id: 'undated-old', kind: 'question', sentAt: '2026-09-01T00:00:00Z', payload: { title: 'x', quote: 'q' } }),
      row({ id: 'later', kind: 'meeting', payload: { title: 'x', quote: 'q', starts_at: '2026-10-05T07:00:00Z' } }),
      row({ id: 'undated-new', kind: 'question', sentAt: '2026-09-20T00:00:00Z', payload: { title: 'x', quote: 'q' } }),
      row({ id: 'sooner', kind: 'action_item', payload: { title: 'x', quote: 'q', due_at: '2026-09-28T07:00:00Z' } }),
    ]);
    expect(items.map((i) => i.id)).toEqual(['sooner', 'later', 'undated-new', 'undated-old']);
  });

  it('a meeting is about when it starts; anything else, when it is due', () => {
    const [meeting] = openItems([
      row({ kind: 'meeting', payload: { title: 'x', quote: 'q', starts_at: 'S', due_at: 'D' } }),
    ]);
    expect(meeting?.when).toBe('S');
  });
});

describe('where they write', () => {
  it('counts only messages they sent, per line, busiest first', () => {
    const lines = channelLines([
      { channelId: 'gmail', sentAt: '2026-09-01T00:00:00Z', fromThem: true },
      { channelId: 'gmail', sentAt: '2026-09-03T00:00:00Z', fromThem: true },
      { channelId: 'gmail', sentAt: '2026-09-05T00:00:00Z', fromThem: false },
      { channelId: 'whatsapp', sentAt: '2026-09-04T00:00:00Z', fromThem: true },
    ]);
    expect(lines).toEqual([
      { channelId: 'gmail', count: 2, lastAt: '2026-09-03T00:00:00Z' },
      { channelId: 'whatsapp', count: 1, lastAt: '2026-09-04T00:00:00Z' },
    ]);
  });
});

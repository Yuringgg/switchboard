import { describe, expect, it } from 'vitest';

import type { BriefRow } from '../src/lib/brief';
import {
  assembleClues,
  hintWords,
  narrowByHint,
  noteLabel,
  phraseClue,
  sameNameGroups,
  tellApart,
  workDomain,
  type PersonClues,
} from '../src/lib/tell-apart';

/**
 * Telling apart people who share a name — Ms. Maria's research task 4.
 *
 * The property that matters: each person gets a clue that NOBODY ELSE in the
 * group has, and gets `null` — "cannot be told apart" — rather than a guess
 * when no such clue exists.
 */

function person(overrides: Partial<PersonClues> & { id: string }): PersonClues {
  return {
    name: 'Maria Santos',
    note: null,
    company: null,
    role: null,
    domains: [],
    topic: null,
    channels: ['gmail'],
    lastAt: null,
    ...overrides,
  };
}

const SAY = { channelLabel: (t: string) => t.toUpperCase(), day: (iso: string) => `on ${iso.slice(0, 10)}` };

describe('workDomain', () => {
  it('reads the registrable domain, so a mail server is not a person', () => {
    expect(workDomain('noreply@tm.openai.com')).toBe('openai.com');
    expect(workDomain('hello@email.openai.com')).toBe('openai.com');
  });

  it('keeps a country second level: mapua.edu.ph, not edu.ph', () => {
    expect(workDomain('msantos@mymail.mapua.edu.ph')).toBe('mapua.edu.ph');
    expect(workDomain('a@acme.co.uk')).toBe('acme.co.uk');
  });

  it('says nothing for free mail — every Maria has a Gmail', () => {
    expect(workDomain('maria@gmail.com')).toBeNull();
    expect(workDomain('maria@yahoo.com.ph')).toBeNull();
  });

  it('is null for a phone number or a bare name', () => {
    expect(workDomain('+639170000042')).toBeNull();
    expect(workDomain('Maria')).toBeNull();
    expect(workDomain(null)).toBeNull();
  });
});

describe('noteLabel', () => {
  it('takes the first non-empty line', () => {
    expect(noteLabel('\n  Landlord — Makati condo\nFrom Maria: pays by GCash')).toBe(
      'Landlord — Makati condo',
    );
  });

  it('cuts a long line on a word boundary, never mid-word', () => {
    const label = noteLabel('Operations lead at Acme Logistics for the whole October delivery run', 30);
    expect(label).toBe('Operations lead at Acme…');
  });

  it('is null for an empty note', () => {
    expect(noteLabel('   \n ')).toBeNull();
    expect(noteLabel(null)).toBeNull();
  });
});

describe('tellApart', () => {
  it('gives each person the clue nobody else in the group has', () => {
    const clues = tellApart([
      person({ id: 'a', company: 'Acme' }),
      person({ id: 'b', domains: ['mapua.edu.ph'] }),
      person({ id: 'c', topic: 'Rent for September' }),
    ]);

    expect(clues.get('a')).toMatchObject({ kind: 'company', value: 'Acme' });
    expect(clues.get('b')).toMatchObject({ kind: 'domain', value: 'mapua.edu.ph' });
    expect(clues.get('c')).toMatchObject({ kind: 'topic' });
  });

  it('works for many people, not just two', () => {
    const people = Array.from({ length: 7 }, (_, i) =>
      person({ id: `p${i}`, topic: `Project ${i}` }),
    );
    const clues = tellApart(people);
    expect([...clues.values()].every((c) => c?.kind === 'topic')).toBe(true);
    expect(new Set([...clues.values()].map((c) => c?.value)).size).toBe(7);
  });

  it('uses the full name first when that alone differs', () => {
    const clues = tellApart([
      person({ id: 'a', name: 'Maria Santos', company: 'Acme' }),
      person({ id: 'b', name: 'Maria Cruz', company: 'Acme' }),
    ]);
    expect(clues.get('a')?.kind).toBe('name');
    expect(clues.get('b')?.kind).toBe('name');
  });

  it('puts the reader’s own note above anything inferred', () => {
    const clues = tellApart([
      person({ id: 'a', note: 'Landlord', company: 'Acme' }),
      person({ id: 'b', company: 'Globe' }),
    ]);
    expect(clues.get('a')).toMatchObject({ kind: 'note', value: 'Landlord' });
  });

  it('skips a clue both people share and takes the next one', () => {
    const clues = tellApart([
      person({ id: 'a', company: 'Acme', topic: 'Invoice' }),
      person({ id: 'b', company: 'Acme', topic: 'Website' }),
    ]);
    expect(clues.get('a')).toMatchObject({ kind: 'topic', value: 'Invoice' });
    expect(clues.get('b')).toMatchObject({ kind: 'topic', value: 'Website' });
  });

  it('does not call the Gmail-only person "the one on Gmail" when both are on Gmail', () => {
    const clues = tellApart([
      person({ id: 'a', channels: ['gmail'] }),
      person({ id: 'b', channels: ['gmail', 'whatsapp'] }),
    ]);
    expect(clues.get('b')).toMatchObject({ kind: 'channel', value: 'whatsapp' });
    expect(clues.get('a')).toBeNull();
  });

  it('is null — not a guess — when nothing differs', () => {
    const same = { topic: 'Rent', lastAt: '2026-09-20T02:00:00Z' };
    const clues = tellApart([person({ id: 'a', ...same }), person({ id: 'b', ...same })]);
    expect(clues.get('a')).toBeNull();
    expect(clues.get('b')).toBeNull();
  });

  it('compares last-wrote by Manila DAY, not by instant', () => {
    // 23:30 and 23:50 Manila on the same day are the same answer to "when".
    const clues = tellApart([
      person({ id: 'a', lastAt: '2026-09-20T15:30:00Z' }),
      person({ id: 'b', lastAt: '2026-09-20T15:50:00Z' }),
    ]);
    expect(clues.get('a')).toBeNull();
  });

  it('describes a single match instead, skipping the name the caller just said', () => {
    const clues = tellApart([person({ id: 'a', company: 'Acme' })]);
    expect(clues.get('a')).toMatchObject({ kind: 'company' });
  });
});

describe('phraseClue', () => {
  it('says the name clue as nothing — the name is already being said', () => {
    expect(phraseClue({ kind: 'name', value: 'Maria Cruz' }, SAY)).toBe('');
  });

  it('includes a role when the company row stated one', () => {
    expect(phraseClue({ kind: 'company', value: 'Acme', detail: 'Designer' }, SAY)).toBe(
      'Designer at Acme',
    );
    expect(phraseClue({ kind: 'company', value: 'Acme' }, SAY)).toBe('at Acme');
  });

  it('never calls a meeting a line somebody writes on', () => {
    expect(phraseClue({ kind: 'channel', value: 'meeting' }, SAY)).toBe('heard in a meeting');
    expect(phraseClue({ kind: 'channel', value: 'whatsapp' }, SAY)).toBe('on WHATSAPP');
  });
});

describe('hints', () => {
  it('keeps the words that carry a clue, and drops the filler', () => {
    expect(hintWords('the one from Acme who emailed about the website')).toEqual([
      'acme',
      'website',
    ]);
  });

  it('strips everything a PostgREST or() filter would read as syntax', () => {
    const words = hintWords('acme),owner_id.neq.x,(%_*');
    for (const word of words) expect(word).toMatch(/^[\p{L}\p{N}]+$/u);
  });

  it('narrows on what is known about each person', () => {
    const people = [
      person({ id: 'a', company: 'Acme' }),
      person({ id: 'b', domains: ['mapua.edu.ph'] }),
    ];
    expect(narrowByHint(people, hintWords('Acme')).map((p) => p.id)).toEqual(['a']);
    expect(narrowByHint(people, hintWords('Mapua')).map((p) => p.id)).toEqual(['b']);
  });

  it('narrows on words in their conversations — project context with no company', () => {
    const people = [person({ id: 'a' }), person({ id: 'b' })];
    const inMessages = new Map([['website', new Set(['b'])]]);
    expect(narrowByHint(people, ['website'], inMessages).map((p) => p.id)).toEqual(['b']);
  });

  it('needs EVERY word to match', () => {
    const people = [
      person({ id: 'a', company: 'Acme', topic: 'Invoice' }),
      person({ id: 'b', company: 'Acme', topic: 'Website' }),
    ];
    expect(narrowByHint(people, ['acme', 'website']).map((p) => p.id)).toEqual(['b']);
  });

  it('leaves everyone when there is no hint', () => {
    const people = [person({ id: 'a' }), person({ id: 'b' })];
    expect(narrowByHint(people, [])).toHaveLength(2);
  });
});

describe('assembleClues', () => {
  const affiliation = (title: string, company: string, conversationId: string) => ({
    row: {
      id: `x-${company}`,
      kind: 'affiliation',
      status: null,
      model: 'm',
      messageId: 'm1',
      sentAt: '2026-09-20T00:00:00Z',
      channelId: 'ch',
      payload: { title, quote: 'I run operations at Acme.', company },
    } satisfies BriefRow,
    conversationId,
  });

  const base = {
    contacts: [{ id: 'c1', displayName: 'Maria Santos', notes: null }],
    identities: [
      {
        id: 'i1',
        contactId: 'c1',
        channelType: 'gmail',
        externalId: 'maria@acmelogistics.ph',
        displayName: 'Maria Santos',
      },
    ],
    sent: [
      { senderIdentity: 'i1', subject: 'Old thing', sentAt: '2026-09-01T00:00:00Z', conversationId: 't1' },
      { senderIdentity: 'i1', subject: 'Newest thing', sentAt: '2026-09-20T00:00:00Z', conversationId: 't2' },
    ],
  };

  it('takes the topic from the NEWEST message and the domain from the handle', () => {
    const [clues] = assembleClues({ ...base, affiliations: [] });
    expect(clues?.topic).toBe('Newest thing');
    expect(clues?.domains).toEqual(['acmelogistics.ph']);
    expect(clues?.lastAt).toBe('2026-09-20T00:00:00Z');
  });

  it('takes a company only from a row that NAMES them (ADR-028)', () => {
    const named = assembleClues({
      ...base,
      affiliations: [affiliation('Maria Santos runs operations at Acme', 'Acme', 't1')],
    });
    expect(named[0]?.company).toBe('Acme');

    // Same thread, but the row is about somebody else. Pinning Acme on Maria
    // here is the exact mistake ADR-028 exists to prevent.
    const other = assembleClues({
      ...base,
      affiliations: [affiliation('Jose Reyes runs operations at Acme', 'Acme', 't1')],
    });
    expect(other[0]?.company).toBeNull();
  });

  it('ignores a row from a thread they are not in', () => {
    const clues = assembleClues({
      ...base,
      affiliations: [affiliation('Maria Santos runs operations at Acme', 'Acme', 'elsewhere')],
    });
    expect(clues[0]?.company).toBeNull();
  });

  it('survives missing side rows: a clue goes missing, never the person', () => {
    const clues = assembleClues({
      contacts: base.contacts,
      identities: [],
      sent: [],
      affiliations: [],
    });
    expect(clues).toHaveLength(1);
    expect(clues[0]?.name).toBe('Maria Santos');
  });
});

describe('sameNameGroups', () => {
  it('groups by the name as said — case and spacing do not make two people', () => {
    const groups = sameNameGroups([
      { id: '1', displayName: 'OpenAI' },
      { id: '2', displayName: 'openai ' },
      { id: '3', displayName: 'Anthropic' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.map((c) => c.id)).toEqual(['1', '2']);
  });
});

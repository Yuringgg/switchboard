import { describe, expect, it } from 'vitest';

import {
  buildQuery,
  hasFilters,
  highlightSegments,
  manilaDayEnd,
  manilaDayStart,
} from '../src/lib/search';

/**
 * The query grammar and the highlight parser.
 *
 * Both are pure, and both sit on a security boundary — `buildQuery` decides
 * whether a string reaches `to_tsquery` (which raises on malformed input) or
 * `websearch_to_tsquery` (which does not), and `highlightSegments` is what
 * keeps message bodies out of `dangerouslySetInnerHTML`. Neither can be
 * checked by looking at the screen.
 */

/** Must match `chr(2)`/`chr(3)` in migration 0007. Escapes, not literals: as
 *  raw control characters these are invisible and a stray edit deletes them
 *  silently -- and `indexOf('')` returns 0, so every snippet would parse as
 *  one empty match. */
const START = '\u0002';
const END = '\u0003';

describe('buildQuery', () => {
  it('is null for an empty or blank query', () => {
    expect(buildQuery('')).toBeNull();
    expect(buildQuery('   ')).toBeNull();
    expect(buildQuery('\n\t ')).toBeNull();
  });

  it('builds an AND query with a prefix match on the final term', () => {
    expect(buildQuery('deadline')).toEqual({ q: 'deadline:*', prefix: true });
    expect(buildQuery('project deadline')).toEqual({
      q: 'project & deadline:*',
      prefix: true,
    });
  });

  /**
   * The reason the prefix exists. The 'simple' text-search config does no
   * stemming — deliberately, because the corpus is Taglish and an English
   * stemmer mangles it — so without a trailing `:*` a search for "deadline"
   * would not find a message saying "deadlines", which is the single most
   * obvious thing a search box is expected to do.
   */
  it('makes a singular find a plural, which is what the prefix is for', () => {
    const built = buildQuery('deadline');
    expect(built?.q.endsWith(':*')).toBe(true);
  });

  /**
   * ⚠ This is the test that keeps `prefix: true` safe. Everything that
   * `to_tsquery` could read as an operator has to be gone by the time this
   * string reaches it — `&`, `|`, `!`, `(`, `)`, `:` and `*` included — or a
   * user typing punctuation gets a database syntax error.
   */
  it('strips every character to_tsquery could read as an operator', () => {
    const built = buildQuery('what & why | not! (really) *');

    expect(built?.prefix).toBe(true);
    // Only the separators this function inserted, never the ones typed.
    expect(built?.q).toBe('what & why & not & really:*');
    expect(built?.q).not.toMatch(/[|!()]/);
  });

  it('never produces a syntactically broken query from trailing punctuation', () => {
    for (const input of ['meeting &', 'a | ', '((', ':*', '& & &', '...']) {
      const built = buildQuery(input);
      // Either it went to websearch (which cannot raise), or it is a clean
      // prefix query. What must never happen is a raw operator in prefix mode.
      if (built?.prefix) {
        expect(built.q).toMatch(/^[\p{L}\p{N}]+(?: & [\p{L}\p{N}]+)*:\*$/u);
      }
    }
  });

  /**
   * Falls back to websearch rather than to a prefix query, because an empty
   * tsquery matches nothing while still being non-null — the function would
   * fall through to browsing and show every message as though it were a hit.
   */
  it('sends a query that strips to nothing to websearch, not to prefix mode', () => {
    expect(buildQuery('???')).toEqual({ q: '???', prefix: false });
    expect(buildQuery('---')?.prefix).toBe(false);
  });

  it('keeps non-ASCII letters, because the corpus is Taglish', () => {
    // `[a-z0-9]` would split this into two tokens and match neither word that
    // is actually in the message.
    expect(buildQuery('señora')).toEqual({ q: 'señora:*', prefix: true });
    expect(buildQuery('pasensya na paré')).toEqual({
      q: 'pasensya & na & paré:*',
      prefix: true,
    });
  });

  describe('advanced grammar goes to websearch verbatim', () => {
    it('detects a quoted phrase', () => {
      expect(buildQuery('"the deadline"')).toEqual({
        q: '"the deadline"',
        prefix: false,
      });
    });

    it('detects an exclusion', () => {
      // The strip would delete the minus, turning "not this" into "this".
      expect(buildQuery('meeting -cancelled')).toEqual({
        q: 'meeting -cancelled',
        prefix: false,
      });
    });

    it('detects `or`, case-insensitively', () => {
      expect(buildQuery('invoice or receipt')?.prefix).toBe(false);
      expect(buildQuery('invoice OR receipt')?.prefix).toBe(false);
    });

    it('does not mistake a word containing "or" for the operator', () => {
      // "Doctor" and "order" both contain it; neither is an operator.
      expect(buildQuery('doctor order')).toEqual({
        q: 'doctor & order:*',
        prefix: true,
      });
    });

    it('does not mistake a hyphen inside a word for an exclusion', () => {
      expect(buildQuery('follow-up')?.prefix).toBe(true);
    });
  });
});

describe('highlightSegments', () => {
  it('splits a snippet into plain and matched runs', () => {
    expect(highlightSegments(`about the ${START}deadline${END} today`)).toEqual([
      { text: 'about the ', match: false },
      { text: 'deadline', match: true },
      { text: ' today', match: false },
    ]);
  });

  it('handles a snippet with no matches at all', () => {
    expect(highlightSegments('nothing highlighted')).toEqual([
      { text: 'nothing highlighted', match: false },
    ]);
  });

  it('handles several matches, including at both ends', () => {
    const segments = highlightSegments(`${START}a${END} b ${START}c${END}`);
    expect(segments.map((s) => s.match)).toEqual([true, false, true]);
    expect(segments.map((s) => s.text)).toEqual(['a', ' b ', 'c']);
  });

  it('drops empty runs rather than rendering empty elements', () => {
    expect(highlightSegments(`${START}x${END}`)).toEqual([{ text: 'x', match: true }]);
  });

  it('is empty for an empty snippet', () => {
    expect(highlightSegments('')).toEqual([]);
  });

  /**
   * The delimiters are control characters that cannot occur in real message
   * text — but "cannot occur" is a claim about the corpus, and this parser
   * should not be the thing that breaks if it is ever wrong. An unterminated
   * run degrades to plain text; it never throws and never loses the tail.
   */
  it('degrades to plain text on an unterminated run instead of throwing', () => {
    expect(highlightSegments(`start ${START}never closed`)).toEqual([
      { text: 'start ', match: false },
      { text: 'never closed', match: false },
    ]);
  });

  /**
   * ⚠ The reason this function exists. `ts_headline` defaults to wrapping
   * matches in `<b>`, and rendering that means putting a message body written
   * by someone else through `dangerouslySetInnerHTML`. Segments are rendered
   * as React children instead, so markup in a body stays text.
   */
  it('treats markup in a body as text, never as structure', () => {
    const segments = highlightSegments(
      `<img src=x onerror=alert(1)> ${START}invoice${END}`,
    );

    expect(segments[0]).toEqual({
      text: '<img src=x onerror=alert(1)> ',
      match: false,
    });
    expect(segments[1]).toEqual({ text: 'invoice', match: true });
  });
});

describe('Manila day bounds', () => {
  /**
   * The timeline groups by Manila day. If the filter disagreed, "1 August"
   * would drop everything sent after 4pm on the 1st — the screen would
   * contradict its own filter for a third of every day.
   */
  it('starts a day at midnight Manila, not midnight UTC', () => {
    expect(manilaDayStart('2026-08-01')).toBe('2026-07-31T16:00:00.000Z');
  });

  it('ends a day at the last instant of that Manila day', () => {
    expect(manilaDayEnd('2026-08-01')).toBe('2026-08-01T15:59:59.999Z');
  });

  it('covers a whole day with no gap and no overlap', () => {
    const end = new Date(manilaDayEnd('2026-08-01')!).getTime();
    const nextStart = new Date(manilaDayStart('2026-08-02')!).getTime();
    expect(nextStart - end).toBe(1);
  });

  it('rejects anything that is not a bare ISO date', () => {
    for (const bad of ['', 'today', '2026-8-1', '2026-08-01T00:00', 'nonsense']) {
      expect(manilaDayStart(bad)).toBeNull();
      expect(manilaDayEnd(bad)).toBeNull();
    }
  });

  it('rejects an impossible date rather than silently rolling it over', () => {
    expect(manilaDayStart('2026-13-45')).toBeNull();
  });
});

describe('hasFilters', () => {
  it('is false when nothing is set', () => {
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ channelIds: [], contactIds: [], from: '', to: '' })).toBe(false);
  });

  it('is true when any single filter is set', () => {
    expect(hasFilters({ channelIds: ['id'] })).toBe(true);
    expect(hasFilters({ contactIds: ['id'] })).toBe(true);
    expect(hasFilters({ from: '2026-08-01' })).toBe(true);
    expect(hasFilters({ to: '2026-08-01' })).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { chunkText, CHUNK_SIZE } from '../src/chunk';

/**
 * Chunking is the piece most likely to be subtly wrong and least likely to
 * announce it. `multilingual-e5-small` caps at 512 tokens and **silently
 * truncates** past that — so an over-sized chunk does not error, it just makes
 * the tail of a long email permanently unsearchable while looking indexed.
 */

const sentence = (n: number) =>
  `This is sentence number ${n} and it carries enough words to be worth embedding.`;

const body = (count: number) =>
  Array.from({ length: count }, (_, i) => sentence(i)).join(' ');

describe('chunkText', () => {
  it('returns nothing for an empty body', () => {
    // A WhatsApp photo with no caption. There is genuinely nothing to embed,
    // and inventing a placeholder would salt the corpus with words nobody sent.
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n\t ')).toEqual([]);
  });

  it('keeps a short message whole', () => {
    const text = 'Sige, sending the files na — nasa drive na lahat. Salamat!';
    expect(chunkText(text)).toEqual([{ index: 0, content: text }]);
  });

  it('splits a long body into several chunks', () => {
    const chunks = chunkText(body(60));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  /**
   * ⚠ The property that matters most. Over the cap the model truncates without
   * erroring, so a single oversized chunk is a permanently unsearchable tail.
   * The merge rule for short final fragments is allowed to exceed the target,
   * so the bound is generous — what it must never be is unbounded.
   */
  it('never emits a chunk far over the target size', () => {
    for (const count of [20, 60, 200, 500]) {
      for (const chunk of chunkText(body(count))) {
        expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_SIZE * 1.4);
      }
    }
  });

  it('loses no content — every sentence survives somewhere', () => {
    const chunks = chunkText(body(80));
    const joined = chunks.map((c) => c.content).join(' ');

    for (const n of [0, 1, 40, 79]) {
      expect(joined).toContain(`sentence number ${n} `);
    }
  });

  /**
   * Without overlap a sentence straddling a boundary is embedded as two halves
   * and matches neither half of its own meaning.
   */
  it('overlaps consecutive chunks', () => {
    const chunks = chunkText(body(100));
    expect(chunks.length).toBeGreaterThan(2);

    let overlapping = 0;
    for (let i = 1; i < chunks.length; i += 1) {
      const previousTail = chunks[i - 1]!.content.slice(-60);
      const words = previousTail.split(/\s+/).filter((w) => w.length > 3);
      if (words.some((w) => chunks[i]!.content.includes(w))) overlapping += 1;
    }
    // Not every boundary — a paragraph break consumed exactly at the cut can
    // legitimately leave none — but the mechanism must clearly be working.
    expect(overlapping).toBeGreaterThan(chunks.length / 2);
  });

  it('prefers paragraph boundaries when one is near the cut', () => {
    const filler = 'word '.repeat(180).trim(); // ~900 chars
    const chunks = chunkText(`${filler}\n\nSecond paragraph starts here.\n\n${filler}`);

    expect(chunks.length).toBeGreaterThan(1);
    // The cut landed on the paragraph break, so no chunk begins mid-word.
    for (const chunk of chunks) {
      expect(chunk.content).toBe(chunk.content.trim());
    }
  });

  /**
   * ⚠ Assert the actual property, not a proxy for it.
   *
   * The first version of this flagged any chunk opening with a 1–3 letter word
   * (`/^[a-z]{1,3}\s/`). That is not what "mid-word" means: "mga", "ang", "the"
   * and "in" are all complete words, and the check failed against a chunker
   * that had just been fixed. The real property is that a chunk's opening token
   * appears as a **whole word** in the source — which a fragment like "ng"
   * sliced out of "yung" does not.
   */
  const startsOnAWordBoundary = (chunks: { content: string }[], source: string) => {
    for (const chunk of chunks) {
      expect(chunk.content.startsWith(' ')).toBe(false);
      const first = chunk.content.split(/\s+/)[0]!.replace(/[^\p{L}\p{N}]/gu, '');
      if (!first) continue;
      const whole = new RegExp(`(^|[^\\p{L}\\p{N}])${first}([^\\p{L}\\p{N}]|$)`, 'u');
      expect(whole.test(source)).toBe(true);
    }
  };

  it('never starts a chunk mid-word', () => {
    const source = body(120);
    startsOnAWordBoundary(chunkText(source), source);
  });

  /**
   * A 20-character trailing chunk — "Thanks!\n\nMaria" — embeds to a vector
   * close to every pleasantry in the corpus, so it surfaces as a false match
   * for almost any query while carrying no information.
   */
  it('folds a tiny trailing fragment into the previous chunk', () => {
    const chunks = chunkText(`${body(40)}\n\nThanks!`);
    const last = chunks.at(-1)!;

    expect(last.content).toContain('Thanks!');
    expect(last.content.length).toBeGreaterThan(120);
  });

  it('collapses whitespace, which is free capacity inside a token window', () => {
    const chunks = chunkText('Hello\n\n\n\n\nworld    with     padding');
    expect(chunks[0]!.content).toBe('Hello\n\nworld with padding');
  });

  it('normalises CRLF, so Windows-authored mail chunks identically', () => {
    expect(chunkText('a\r\n\r\nb')[0]!.content).toBe('a\n\nb');
  });

  /**
   * The case that caught the real bug: a chunk began `"ng mga files…"`, having
   * sliced the Tagalog "yung" in half. Nothing errors — the fragment is simply
   * embedded as though it were a word, diluting the vector it belongs to.
   * Taglish makes this more likely, because the tokenizer already fragments
   * these words and a bad split compounds it.
   */
  it('handles Taglish without splitting inside a word', () => {
    const taglish =
      'Kumusta! Gusto ko sanang malaman kung natanggap niyo na yung mga files na pinadala ko noong Lunes. ';
    const source = taglish.repeat(20);
    const chunks = chunkText(source);

    expect(chunks.length).toBeGreaterThan(1);
    startsOnAWordBoundary(chunks, source);
    // The specific fragment the bug produced.
    expect(chunks.some((c) => c.content.startsWith('ng '))).toBe(false);
  });

  /**
   * A guard against the caller, not against the data: with overlap >= size the
   * cursor never advances and the loop runs forever. Worth pinning because the
   * symptom is a hung worker rather than an error.
   */
  it('terminates even when asked for an overlap larger than the chunk', () => {
    const chunks = chunkText(body(50), { size: 200, overlap: 500 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(500);
  });
});

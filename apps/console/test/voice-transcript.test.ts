import { describe, expect, it } from 'vitest';

import { foldTranscript, type TranscriptTurn } from '../src/lib/voice/transcript';

/**
 * Folding live transcript messages into readable turns.
 *
 * ⚠ The whole file is about one trap: **partials REPLACE, they do not append.**
 * The transcriber emits a fresh revision of the same utterance many times a
 * second. Appending them produces
 *
 *     "what what's what's in what's in my what's in my inbox"
 *
 * which reads as a defect in the product rather than in the transcriber, and it
 * is the single most likely way to get this wrong.
 */

const start: TranscriptTurn[] = [];

describe('foldTranscript', () => {
  it('replaces a partial rather than appending it', () => {
    let turns = foldTranscript(start, { role: 'user', text: 'what', final: false });
    turns = foldTranscript(turns, { role: 'user', text: "what's in", final: false });
    turns = foldTranscript(turns, { role: 'user', text: "what's in my inbox", final: true });

    expect(turns).toEqual([{ role: 'user', text: "what's in my inbox", final: true }]);
  });

  it('starts a new turn once the previous one is final', () => {
    let turns = foldTranscript(start, { role: 'user', text: 'hello', final: true });
    turns = foldTranscript(turns, { role: 'user', text: 'and one more thing', final: true });

    expect(turns).toHaveLength(2);
  });

  it('keeps the two speakers in separate turns', () => {
    let turns = foldTranscript(start, { role: 'user', text: 'what is in my inbox', final: true });
    turns = foldTranscript(turns, { role: 'assistant', text: 'Five messages.', final: true });

    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant']);
  });

  it('handles barge-in — interrupting her opens a turn of its own', () => {
    /*
     * ⚠ The case a naive "replace the last turn" would corrupt. She is
     * mid-sentence when you cut in; your words must not overwrite hers.
     */
    let turns = foldTranscript(start, {
      role: 'assistant',
      text: 'You have five messages, the first',
      final: false,
    });
    turns = foldTranscript(turns, { role: 'user', text: 'stop', final: false });

    expect(turns).toHaveLength(2);
    expect(turns[0]?.role).toBe('assistant');
    expect(turns[0]?.text).toBe('You have five messages, the first');
    expect(turns[1]?.text).toBe('stop');
  });

  it('ignores an empty transcript instead of adding a blank bubble', () => {
    // The transcriber emits these between utterances.
    expect(foldTranscript(start, { role: 'user', text: '   ', final: false })).toEqual([]);
  });

  it('does not mutate the array it was given', () => {
    // It feeds a `setState` updater, where mutating the previous value skips
    // the re-render and the transcript silently stops moving.
    const before: TranscriptTurn[] = [{ role: 'user', text: 'hello', final: false }];
    const after = foldTranscript(before, { role: 'user', text: 'hello there', final: true });

    expect(before).toEqual([{ role: 'user', text: 'hello', final: false }]);
    expect(after).not.toBe(before);
  });

  it('trims the text it stores', () => {
    const turns = foldTranscript(start, { role: 'assistant', text: '  Five messages. ', final: true });
    expect(turns[0]?.text).toBe('Five messages.');
  });
});

import { describe, expect, it } from 'vitest';

import { forSpeech } from '../src/lib/speak';

/**
 * What actually gets read out (voice V1).
 *
 * ⚠ The citation markers are in the answer ON PURPOSE and cannot be prompted
 * away: `parseAnswer` decides a refusal by counting them, so a model told not
 * to cite produces an answer that parses as a refusal every time. They are
 * removed here, at the last moment, and the screen still shows the chips.
 *
 * So this function is the seam between "the evidence is intact" and "the
 * listener does not hear brackets". Worth pinning.
 */

describe('forSpeech', () => {
  it('removes a citation marker and the space before it', () => {
    // "meetings [1]." must not become "meetings ." — the stranded space before
    // the full stop is audible as a pause in most engines.
    expect(forSpeech('You have two meetings today [1].')).toBe(
      'You have two meetings today.',
    );
  });

  it('removes runs of markers', () => {
    expect(forSpeech('Three people replied [1][2][4].')).toBe('Three people replied.');
  });

  it('removes markers mid-sentence without joining the words', () => {
    expect(forSpeech('Maria [1] asked for the copy change [2] by Thursday.')).toBe(
      'Maria asked for the copy change by Thursday.',
    );
  });

  it('strips markdown the model sometimes reaches for', () => {
    // Several voices read "*" aloud as "star", which is worse than the emphasis
    // is worth.
    expect(forSpeech('The deadline is **Thursday** at `3pm`.')).toBe(
      'The deadline is Thursday at 3pm.',
    );
  });

  it('leaves an ordinary answer alone', () => {
    const plain = 'You have three meetings today with Dr. Soul and Dr. Yolandi.';
    expect(forSpeech(plain)).toBe(plain);
  });

  it('leaves the refusal sentence intact', () => {
    /*
     * The refusal has no citations by definition, so nothing should touch it.
     * A spoken refusal must remain a recognisable refusal — it is the whole
     * reason voice is allowed to speak at all.
     */
    const refusal = "I don't have anything about that in your messages.";
    expect(forSpeech(refusal)).toBe(refusal);
  });

  it('does not mistake a bracketed number that is not a citation', () => {
    // A real message could contain "[2026]". Only the citation shape is
    // stripped, and this documents where that line sits.
    expect(forSpeech('The invoice reference is [2026] and it is unpaid.')).toBe(
      'The invoice reference is [2026] and it is unpaid.',
    );
  });

  it('returns an empty string for an answer that is only markers', () => {
    // The caller treats empty as "nothing to say" and skips speaking rather
    // than queueing a silent utterance whose `end` event never usefully fires.
    expect(forSpeech('[1][2]')).toBe('');
  });
});

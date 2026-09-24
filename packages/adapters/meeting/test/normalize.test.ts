import { describe, expect, it } from 'vitest';

import { normalizeMeetingTranscript } from '../src/normalize';
import type { MeetingContext, TranscriptTurn } from '../src/types';

/**
 * Normalizing a Recall transcript.
 *
 * ⚠ The shapes below are the ones a REAL transcript has, read back from
 * recording `3299fb14-…` on 2026-09-23 before any of this was written —
 * `absolute` null on every word, `email` null on every participant,
 * `platform` reading "unknown" on a Zoom call. A fixture invented from the
 * documentation would have had none of those, and would have passed.
 */

const STARTED_AT = new Date('2026-09-19T20:28:03.267Z');

const CONTEXT: MeetingContext = {
  recordingId: '3299fb14-bb93-4db3-bb17-a2fa64d29a84',
  startedAt: STARTED_AT,
  title: "Yuriel Chua's Zoom Meeting",
  meetingUrl: 'https://us05web.zoom.us/j/78581577133?pwd=secret',
};

/** A turn, in the real shape. `relative` seconds; `absolute` always null. */
function turn(name: string | null, words: string[], from = 0): TranscriptTurn {
  return {
    participant: {
      id: 1,
      name,
      is_host: true,
      platform: 'unknown',
      email: null,
      extra_data: {},
    },
    words: words.map((text, index) => ({
      text,
      start_timestamp: { relative: from + index, absolute: null },
      end_timestamp: { relative: from + index + 0.5, absolute: null },
    })),
    language_code: 'en',
  };
}

function bodyOf(result: ReturnType<typeof normalizeMeetingTranscript>): string {
  if (!result.ok) throw new Error(`expected ok, got refusal: ${result.reason}`);
  return result.message.bodyText;
}

describe('normalizeMeetingTranscript', () => {
  it('turns words into prose, labelled by speaker', () => {
    const result = normalizeMeetingTranscript(
      [turn('Maria Santos', ['We', 'should', 'ship', 'on', 'Thursday'])],
      CONTEXT,
    );

    expect(bodyOf(result)).toBe('Maria Santos: We should ship on Thursday');
  });

  /*
   * ⚠ The speaker's name is IN the body on purpose. Chunking, embedding, search
   * and extraction all operate on `body_text` and none of them know anything
   * about participants — strip the prefix and an extracted commitment can no
   * longer be traced to a person.
   */
  it('keeps every speaker attributed across turns', () => {
    const body = bodyOf(
      normalizeMeetingTranscript(
        [
          turn('Maria Santos', ['Can', 'we', 'ship', 'Thursday?']),
          turn('Yuriel Chua', ['Yes,', 'the', 'worker', 'is', 'ready.'], 10),
        ],
        CONTEXT,
      ),
    );

    expect(body).toBe('Maria Santos: Can we ship Thursday?\n\nYuriel Chua: Yes, the worker is ready.');
  });

  /*
   * ⚠ Recall splits a turn on a pause, so one person talking for a minute
   * arrives as several turns. Labelling each produces "Yuri: … / Yuri: … /
   * Yuri: …" down the page, which reads as an argument rather than a monologue.
   */
  it('merges consecutive turns by the same speaker', () => {
    const body = bodyOf(
      normalizeMeetingTranscript(
        [
          turn('Yuriel Chua', ['First', 'part.']),
          turn('Yuriel Chua', ['Second', 'part.'], 10),
          turn('Maria Santos', ['Understood.'], 20),
        ],
        CONTEXT,
      ),
    );

    expect(body).toBe('Yuriel Chua: First part. Second part.\n\nMaria Santos: Understood.');
    expect(body.match(/Yuriel Chua:/g)).toHaveLength(1);
  });

  /*
   * ⚠⚠ THE ONE THAT MATTERS MOST.
   *
   * The transcript carries no absolute time on any word — only `relative`
   * seconds from the start of the recording. Read as an epoch, 27.9 becomes
   * 1 Jan 1970, and every utterance sorts correctly among the others, so a
   * meetings-only view looks perfectly normal while being fifty-six years
   * wrong. Same shape as the WhatsApp seconds-versus-milliseconds trap.
   */
  it('dates the meeting from the RECORDING START, never from a relative offset', () => {
    const result = normalizeMeetingTranscript(
      [turn('Maria Santos', ['Hello'], 27.889985829)],
      CONTEXT,
    );

    if (!result.ok) throw new Error(result.reason);
    expect(result.message.sentAt).toEqual(STARTED_AT);
    expect(result.message.sentAt.getUTCFullYear()).toBe(2026);
  });

  /*
   * ⚠ `raw_events` is unique on `(channel_id, external_id)` — migration 0004.
   * Keying on the recording id is what makes a sweep that runs twice over the
   * same finished meeting a no-op instead of a duplicate in the timeline, and
   * it is why this adapter needs no table tracking what it has ingested.
   */
  it('keys on the recording id, so re-ingesting is idempotent', () => {
    const result = normalizeMeetingTranscript([turn('Maria Santos', ['Hello'])], CONTEXT);

    if (!result.ok) throw new Error(result.reason);
    expect(result.message.externalId).toBe(CONTEXT.recordingId);
    expect(result.message.externalThreadId).toBe(CONTEXT.recordingId);
  });

  /*
   * ⚠ Zoom hands over no email address, so the identity is a display name.
   * Lower-cased for the id so "Maria Santos" and "maria santos" are one person,
   * original casing kept for display.
   */
  it('identifies a speaker by name, case-insensitively, with no invented address', () => {
    const result = normalizeMeetingTranscript(
      [turn('Maria Santos', ['One']), turn('maria santos', ['Two'], 10)],
      CONTEXT,
    );

    if (!result.ok) throw new Error(result.reason);
    expect(result.message.sender.externalId).toBe('maria santos');
    expect(result.message.sender.displayName).toBe('Maria Santos');
    expect(result.message.sender.channelType).toBe('meeting');
    // Both turns are the same person, so one recipient — not two.
    expect(result.message.recipients).toHaveLength(1);
  });

  it('lists every speaker as a recipient, once each, in order of first speaking', () => {
    const result = normalizeMeetingTranscript(
      [
        turn('Maria Santos', ['One']),
        turn('Yuriel Chua', ['Two'], 10),
        turn('Maria Santos', ['Three'], 20),
      ],
      CONTEXT,
    );

    if (!result.ok) throw new Error(result.reason);
    expect(result.message.recipients.map((r) => r.displayName)).toEqual([
      'Maria Santos',
      'Yuriel Chua',
    ]);
  });

  /*
   * ⚠ A refusal, not an empty message. `''` is legal for `bodyText` on mail —
   * an attachment-only email genuinely has no text — but a recording with no
   * words is a meeting nobody spoke in or a transcription that failed, and an
   * empty row for it cannot be told apart from a bug.
   */
  it('refuses a transcript with no spoken words rather than writing an empty meeting', () => {
    const result = normalizeMeetingTranscript([turn('Maria Santos', [])], CONTEXT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no spoken words/i);
  });

  it('refuses anything that is not an array', () => {
    for (const bad of [null, undefined, {}, 'transcript', 42]) {
      const result = normalizeMeetingTranscript(bad, CONTEXT);
      expect(result.ok, `${JSON.stringify(bad)} should be refused`).toBe(false);
    }
  });

  it('refuses an unparseable recording start rather than dating a meeting to NaN', () => {
    const result = normalizeMeetingTranscript([turn('Maria Santos', ['Hello'])], {
      ...CONTEXT,
      startedAt: new Date('not a date'),
    });

    expect(result.ok).toBe(false);
  });

  /*
   * Zoom allows joining without a name, so this is a real case rather than a
   * defensive one. It must resolve to something stable rather than to ''.
   */
  it('gives an unnamed participant a stable identity', () => {
    const result = normalizeMeetingTranscript([turn(null, ['Hello'])], CONTEXT);

    if (!result.ok) throw new Error(result.reason);
    expect(result.message.sender.externalId).toBe('unknown-speaker');
    expect(result.message.bodyText).toBe('Unknown speaker: Hello');
  });

  it('uses the meeting title as the subject, and says "Meeting" when there is none', () => {
    const titled = normalizeMeetingTranscript([turn('Maria Santos', ['Hi'])], CONTEXT);
    if (!titled.ok) throw new Error(titled.reason);
    expect(titled.message.subject).toBe("Yuriel Chua's Zoom Meeting");

    const untitled = normalizeMeetingTranscript([turn('Maria Santos', ['Hi'])], {
      ...CONTEXT,
      title: '   ',
    });
    if (!untitled.ok) throw new Error(untitled.reason);
    expect(untitled.message.subject).toBe('Meeting');
  });

  /*
   * ⚠ The meeting URL carries a Zoom password in its query string. It is
   * accepted as context for diagnostics and must never reach the body, the
   * subject, or anything else that renders.
   */
  it('never puts the meeting link, or its password, into the message', () => {
    const result = normalizeMeetingTranscript([turn('Maria Santos', ['Hi'])], CONTEXT);

    if (!result.ok) throw new Error(result.reason);
    const serialised = JSON.stringify(result.message);
    expect(serialised).not.toContain('pwd=');
    expect(serialised).not.toContain('secret');
    expect(serialised).not.toContain('zoom.us');
  });

  it('tidies spacing before punctuation that arrived as its own word', () => {
    const body = bodyOf(
      normalizeMeetingTranscript([turn('Maria Santos', ['Yes', ',', 'agreed', '.'])], CONTEXT),
    );

    expect(body).toBe('Maria Santos: Yes, agreed.');
  });
});

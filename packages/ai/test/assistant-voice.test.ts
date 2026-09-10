import { describe, expect, it } from 'vitest';

import {
  buildAssistantPrompt,
  VOICE_BREVITY_NOTE,
  type RetrievedMessage,
} from '../src/assistant';
import { GROQ_ASSISTANT_MODEL, GROQ_VOICE_MODEL } from '../src/assistant-provider';
import { GROQ_SUMMARY_MODEL } from '../src/groq';

/**
 * The spoken answer (voice V1).
 *
 * ⚠ The first test is the one that matters, and it is not about voice at all:
 * **a typed question must build the byte-identical prompt it built before this
 * feature existed.**
 *
 * The assistant measured `answerable 6/6, must-refuse 7/7` on 2026-08-03, and a
 * full eval costs most of a day's shared token allowance. If the text prompt
 * drifts by so much as a newline, that score stops being a baseline and the
 * next measurement compares against nothing. This file is what makes the drift
 * fail a test instead of being noticed a month later — the same job
 * `derivedNote` has, tested the same way.
 */

const NOW = new Date('2026-09-10T02:00:00.000Z');

const message = (
  overrides: Partial<RetrievedMessage> & { messageId: string; similarity: number },
): RetrievedMessage => ({
  subject: 'Subject',
  content: 'Some retrieved chunk text.',
  bodyText: 'Some retrieved chunk text.',
  sentAt: '2026-09-01T10:00:00.000Z',
  direction: 'inbound',
  senderName: 'Someone',
  senderRef: 'someone@example.com',
  channelLabel: 'Gmail',
  ...overrides,
});

const context = [
  message({ messageId: 'm1', similarity: 0.87 }),
  message({ messageId: 'm2', similarity: 0.85, subject: 'Another' }),
];

describe('buildAssistantPrompt — the text path is untouched', () => {
  it('builds the same prompt with no mode as with mode "text"', () => {
    // The default argument is the guarantee. If someone changes the signature
    // so `mode` stops defaulting to 'text', this is what catches it.
    expect(buildAssistantPrompt('any question', context, NOW)).toBe(
      buildAssistantPrompt('any question', context, NOW, 'text'),
    );
  });

  it('adds nothing at all to a text prompt — not even a blank line', () => {
    const text = buildAssistantPrompt('any question', context, NOW, 'text');

    // The failure this guards against is subtle: pushing the note into the
    // array unconditionally, even as '', appends a newline to EVERY prompt.
    expect(text.endsWith('Question: any question')).toBe(true);
    expect(text).not.toContain('READ ALOUD');
  });

  it('a voice prompt is the text prompt plus the note, and nothing else', () => {
    const text = buildAssistantPrompt('any question', context, NOW, 'text');
    const voice = buildAssistantPrompt('any question', context, NOW, 'voice');

    // Not "contains the note" — exactly the text prompt, then the note. That
    // rules out any other difference sneaking into the voice branch.
    expect(voice).toBe(`${text}\n\n${VOICE_BREVITY_NOTE}`);
  });
});

describe('VOICE_BREVITY_NOTE', () => {
  it('tells the model to keep citing', () => {
    /*
     * ⚠ The whole reason this note is worded the way it is.
     *
     * `parseAnswer` decides a refusal by counting citations, so a note that
     * said "do not cite, you are being read aloud" would make EVERY spoken
     * answer parse as a refusal. The markers are stripped in the browser
     * instead, just before speaking.
     */
    expect(VOICE_BREVITY_NOTE).toMatch(/citation markers/i);
    expect(VOICE_BREVITY_NOTE).toMatch(/rule 3/i);
  });

  it('asks for brevity with a concrete limit', () => {
    // "Be brief" is not an instruction a model can check itself against.
    expect(VOICE_BREVITY_NOTE).toMatch(/40 words/);
  });

  it('keeps the refusal path intact', () => {
    // Ms. Maria asked for short spoken answers. She did not ask for the
    // refusal to be softened, and a spoken guess is worse than a written one.
    expect(VOICE_BREVITY_NOTE).toMatch(/rule 2/i);
  });
});

describe('GROQ_VOICE_MODEL', () => {
  it('is not the assistant model, so it cannot eat the assistant budget', () => {
    /*
     * The point of the flag. Groq's limits are per-model, and the 70B's
     * allowance is roughly 30 questions a day shared by every tenant. If these
     * two ever became the same string the isolation would be gone and nothing
     * would look wrong until a demo ran dry.
     */
    expect(GROQ_VOICE_MODEL).not.toBe(GROQ_ASSISTANT_MODEL);
  });

  it('is the 8B model, the same one summaries and extraction already use', () => {
    // Known behaviour on this corpus rather than a third model nobody has run.
    expect(GROQ_VOICE_MODEL).toBe(GROQ_SUMMARY_MODEL);
  });
});

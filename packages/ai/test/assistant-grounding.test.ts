import { describe, expect, it } from 'vitest';

import { CASES } from '../../../apps/worker/scripts/eval-cases';
import {
  buildAssistantPrompt,
  isTimeQuestion,
  MAX_CONTEXT_MESSAGES,
  mergeDerivedContext,
  selectContext,
  type RetrievedMessage,
} from '../src/assistant';

/**
 * ADR-020, the narrow version: extraction rows in the assistant's context.
 *
 * ⚠ ADR-020 is accepted only in its narrow form and it names the risk precisely:
 * the change "reopens the refusal" ADR-016 placed entirely on the model, and the
 * refusal is the property `docs/01-PRODUCT-SPEC.md` §7 judges the product on.
 * The model half is measured by the eval, once a day, on a token budget that
 * allows one full run. **Everything deterministic is pinned here instead**, for
 * free, so the paid measurement is spent only on what genuinely needs it.
 */

const message = (
  overrides: Partial<RetrievedMessage> & { messageId: string; similarity: number },
): RetrievedMessage => ({
  subject: 'Subject',
  content: 'Some retrieved chunk text.',
  bodyText: 'Some retrieved chunk text.',
  sentAt: '2026-08-01T10:00:00.000Z',
  direction: 'inbound',
  senderName: 'Someone',
  senderRef: 'someone@example.com',
  channelLabel: 'Gmail',
  ...overrides,
});

const detected = (
  overrides: Partial<RetrievedMessage> & { messageId: string },
): RetrievedMessage =>
  message({
    similarity: 1,
    content: 'Confirming our project sync on Friday 7 August 2026 at 3:00 PM.',
    derived: { kind: 'meeting', startsAt: '2026-08-07T07:00:00.000Z', dueAt: null },
    ...overrides,
  });

describe('isTimeQuestion', () => {
  it('fires on the question this whole ADR exists for', () => {
    expect(isTimeQuestion('Do I have any upcoming meetings?')).toBe(true);
  });

  it.each([
    'What meetings do I have next week?',
    'When is the deadline for the report?',
    'Is anything due tomorrow?',
    'What is on my calendar?',
    'What am I supposed to be doing today?',
  ])('fires on %j', (question) => {
    expect(isTimeQuestion(question)).toBe(true);
  });

  /*
   * Deliberate under-triggering, recorded so it is not "fixed" by accident.
   *
   * Each of these is arguably about the reader's schedule, and each was dropped
   * from the predicate because the word that would catch it also appears
   * constantly in ordinary mail. Under-triggering costs nothing: the assistant
   * falls back to the behaviour measured at answerable 6/6, which is the
   * behaviour it has today. Over-triggering costs a wrong answer built out of
   * an unrelated calendar row.
   */
  it.each([
    'Is the delivery scheduled?',
    'Did we book anything with the supplier?',
  ])('deliberately does NOT fire on %j', (question) => {
    expect(isTimeQuestion(question)).toBe(false);
  });

  /*
   * ⚠ The guard against over-triggering, and it is the one that matters.
   *
   * "When did the deploy fail?" is a question ABOUT TIME that must NOT pull in
   * calendar rows: it is answerable from the mail, and handing it an unrelated
   * meeting is exactly how a confident wrong answer gets assembled. A predicate
   * keyed on any temporal word would take this.
   */
  it.each([
    'When did the deploy fail?',
    'What failed in CI?',
    'Did I receive any money or payments?',
    'What has Supabase told me about my projects?',
    'Are there any job openings or hiring emails?',
  ])('does NOT fire on %j', (question) => {
    expect(isTimeQuestion(question)).toBe(false);
  });

  /*
   * ⚠⚠ THE CONTROL FOR THE WHOLE EXPERIMENT.
   *
   * The eval's eight must-refuse cases are what prove the refusal still holds.
   * They are only a valid control if this change cannot touch them — if
   * `isTimeQuestion` returned true for even one, its prompt would differ between
   * the 2026-08-03 baseline (must-refuse 7/7) and the run that measures this
   * feature, and a move in that score would no longer mean what it appears to.
   *
   * Reading the real case list rather than a copy is deliberate: a copy would
   * keep passing after someone adds a ninth refusal case about a meeting.
   */
  it('fires on NONE of the eval must-refuse cases', () => {
    const triggered = CASES.filter(
      (testCase) => testCase.expect === 'refuse' && isTimeQuestion(testCase.question),
    ).map((testCase) => testCase.question);

    expect(
      triggered,
      'These must-refuse cases would take the ADR-020 path, so they could no\n' +
        'longer act as a control for it. Either tighten isTimeQuestion, or accept\n' +
        'that the before/after comparison of must-refuse is no longer apples to\n' +
        'apples and say so in the ADR.\n  ' +
        triggered.join('\n  '),
    ).toEqual([]);
  });

  it('finds the must-refuse cases at all', () => {
    // Guards the test above against passing because the filter found nothing.
    expect(CASES.filter((c) => c.expect === 'refuse').length).toBeGreaterThan(4);
  });
});

describe('mergeDerivedContext', () => {
  it('puts detected items first, ahead of better-scoring chunks', () => {
    const merged = mergeDerivedContext(
      [detected({ messageId: 'meeting' })],
      [message({ messageId: 'chunk', similarity: 0.9 })],
    );

    expect(merged.map((row) => row.messageId)).toEqual(['meeting', 'chunk']);
  });

  it('never grows the context beyond the retrieval cap', () => {
    // The daily allowance is ~30 questions at ~3,200 tokens. Silently adding
    // three more blocks to every time question would cut that, and nothing in
    // the UI would show why.
    const merged = mergeDerivedContext(
      [
        detected({ messageId: 'd1' }),
        detected({ messageId: 'd2' }),
        detected({ messageId: 'd3' }),
      ],
      Array.from({ length: 8 }, (_, i) =>
        message({ messageId: `m${i}`, similarity: 0.9 - i * 0.001 }),
      ),
    );

    expect(merged).toHaveLength(MAX_CONTEXT_MESSAGES);
  });

  it('caps how many slots detected items may take', () => {
    const merged = mergeDerivedContext(
      Array.from({ length: 6 }, (_, i) => detected({ messageId: `d${i}` })),
      [message({ messageId: 'chunk', similarity: 0.9 })],
    );

    expect(merged.filter((row) => row.derived)).toHaveLength(3);
    // The retrieved message still gets in — extractions must not crowd out the
    // corpus entirely, or a time question is answered from inferences alone.
    expect(merged.some((row) => row.messageId === 'chunk')).toBe(true);
  });

  it('does not list one message twice', () => {
    // The same message arriving as both a chunk and an extraction would get two
    // numbers in a list the model cites BY number, so "[2] and [5]" could be one
    // source presented as corroboration.
    const merged = mergeDerivedContext(
      [detected({ messageId: 'same' })],
      [message({ messageId: 'same', similarity: 0.9 })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]!.derived).toBeDefined();
  });

  /*
   * ⚠ The reason this is a separate step and not a change to selectContext.
   *
   * An extraction has no similarity. Giving it 1.0 and passing it through the
   * floors would make it the best hit, and RELATIVE_FLOOR (0.035) would then
   * measure every real message against 1.0 and drop all of them — the assistant
   * would answer time questions from extractions ALONE, having silently
   * discarded the corpus, with nothing in the output showing it.
   */
  it('leaves the floors operating on retrieval alone', () => {
    const retrieved = [
      message({ messageId: 'a', similarity: 0.86 }),
      message({ messageId: 'b', similarity: 0.85 }),
    ];

    const viaFloors = selectContext(retrieved);
    expect(viaFloors).toHaveLength(2);

    const merged = mergeDerivedContext([detected({ messageId: 'd' })], viaFloors);
    expect(merged.map((r) => r.messageId)).toEqual(['d', 'a', 'b']);

    // The trap, stated as an assertion: had the detected row gone through the
    // floors at similarity 1, both real messages would have been cut.
    expect(selectContext([...retrieved, detected({ messageId: 'd' })])).toHaveLength(1);
  });
});

describe('buildAssistantPrompt with detected items', () => {
  it('labels a detected item and does not pass it off as a sent message', () => {
    const prompt = buildAssistantPrompt(
      'Do I have any upcoming meetings?',
      [detected({ messageId: 'm1' })],
      new Date('2026-08-03T08:00:00.000Z'),
    );

    expect(prompt).toContain('DETECTED meeting');
    expect(prompt).toContain('Sentence it was taken from:');
    expect(prompt).toContain('Rely on the quoted');
  });

  /*
   * ⚠ The prompt for a non-time question must be BYTE-IDENTICAL to the one
   * measured at answerable 6/6 / must-refuse 7/7 on 2026-08-03.
   *
   * This is why the explanation lives in the user turn rather than in
   * ASSISTANT_SYSTEM_PROMPT: a system-prompt change would alter all sixteen
   * cases, and the eight refusals would stop being a control.
   */
  it('adds nothing at all when no detected item is present', () => {
    const context = [message({ messageId: 'm1', similarity: 0.9 })];
    const now = new Date('2026-08-03T08:00:00.000Z');

    const prompt = buildAssistantPrompt('What failed in CI?', context, now);

    expect(prompt).not.toContain('DETECTED');
    expect(prompt).not.toContain('Sentence it was taken from');
    expect(prompt).not.toContain('Rely on the quoted');
  });

  it('sends the quote, never a title the model composed', () => {
    const prompt = buildAssistantPrompt(
      'Do I have any upcoming meetings?',
      [
        detected({
          messageId: 'm1',
          content: 'Confirming our project sync on Friday 7 August 2026 at 3:00 PM.',
        }),
      ],
      new Date('2026-08-03T08:00:00.000Z'),
    );

    expect(prompt).toContain('Confirming our project sync on Friday 7 August 2026');
  });
});

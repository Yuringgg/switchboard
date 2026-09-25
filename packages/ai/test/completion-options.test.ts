import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ASSISTANT_COMPLETION_OPTIONS, GROQ_ASSISTANT_MODEL, GROQ_SUMMARY_MODEL, SUMMARY_COMPLETION_OPTIONS } from '../src';

/**
 * What the summary and assistant requests ask a REASONING model for.
 *
 * ⚠ On 2026-09-20 Groq removed the Llama models and both workloads moved to
 * `openai/gpt-oss-*`, whose thinking is billed out of the same `max_tokens` as
 * the answer. Extraction was re-measured and given `reasoningEffort: 'low'`;
 * summaries and the assistant kept `groq.ts`'s default of 160 tokens and
 * default reasoning, which on a reasoning model leaves no room for the answer.
 * No summary was written after 2026-08-14.
 */
describe('completion options on the gpt-oss models', () => {
  it('both workloads really are on reasoning models — or these options are moot', () => {
    expect(GROQ_SUMMARY_MODEL).toMatch(/gpt-oss/);
    expect(GROQ_ASSISTANT_MODEL).toMatch(/gpt-oss/);
  });

  for (const [name, options] of [
    ['summaries', SUMMARY_COMPLETION_OPTIONS],
    ['the assistant', ASSISTANT_COMPLETION_OPTIONS],
  ] as const) {
    it(`${name}: thinking is limited, and there is room left to answer`, () => {
      expect(options.reasoningEffort).toBe('low');
      // 160 is the default that failed; at or under it fails the same way.
      expect(options.maxTokens).toBeGreaterThan(160);
    });
  }

  /*
   * A constant nobody passes fixes nothing. The console's call site is the one
   * place the assistant's request is built, and it is outside this package, so
   * it is pinned by reading it.
   */
  it('the console passes ASSISTANT_COMPLETION_OPTIONS on the assistant call', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'apps', 'console', 'src', 'lib', 'assistant.ts'),
      'utf8',
    );
    expect(source).toMatch(
      /provider\.complete\(\s*ASSISTANT_SYSTEM_PROMPT,[\s\S]*?ASSISTANT_COMPLETION_OPTIONS,\s*\)/,
    );
  });
});

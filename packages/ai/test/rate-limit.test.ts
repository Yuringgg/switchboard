import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGroqProvider } from '../src/groq';

/**
 * Which limit ran out, and therefore what a person gets told.
 *
 * ⚠ The distinction is not cosmetic. A per-minute window clears in seconds; the
 * **daily** allowance is what actually binds this project — roughly 30 questions
 * — and telling someone to "try again in a moment" when it is gone sends them
 * clicking Ask at a wall for hours.
 *
 * The two are near-indistinguishable from outside, which is the whole problem: a
 * daily-token rejection arrives carrying a **full** per-minute budget
 * (`x-ratelimit-remaining-tokens: 12000`, observed twice on 2026-08-02). The
 * bodies below are the real shape, recorded by provoking an actual 429 against
 * the live API on the summaries model so the assistant's budget was untouched.
 */

const RPM_BODY = JSON.stringify({
  error: {
    message:
      'Rate limit reached for model `llama-3.1-8b-instant` in organization `org_x` ' +
      'service tier `on_demand` on requests per minute (RPM): Limit 30, Used 30, ' +
      'Requested 1. Please try again in 2s. Need more tokens? Upgrade to Dev Tier today',
    type: 'requests',
    code: 'rate_limit_exceeded',
  },
});

const TPD_BODY = JSON.stringify({
  error: {
    message:
      'Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_x` ' +
      'service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 99988, ' +
      'Requested 3200. Please try again in 26m5.86s.',
    type: 'tokens',
    code: 'rate_limit_exceeded',
  },
});

const TPM_BODY = JSON.stringify({
  error: {
    message:
      'Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_x` ' +
      'service tier `on_demand` on tokens per minute (TPM): Limit 12000, Used 11800, ' +
      'Requested 3200. Please try again in 4.2s.',
    type: 'tokens',
    code: 'rate_limit_exceeded',
  },
});

function stubResponse(
  body: string,
  headers: Record<string, string> = {},
  status = 429,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status, headers })),
  );
}

async function ask() {
  const provider = createGroqProvider({ apiKey: 'test-key' });
  return provider.complete('system', 'user');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('groq rate-limit scope', () => {
  it('reads a per-minute REQUEST limit from the body', async () => {
    stubResponse(RPM_BODY, { 'retry-after': '2' });
    const result = await ask();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.limitScope).toBe('minute');
    expect(result.retryable).toBe(true);
    expect(result.retryAfterMs).toBe(2000);
  });

  it('reads a per-minute TOKEN limit from the body', async () => {
    stubResponse(TPM_BODY, { 'retry-after': '4.2' });
    const result = await ask();

    if (result.ok) throw new Error('expected failure');
    expect(result.limitScope).toBe('minute');
    // ⚠ Fractional. parseInt would round 4.2 to 4 and 429 again immediately.
    expect(result.retryAfterMs).toBe(4200);
  });

  /**
   * ⚠ The case the old copy got wrong, and the one that actually happens here.
   *
   * Note the headers: a FULL per-minute token budget, and the request still
   * rejected. Every visible signal says the assistant is healthy. Only the
   * body's `(TPD)` says otherwise.
   */
  it('reads the DAILY token limit even when the per-minute budget is full', async () => {
    stubResponse(TPD_BODY, {
      'retry-after': '1566',
      'x-ratelimit-remaining-tokens': '12000',
      'x-ratelimit-remaining-requests': '968',
    });
    const result = await ask();

    if (result.ok) throw new Error('expected failure');
    expect(result.limitScope).toBe('day');
    expect(result.reason).toContain('daily allowance');
  });

  it('falls back to retry-after when the wording changes', async () => {
    // Groq reworded the message. A per-minute window cannot need more than 60s
    // to clear, so a longer wait is a longer-horizon limit.
    stubResponse('{"error":{"message":"too many"}}', { 'retry-after': '900' });
    const result = await ask();

    if (result.ok) throw new Error('expected failure');
    expect(result.limitScope).toBe('day');
  });

  it('treats a short unrecognised wait as the per-minute window', async () => {
    stubResponse('{"error":{"message":"too many"}}', { 'retry-after': '5' });
    const result = await ask();

    if (result.ok) throw new Error('expected failure');
    expect(result.limitScope).toBe('minute');
  });

  it('says "unknown" rather than guessing when there is nothing to go on', async () => {
    // Inventing a scope here would put a confident wrong sentence in front of a
    // user. The console words this case without a time estimate.
    stubResponse('{"error":{"message":"too many"}}');
    const result = await ask();

    if (result.ok) throw new Error('expected failure');
    expect(result.limitScope).toBe('unknown');
  });

  it('sets no limit scope on a non-429 failure', async () => {
    // 500 is Groq being unwell, not a quota. Attaching a scope would make the
    // console offer a quota explanation for an outage.
    stubResponse('{"error":{"message":"boom"}}', {}, 500);
    const result = await ask();

    if (result.ok) throw new Error('expected failure');
    expect(result.limitScope).toBeUndefined();
    expect(result.retryable).toBe(true);
  });

  it('does not put the error body in the reason', async () => {
    // ⚠ The body is read only to classify the limit and is discarded. An error
    // body from a completion API can echo the prompt, and the prompt is a
    // message body — docs/02-ARCHITECTURE.md §6.
    stubResponse(TPD_BODY, { 'retry-after': '1566' });
    const result = await ask();

    if (result.ok) throw new Error('expected failure');
    expect(result.reason).not.toContain('organization');
    expect(result.reason).not.toContain('Used 99988');
  });

  it('does not read the body at all on a 400', async () => {
    // A malformed-request body is the one most likely to echo the prompt.
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await ask();

    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('groq http 400');
    expect(result.retryable).toBe(false);
  });
});

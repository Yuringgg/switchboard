import { describe, expect, it } from 'vitest';

// Relative, matching every other test here: the `@/` alias is a Next/tsconfig
// path and vitest does not resolve it.
import { rateLimitMessage } from '../src/lib/assistant';

/**
 * What a person is told when the assistant refuses on quota.
 *
 * ⚠ This is user-facing copy under test because it was **wrong**, and wrong in
 * the direction that wastes someone's evening. The single sentence it replaced —
 * *"The assistant is busy right now. Try again in a moment."* — is correct for
 * the per-minute window and misleading for the daily allowance, which is the
 * limit that actually binds this project at ~30 questions a day.
 *
 * Confirmed against the live API on 2026-08-02, after the fix:
 *
 *     groq rate limit (daily allowance; tokens left this window: 12000)
 *
 * A **full** per-minute budget, refused. Every visible signal said the
 * assistant was healthy; only the 429 body said otherwise.
 */

describe('rateLimitMessage', () => {
  it('does not tell someone to retry in a moment when the day is gone', () => {
    const message = rateLimitMessage('day', undefined);

    expect(message).toMatch(/daily/i);
    expect(message).toMatch(/today/i);
    // The exact failure this replaced.
    expect(message).not.toMatch(/in a moment/i);
  });

  it('points at what still works, so the console does not read as down', () => {
    // Search, the timeline and summaries have no such limit — embeddings are
    // local and cannot fail at all. Saying so is the difference between "the
    // assistant is rationed" and "the product is broken".
    const message = rateLimitMessage('day', undefined);

    expect(message).toMatch(/search/i);
  });

  it('uses the provider\'s own wait when it gives one', () => {
    expect(rateLimitMessage('day', 1_566_000)).toMatch(/26 minutes/);
    expect(rateLimitMessage('minute', 4_200)).toMatch(/5 seconds/);
  });

  /**
   * ⚠ No claim is made about WHEN a daily allowance returns.
   *
   * Groq's buckets replenish continuously rather than resetting on a clock —
   * measured from the live headers, one request costs `reset-requests: 1m26.4s`,
   * which is exactly 86400/1000. "Resets at midnight UTC" would be a confident
   * falsehood, and a confident falsehood is worse than the vague truth.
   */
  it('never claims a midnight reset', () => {
    for (const ms of [undefined, 60_000, 1_566_000]) {
      expect(rateLimitMessage('day', ms)).not.toMatch(/midnight|UTC|tomorrow at/i);
    }
  });

  it('says something short and non-committal for the per-minute window', () => {
    const message = rateLimitMessage('minute', undefined);

    expect(message).not.toMatch(/daily|today/i);
    expect(message.length).toBeLessThan(120);
  });

  it('invents no horizon when the provider did not say which limit', () => {
    // 'unknown' is a real outcome — a provider may rate-limit without saying
    // which limit, and guessing would put a confident wrong sentence on screen.
    const message = rateLimitMessage('unknown', undefined);

    expect(message).not.toMatch(/daily|today/i);
    expect(message).not.toMatch(/\d+ (second|minute|hour)/);
  });

  it('handles a missing scope the same cautious way', () => {
    // A retryable failure that is not a quota at all — a timeout, a 5xx.
    expect(rateLimitMessage(undefined, undefined)).not.toMatch(/daily|today/i);
  });
});

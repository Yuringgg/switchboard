/**
 * The two provider interfaces (ADR-003).
 *
 * Two rather than one, because generation and embedding have genuinely
 * different characteristics and splitting them isolates failure: embedding is
 * the high-volume path and runs locally, so if a remote provider degrades,
 * search keeps working and only the assistant's answers are affected. Under one
 * combined provider an outage takes out both.
 */

export interface CompletionOptions {
  /** Upper bound on the reply. A summary that runs long is a failed summary. */
  maxTokens?: number;
  /** 0 for anything that must be reproducible. Summaries are. */
  temperature?: number;
  /** Abort rather than hold an ingest event open. */
  timeoutMs?: number;
}

/**
 * A completion result, reported rather than thrown.
 *
 * ⚠ The same rule as `normalize` in every adapter, for the same reason: this is
 * called from inside the worker's event loop, and a throw fails the whole queued
 * event, burns one of its attempts, and parks every message behind it. A summary
 * is **additive** — if the provider is down, rate-limited or slow, the message
 * must still ingest and appear. Losing the summary is a degradation; losing the
 * mail is an outage.
 */
/**
 * Which of a provider's limits ran out.
 *
 * ⚠ This is a user-facing distinction, not a diagnostic nicety. "The assistant
 * is busy right now, try again in a moment" is correct for a per-minute window
 * and **actively misleading** for a daily allowance, where the honest answer is
 * closer to "not until tomorrow". Telling someone to retry in a moment when the
 * budget is gone for the day sends them clicking at a wall.
 *
 * `'unknown'` is a real and expected value — a provider may rate-limit without
 * saying which limit, and inventing a scope would be worse than admitting one is
 * not known. The console words that case without a time estimate.
 */
export type LimitScope = 'minute' | 'day' | 'unknown';

export type CompletionResult =
  | { ok: true; text: string; model: string }
  | {
      ok: false;
      reason: string;
      retryable: boolean;
      /**
       * How long the provider asked us to wait, from its `retry-after` header.
       *
       * Present only on a rate limit. It is the difference between a backfill
       * that stops for the day and one that pauses for eleven seconds — and
       * the number comes from the provider rather than from a guess, which
       * matters because the binding limit here is tokens-per-minute and its
       * reset is a sliding window, not a fixed one.
       */
      retryAfterMs?: number;
      /** Set only on a rate limit (HTTP 429). See `LimitScope`. */
      limitScope?: LimitScope;
    };

export interface CompletionProvider {
  /** Which model produced a result — recorded on every row (ADR-006). */
  readonly model: string;
  complete(
    system: string,
    user: string,
    options?: CompletionOptions,
  ): Promise<CompletionResult>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

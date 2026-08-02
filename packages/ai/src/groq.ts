import type {
  CompletionOptions,
  CompletionProvider,
  CompletionResult,
} from './provider';

/**
 * Groq, for the many-small-prompts workload (ADR-003).
 *
 * ── ⚠ Deviation from `docs/02-ARCHITECTURE.md` §8, stated not smuggled ───────
 *
 * §8 names **groq-sdk**. This uses native `fetch`, and §8 permits deviating
 * "only with a reason" — here is the reason.
 *
 * The worker is bundled by tsup into a single self-contained file, and this
 * project has already lost a container to a dependency that could not survive
 * that: importing `@switchboard/adapter-gmail` at the package root pulls in
 * `google-auth-library`, which crashes the worker at startup.
 * `apps/worker/test/import-boundary.test.ts` exists solely to stop that
 * recurring. Groq's API is OpenAI-compatible REST — literally one POST with a
 * JSON body — so the SDK would buy nothing here and would put another
 * transitive tree inside that same bundle.
 *
 * Native fetch also gives explicit `AbortController` control, which matters
 * more than it sounds: this call sits inside the worker's event loop, and a
 * request that hangs holds a queued event open behind it.
 *
 * If the assistant later needs streaming or tool calls, revisit — for one
 * bounded prompt per message it is thirty lines and no dependency.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * ⚠ `llama-3.1-8b-instant`, and NOT `llama-3.3-70b-versatile`.
 *
 * Verified against the live API on 2026-08-02 by reading the rate-limit
 * headers rather than trusting a docs page:
 *
 *   llama-3.1-8b-instant      x-ratelimit-limit-requests: 14400
 *   llama-3.3-70b-versatile   x-ratelimit-limit-requests:  1000
 *
 * The 70B's daily allowance is a fourteenth of the general one, and a single
 * backfill over a real mailbox would eat a meaningful fraction of it — then
 * live summarisation, the thing that actually has to keep working, would fail
 * for the rest of the day. `docs/04-ROADMAP.md` flags this exact trap.
 *
 * Summarising one short message is not a task that needs a 70B model. If
 * quality ever proves otherwise, the answer is a better prompt before a bigger
 * model.
 */
export const GROQ_SUMMARY_MODEL = 'llama-3.1-8b-instant';

export interface GroqOptions {
  apiKey: string;
  model?: string;
}

export function createGroqProvider({
  apiKey,
  model = GROQ_SUMMARY_MODEL,
}: GroqOptions): CompletionProvider {
  return {
    model,

    async complete(
      system: string,
      user: string,
      options: CompletionOptions = {},
    ): Promise<CompletionResult> {
      const { maxTokens = 160, temperature = 0.2, timeoutMs = 15_000 } = options;

      // A hung request holds a queued event open behind it, so the timeout is
      // not defensive — it is what keeps one slow call from stalling ingest.
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);

      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature,
            max_tokens: maxTokens,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          signal: abort.signal,
        });

        if (!response.ok) {
          /*
           * Retryable is a real distinction, not a label.
           *
           * 429 is the daily or per-minute quota, and 5xx is Groq being
           * unwell — both pass. 400/401/403 mean the request or the key is
           * wrong, and re-sending an identical bad request burns quota to
           * fail identically. The caller uses this to decide whether a
           * backfill should pause or stop.
           */
          const retryable = response.status === 429 || response.status >= 500;

          // ⚠ The status and nothing else. An error body from a completion API
          // can echo the prompt back, and the prompt is a message body.
          // docs/02-ARCHITECTURE.md §6: never log message content.
          return {
            ok: false,
            reason: `groq http ${response.status}`,
            retryable,
          };
        }

        const body = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
        };

        const text = body.choices?.[0]?.message?.content?.trim();

        // A 200 with no content is possible — a stop sequence hit immediately,
        // or a content filter. Reported as a failure rather than stored as an
        // empty summary, because an empty summary renders as a blank labelled
        // block, which reads as broken rendering rather than as no answer.
        if (!text) {
          return { ok: false, reason: 'groq returned an empty completion', retryable: true };
        }

        return { ok: true, text, model };
      } catch (cause) {
        // AbortError is the timeout above; anything else is the network.
        const aborted = cause instanceof Error && cause.name === 'AbortError';
        return {
          ok: false,
          reason: aborted ? `groq timed out after ${timeoutMs}ms` : 'groq request failed',
          retryable: true,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

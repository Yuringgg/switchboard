import type {
  CompletionOptions,
  CompletionProvider,
  CompletionResult,
} from './provider';

/**
 * Gemini 2.5 Flash, for the assistant's long RAG prompts (ADR-003).
 *
 * Chosen over Groq on the numbers, not on preference: a retrieval prompt
 * carrying a dozen messages runs 4,000–8,000 tokens, and Groq's 70B allows
 * 12,000 tokens/min — roughly two questions a minute. Gemini allows **250,000
 * tokens/min** with a 1M-token context window, which is about 20× the headroom
 * and makes retrieval tuning far less fragile.
 *
 * ⚠ **KEEP BILLING DISABLED on the Gemini project.** Enabling it permanently
 * destroys the free tier — every call becomes billable from the first token,
 * with no undo. `docs/03-RESOURCES.md` §4a.
 *
 * Native `fetch` rather than `@google/genai`, for the same reason `groq.ts`
 * uses it: this package is imported by a worker that tsup bundles into a single
 * file, and every dependency added to that bundle is a chance to repeat the
 * `google-auth-library` crash. One POST does not need an SDK.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const GEMINI_ASSISTANT_MODEL = 'gemini-2.5-flash';

export interface GeminiOptions {
  apiKey: string;
  model?: string;
}

export function createGeminiProvider({
  apiKey,
  model = GEMINI_ASSISTANT_MODEL,
}: GeminiOptions): CompletionProvider {
  return {
    model,

    async complete(
      system: string,
      user: string,
      options: CompletionOptions = {},
    ): Promise<CompletionResult> {
      const { maxTokens = 800, temperature = 0.1, timeoutMs = 30_000 } = options;

      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);

      try {
        const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            // The system turn is a first-class field, not a prefixed user
            // message. It is what the model is told to weight above the
            // conversation — which matters here because the "conversation"
            // contains message bodies written by third parties.
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: {
              temperature,
              maxOutputTokens: maxTokens,
              /*
               * ⚠ Thinking OFF, and it is not only about latency.
               *
               * 2.5 Flash reasons before answering by default, and those
               * thinking tokens are charged against `maxOutputTokens`. Left on
               * with a modest budget, the model can spend the entire allowance
               * thinking and return a **200 with an empty answer** — which
               * reads as "the assistant said nothing" rather than as a
               * configuration mistake. Grounded extraction from supplied
               * context is not a task that needs it.
               */
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          signal: abort.signal,
        });

        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          const retryAfter = Number.parseFloat(response.headers.get('retry-after') ?? '');

          // ⚠ Status only. An error body from a completion API can echo the
          // prompt, and this prompt contains message bodies.
          // docs/02-ARCHITECTURE.md §6.
          return {
            ok: false,
            reason: `gemini http ${response.status}`,
            retryable,
            ...(Number.isFinite(retryAfter) && retryAfter > 0
              ? { retryAfterMs: Math.ceil(retryAfter * 1000) }
              : {}),
          };
        }

        const body = (await response.json()) as {
          candidates?: {
            content?: { parts?: { text?: string }[] };
            finishReason?: string;
          }[];
          promptFeedback?: { blockReason?: string };
        };

        // A safety block returns 200 with no candidate. Reported as a failure
        // rather than as an empty answer, because an empty answer rendered in
        // the console is indistinguishable from a broken component.
        if (body.promptFeedback?.blockReason) {
          return {
            ok: false,
            reason: `gemini blocked the prompt (${body.promptFeedback.blockReason})`,
            retryable: false,
          };
        }

        const candidate = body.candidates?.[0];
        const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('').trim();

        if (!text) {
          return {
            ok: false,
            reason: `gemini returned no text (finishReason: ${candidate?.finishReason ?? 'none'})`,
            retryable: true,
          };
        }

        return { ok: true, text, model };
      } catch (cause) {
        const aborted = cause instanceof Error && cause.name === 'AbortError';
        return {
          ok: false,
          reason: aborted ? `gemini timed out after ${timeoutMs}ms` : 'gemini request failed',
          retryable: true,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

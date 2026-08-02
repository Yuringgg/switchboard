import { createGeminiProvider } from './gemini';
import { createGroqProvider } from './groq';
import type { CompletionProvider } from './provider';

/**
 * Which model answers assistant questions.
 *
 * ── ⚠ AMENDS ADR-003, ON MEASURED NUMBERS ───────────────────────────────────
 *
 * ADR-003 routed assistant Q&A to **Gemini 2.5 Flash**, on the reasoning that
 * Groq's 12,000 tokens/min allowed "roughly two questions per minute and ~15
 * per day", while Gemini offered 250,000 TPM and 250 requests/day. That was
 * correct when written. It is not correct now.
 *
 * Measured against the live API on 2026-08-02, from the quota error itself:
 *
 *     "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
 *     "quotaValue": "20", "model": "gemini-2.5-flash"
 *
 * **Twenty requests per day.** Not 250 — `docs/03-RESOURCES.md` §4a recorded
 * 250 and it has since been cut by more than 12×, which that file already
 * warned was Google's habit ("cut free quotas 50–80% in December 2025 without
 * notice"). Twenty questions a day cannot support a demo, let alone development
 * against it: this project's own 15-case eval consumes 75% of a day in one run.
 *
 * Groq's per-model daily limits, verified the same way:
 *
 *   llama-3.3-70b-versatile   1,000 req/day · 12,000 TPM
 *   llama-3.1-8b-instant     14,400 req/day ·  6,000 TPM
 *
 * ADR-003's arithmetic also assumed a retrieval prompt of 4,000–8,000 tokens
 * carrying ~20 messages. This design sends at most **8** (`MAX_CONTEXT_MESSAGES`)
 * and one chunk each, which measures around 2,000–3,000 tokens — so 12,000 TPM
 * is roughly four questions a minute, not two.
 *
 * **So the default is Groq's 70B**: fifty times Gemini's daily allowance, a
 * comfortable per-minute budget at this prompt size, and a materially stronger
 * model than the 8B that writes summaries.
 *
 * ── What is deliberately preserved from ADR-003 ─────────────────────────────
 *
 * **Summaries and the assistant stay on different models.** Groq's limits are
 * per-model, so the assistant on `llama-3.3-70b-versatile` and summarisation on
 * `llama-3.1-8b-instant` cannot exhaust each other — which is exactly the
 * failure-isolation argument ADR-003 made for splitting providers, satisfied
 * within one vendor. Embeddings remain local and cannot fail at all.
 *
 * Gemini stays one environment variable away. If Google restores a usable free
 * tier, or billing is ever enabled deliberately, `ASSISTANT_PROVIDER=gemini`
 * switches back with no other change — which is the whole reason ADR-003 put a
 * provider interface here in the first place.
 */

/** Groq's larger model: 1,000 req/day, and not the one summaries use. */
export const GROQ_ASSISTANT_MODEL = 'llama-3.3-70b-versatile';

export interface AssistantProviderConfig {
  groqApiKey?: string;
  geminiApiKey?: string;
  /** `groq` (default) or `gemini`. */
  preferred?: string;
}

export type AssistantProviderResult =
  | { ok: true; provider: CompletionProvider }
  | { ok: false; reason: string };

export function createAssistantProvider({
  groqApiKey,
  geminiApiKey,
  preferred,
}: AssistantProviderConfig): AssistantProviderResult {
  const choice = (preferred ?? 'groq').toLowerCase();

  if (choice === 'gemini') {
    if (!geminiApiKey) {
      return { ok: false, reason: 'ASSISTANT_PROVIDER=gemini but GEMINI_API_KEY is not set' };
    }
    return { ok: true, provider: createGeminiProvider({ apiKey: geminiApiKey }) };
  }

  if (groqApiKey) {
    return {
      ok: true,
      provider: createGroqProvider({ apiKey: groqApiKey, model: GROQ_ASSISTANT_MODEL }),
    };
  }

  /*
   * Falling back to Gemini rather than failing outright: a deployment that has
   * only a Gemini key should still answer questions, even if it can only answer
   * twenty of them. A working feature with a low ceiling beats an error page.
   */
  if (geminiApiKey) {
    return { ok: true, provider: createGeminiProvider({ apiKey: geminiApiKey }) };
  }

  return { ok: false, reason: 'no assistant provider configured (set GROQ_API_KEY)' };
}

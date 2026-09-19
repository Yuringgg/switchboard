import { createGeminiProvider } from './gemini';
// ⚠ The VALUE, not a copy of the string: `GROQ_VOICE_MODEL` is defined as this
// constant so the two cannot drift, which is what
// `assistant-voice.test.ts` asserts.
import { createGroqProvider, GROQ_SUMMARY_MODEL } from './groq';
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

/**
 * Groq's larger model: 1,000 req/day, and not the one summaries use.
 *
 * ⚠ Was `llama-3.3-70b-versatile` until 2026-09-20, when Groq decommissioned
 * it — a bare HTTP 404 on every completion, with no deprecation notice. See the
 * note at the top of `groq.ts` for how that was diagnosed and for the full list
 * of what the account can actually reach.
 *
 * **The daily allowance is unchanged at 1,000, but it is no longer shared with
 * anything that matters.** The old 70B's 1,000/day was the entire assistant
 * budget for every tenant on one key — roughly 30 questions a day in practice.
 * This is still 1,000/day, but it is now 1,000 for the assistant ALONE, because
 * the limit is per-model and nothing else in this project uses this one.
 */
export const GROQ_ASSISTANT_MODEL = 'openai/gpt-oss-120b';

/**
 * The model a SPOKEN answer may run on (voice V1) — opt-in, never the default.
 *
 * ── The problem it exists to solve ──────────────────────────────────────────
 *
 * The assistant is capped at roughly **30 questions per day, shared by every
 * tenant** — one Groq key, and Groq scopes limits to the organisation. That cap
 * has held so far because typing a question is work. Voice removes exactly that
 * friction, on purpose. The plan's §6 is blunt about where that leads: the
 * budget goes before lunch, and the next person gets "daily allowance used up"
 * having asked nothing.
 *
 * `llama-3.1-8b-instant` is a different bucket — **14,400 requests/day against
 * the 70B's 1,000** — so a spoken question costs the assistant's allowance
 * nothing. It is also already the model that writes summaries and extractions,
 * so its behaviour on this corpus is known rather than guessed at. And Ms.
 * Maria's own requirement is that voice answers be short, which is the thing an
 * 8B model is least likely to get wrong.
 *
 * ── ⚠ Why it is OFF by default ──────────────────────────────────────────────
 *
 * Because nobody has measured it. The refusal is the property this product is
 * judged on, and a spoken wrong answer is worse than a written one — it leaves
 * nothing on screen to check against. Before `VOICE_ASSISTANT_SMALL_MODEL=1`
 * becomes the default, run `apps/worker/scripts/eval-assistant.ts` against this
 * model and confirm the must-refuse score holds.
 *
 * This is `ASSISTANT_GROUND_EXTRACTIONS`' precedent, for the same reason: a
 * flag is what lets before and after be one experiment instead of two unrelated
 * runs.
 */
/*
 * ⚠⚠ 2026-09-20 — every number in the comment above is HISTORICAL.
 *
 * `llama-3.1-8b-instant` is gone (see `groq.ts`), and with it the 14,400/day
 * figure the argument above rests on. Every surviving model is **1,000
 * requests/day, 8,000 tokens/minute, per model**.
 *
 * What survives is the part that matters: **this must not be the assistant's
 * model**, because limits are per-model and a spoken question must not spend
 * the allowance a typed one needs. That still holds.
 *
 * ⚠ A third model (`qwen/qwen3.8-27b`) was tried here for bucket isolation and
 * REVERTED. `assistant-voice.test.ts` asserts this equals the summariser's
 * model, and its stated reason — *"known behaviour on this corpus rather than a
 * third model nobody has run"* — got STRONGER on 2026-09-20, not weaker: after
 * the decommission, no model had been run on this corpus, so isolation would
 * have been bought with the one property that was actually scarce. The
 * extraction backfill exercises `gpt-oss-20b` over hundreds of these messages,
 * which makes it the known quantity again.
 *
 * ⚠⚠ THE "OFF BY DEFAULT" REASONING BELOW NOW MATTERS MORE, NOT LESS. The model
 * changed underneath this flag without the flag changing. Run
 * `apps/worker/scripts/eval-assistant.ts` against it and confirm the
 * must-refuse score before `VOICE_ASSISTANT_SMALL_MODEL=1` becomes a default.
 */
export const GROQ_VOICE_MODEL = GROQ_SUMMARY_MODEL;

export interface AssistantProviderConfig {
  groqApiKey?: string;
  geminiApiKey?: string;
  /** `groq` (default) or `gemini`. */
  preferred?: string;
  /**
   * Override which Groq model answers. Defaults to `GROQ_ASSISTANT_MODEL`.
   *
   * ⚠ Groq only. Gemini ignores it — there is one Gemini model here and adding
   * a second would need its own measured quota, which nobody has.
   */
  model?: string;
}

export type AssistantProviderResult =
  | { ok: true; provider: CompletionProvider }
  | { ok: false; reason: string };

export function createAssistantProvider({
  groqApiKey,
  geminiApiKey,
  preferred,
  model,
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
      provider: createGroqProvider({
        apiKey: groqApiKey,
        model: model ?? GROQ_ASSISTANT_MODEL,
      }),
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

/**
 * Reading a tool call out of Vapi's webhook payload.
 *
 * ── ⚠ THE BUG THIS MODULE EXISTS TO RECORD ──────────────────────────────────
 *
 * Vapi's documented example is flat:
 *
 *     { "id": "…", "name": "get_weather", "arguments": { "city": "Manila" } }
 *
 * What actually arrives is OpenAI's shape, because Vapi is OpenAI-compatible:
 *
 *     { "id": "…", "type": "function",
 *       "function": { "name": "get_weather", "arguments": "{\"city\":\"Manila\"}" } }
 *
 * Two differences, each fatal on its own:
 *
 *   1. **The name is nested.** `call.name` is `undefined`, so the allowlist
 *      check rejected EVERY tool identically, whichever one was asked for.
 *   2. **`arguments` is a JSON STRING**, not an object. Even with the right
 *      name, every argument would have read as empty.
 *
 * ⚠ It cost an evening because the failure was invisible from outside. The
 * signature verified, the call session resolved to the right tenant, the tool
 * dispatched — and the caller heard the same sentence they would have heard if
 * the database were down. Everything checkable checked out.
 *
 * It was found by recording the tool name and seeing an **empty string** where
 * a name should be. Migration 0015 was written for exactly that and earned
 * itself on the first call after it shipped.
 *
 * ── Why both shapes are accepted ────────────────────────────────────────────
 *
 * Their documentation describes one and their API sends the other. Picking
 * either is a guess, and this is the module that decides whether a tool runs at
 * all. The same reasoning `verifySignature` uses for accepting hex and base64:
 * where a provider's own account of itself is ambiguous, handle both rather
 * than encode a bet.
 *
 * ⚠ Its own module rather than inline in the route, so it is testable without
 * spinning up a Next request — the reason `packages/core/src/webhook.ts` gives
 * for living where it does.
 */

export interface VapiToolCall {
  id: string;
  name?: string;
  arguments?: Record<string, unknown> | string;
  type?: string;
  function?: {
    name?: string;
    arguments?: Record<string, unknown> | string;
  };
}

/**
 * The tool name, from wherever this payload happens to carry it.
 *
 * Nested first: that is what the live API sends, and preferring the documented
 * flat field would mean the wrong one wins on a payload carrying both.
 */
export function toolNameOf(call: VapiToolCall): string {
  const name = call.function?.name ?? call.name ?? '';
  return typeof name === 'string' ? name.trim() : '';
}

/**
 * The arguments, as an object.
 *
 * ⚠ Reported rather than thrown on bad JSON. A malformed argument must degrade
 * to "no arguments" and let the tool say what it needs — failing the whole
 * batch would leave the caller in silence, which is the worst outcome available
 * on a voice call.
 */
export function toolArgsOf(call: VapiToolCall): Record<string, unknown> {
  const raw = call.function?.arguments ?? call.arguments;
  if (!raw) return {};

  if (typeof raw !== 'string') {
    // Already an object. Arrays are not arguments, so they are refused rather
    // than spread into one.
    return Array.isArray(raw) ? {} : raw;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

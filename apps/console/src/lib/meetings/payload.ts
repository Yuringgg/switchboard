/**
 * Reading the two fields this integration needs out of Recall's webhook body.
 *
 * ── ⚠⚠ WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────
 *
 * Because `lib/voice/payload.ts` had to be written for exactly the same reason,
 * after the fact, at the cost of most of a day.
 *
 * Vapi's documentation showed a tool call arriving flat — `{id, name,
 * arguments}`. Their API actually sends OpenAI's nested form —
 * `{id, function: {name, arguments: "<json string>"}}`. The name read as
 * `undefined`, every tool was rejected, and the rejection was byte-identical to
 * the one a database outage produces. Three theories were wrong before a column
 * added to the database (migration 0015) showed an empty string on the first
 * delivery and ended it in seconds.
 *
 * **Recall's shape here is read from their documentation, not from a delivery
 * anyone has received.** It is therefore exactly as unverified as Vapi's was.
 * So the shape is not assumed at a single path: every plausible location is
 * tried, and the route logs loudly when none of them holds anything.
 *
 * Documented shape, read 2026-09-18:
 *
 *     {
 *       "event": "bot.status_change",
 *       "data": {
 *         "data": { "code": "...", "sub_code": null, "updated_at": "..." },
 *         "bot":  { "id": "<uuid>", "metadata": {} }
 *       }
 *     }
 *
 * ⚠ Delete the fallbacks once a real delivery has been seen and the shape is
 * known. Speculative leniency that outlives its uncertainty stops being caution
 * and becomes code nobody can reason about.
 *
 * ── ⚠⚠ AN UNRESOLVED RISK, FOUND IN THE DOCS ON 2026-09-18 ──────────────────
 *
 * The shape above is the **bot status change** webhook. The two events that
 * actually carry a meeting — `recording.done` and `transcript.done` — are
 * *recording artifact* webhooks, and the guide describes reading them at
 * `data.recording.id` and `data.transcript.id`.
 *
 * **It does not say whether they also carry `data.bot.id`.** The schemas live
 * in doc components that the docs API does not expand, so this could not be
 * settled from documentation.
 *
 * If they do not, `botIdOf` returns null for exactly the deliveries that matter
 * and the tenant lookup refuses them — failing closed, which is the right
 * direction, but useless.
 *
 * Two ways out, in order of preference, to be decided against a REAL payload:
 *
 *  1. **Ask Recall, do not trust the payload.** Take the recording id, call
 *     Recall's API with our own key to learn which bot produced it, then match
 *     that bot id against `meeting_bot_sessions` as usual. The identifier still
 *     comes from a row we wrote; the payload is only ever a pointer.
 *  2. **Key the session on more than the bot id** — store the recording id on
 *     the row once `recording.done` names it. Cheaper, but it means one webhook
 *     teaching us the key for the next, which is a weaker chain.
 *
 * ⚠ Do NOT "solve" this by reading an owner out of bot `metadata`. Metadata is
 * echoed back from what was sent and is therefore payload, not provenance.
 * ADR-026 exists to stop exactly that shortcut.
 */

/** Narrow an unknown into something indexable, without casting. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringAt(source: Record<string, unknown> | null, key: string): string | null {
  if (!source) return null;
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The bot id — the ONLY field that decides whose meeting this is.
 *
 * ⚠ Returning a value here grants nothing. It is a CLAIM, and the route's job
 * is to match it against a row we wrote. See `route.ts` and migration 0016.
 */
export function botIdOf(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;

  const data = asRecord(root.data);

  return (
    // Documented: data.bot.id
    stringAt(asRecord(data?.bot), 'id') ??
    // If `bot` were ever promoted to the top level.
    stringAt(asRecord(root.bot), 'id') ??
    // If the envelope were ever flattened away entirely.
    stringAt(data, 'bot_id') ??
    stringAt(root, 'bot_id') ??
    null
  );
}

/**
 * The event name — `bot.status_change`, `recording.done`, and so on.
 *
 * Diagnostic only. It is recorded on the session row before anything is
 * interpreted, so that "what did they actually send?" is answerable without
 * keeping a transcript. It must never gate authorisation: an unrecognised event
 * from a KNOWN bot is stored, and a recognised event from an unknown bot is
 * refused.
 */
export function eventNameOf(payload: unknown): string {
  const root = asRecord(payload);
  if (!root) return '';

  return stringAt(root, 'event') ?? stringAt(root, 'type') ?? '';
}

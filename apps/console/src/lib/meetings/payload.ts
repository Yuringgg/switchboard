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
 * ── ✅ RESOLVED 2026-09-20, AGAINST A REAL RECORDING ────────────────────────
 *
 * The open question was whether the deliveries that actually carry a meeting —
 * `recording.done` and `transcript.done`, which are *recording artifact*
 * events — reference the BOT at all, or only their own artifact id. The
 * schemas live in doc components the docs API does not expand, so it could not
 * be settled from documentation. If the answer had been "only their own id",
 * the tenant lookup would have refused exactly the deliveries worth having.
 *
 * A real bot was sent into a real Zoom meeting and the recording read back.
 * **A recording carries the bot id twice:**
 *
 *     { "id": "3299fb14-…",            ← the recording
 *       "bot_id": "8b37ef2b-…",        ← top level
 *       "bot": { "id": "8b37ef2b-…" }  ← and nested
 *       … }
 *
 * So `botIdOf` works on recording-shaped payloads as written, and the
 * `data.bot.id` path is the right primary. `bot_id` is kept as a sibling
 * because the API itself uses both spellings on one object.
 *
 * ⚠ The fallbacks below stay until a real WEBHOOK delivery has been seen —
 * this was an API response, and the webhook envelope may wrap it differently.
 * Delete them then, not before.
 *
 * ⚠ Do NOT "solve" a future gap by reading an owner out of bot `metadata`.
 * Metadata is echoed back from what was sent and is therefore payload, not
 * provenance. ADR-026 exists to stop exactly that shortcut.
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

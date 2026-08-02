/**
 * Manila-time conversions for the calendar proposal flow (US-7b).
 *
 * ── Why these two functions live together, in one file ───────────────────────
 *
 * They are inverses, and they are the pair that has to agree. One turns a
 * stored ISO instant into what a `datetime-local` input shows; the other turns
 * what that input submits back into RFC3339 for Google. If they disagree about
 * the offset, a confirmed meeting lands on the calendar hours away from the one
 * the user looked at and approved — **silently, and consistently**, which is the
 * kind of wrong that reads as a bug in extraction rather than in a suffix.
 *
 * PH is UTC+8 with no DST, so this is a constant rather than a timezone lookup.
 * `docs/02-ARCHITECTURE.md` §8 pins the same rule for the whole console: store
 * UTC, render Asia/Manila.
 */

export const MANILA_OFFSET = '+08:00';
const MANILA_MS = 8 * 60 * 60 * 1000;

/**
 * ISO instant → the `YYYY-MM-DDTHH:mm` a `datetime-local` input wants, in
 * Manila.
 *
 * ⚠ `new Date(iso).toISOString().slice(0, 16)` is the obvious version and it is
 * wrong: it yields **UTC**, so a 3pm Manila meeting pre-fills as 07:00. The
 * user then either "corrects" it — and is right by accident — or does not
 * notice, and the event is eight hours out.
 *
 * `addMinutes` exists for the end field: most messages name a start and no end,
 * and an hour is the default the form states out loud rather than assuming
 * quietly.
 */
export function toManilaInput(iso: string, addMinutes = 0): string {
  const shifted = new Date(new Date(iso).getTime() + MANILA_MS + addMinutes * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/**
 * `2026-08-07T15:00` (what a `datetime-local` submits) → RFC3339 with the
 * Manila offset, or null when it is not a value we will send anywhere.
 *
 * ⚠ **The offset is not optional.** Without it Google interprets the value in
 * the *calendar's own* timezone — a setting on the user's Google account that
 * this code cannot see. A machine set to UTC would put every confirmed meeting
 * eight hours out.
 *
 * Returns null rather than throwing: the caller is a server action, where a
 * throw is an unhandled rejection and a blank screen.
 */
export function manilaInputToRfc3339(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;

  // Parsed as well as pattern-matched: "2026-02-30T10:00" matches the shape and
  // is not a date.
  const parsed = new Date(`${local}:00${MANILA_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) return null;

  // ⚠ Round-tripped rather than trusted. `new Date('2026-02-30T…')` does not
  // produce NaN in V8 — it rolls over to 2 March — so the shape check and the
  // parse check both pass on a date that does not exist. Comparing the parsed
  // instant back against the input is what actually catches it.
  if (toManilaInput(parsed.toISOString()) !== local) return null;

  return `${local}:00${MANILA_OFFSET}`;
}

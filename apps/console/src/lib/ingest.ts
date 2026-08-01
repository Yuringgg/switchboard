/**
 * Turning one provider notification into the rows ingest must write.
 *
 * ── Why this is a function and not four lines in the route ───────────────────
 *
 * Because it was four lines in the route and it was wrong.
 *
 * The Gmail webhook resolved its channel with `.maybeSingle()`, which errors
 * when **two** rows match. Migration 0003 deliberately keys `channels` on
 * `(owner_id, type, display_name)` — its own comment says *"owner_id is in the
 * key because two tenants legitimately connect the same shared mailbox"* — so
 * the schema permits a state the ingest path could not survive. Two people in
 * one office connecting `info@company.com` was enough: the lookup would fail,
 * the route would return 500, and Pub/Sub would retry that mailbox forever
 * while both consoles stayed empty.
 *
 * Worse than the error is what a "fix" to `.limit(1)` would have done — pick a
 * tenant arbitrarily and deliver one person's mail to the other, which is the
 * one failure in this system that no RLS policy can catch.
 *
 * The right answer is that a shared mailbox has **more than one owner**, and
 * each of them gets their own copy. So this is a fan-out, not a lookup.
 *
 * Pure and separate from the route so the multi-owner case is a test rather
 * than something discovered in production by a second user.
 */

/** A `channels` row, as ingest selects it. */
export interface IngestChannel {
  id: string;
  owner_id: string;
}

/** One `raw_events` row, ready to insert. */
export interface QueuedEvent {
  owner_id: string;
  channel_id: string;
  external_id: string;
  payload: unknown;
  status: 'pending';
}

/**
 * One row per channel that has this account connected.
 *
 * ⚠ `owner_id` is taken from each channel row and never from the payload. The
 * worker connects as `service_role`, so RLS is inert there and these values are
 * the only thing keeping tenants apart.
 *
 * The same `external_id` repeats across rows, which is correct: `raw_events` is
 * keyed `(channel_id, external_id)` (migration 0004), so two channels queuing
 * the same provider message id are two distinct rows, while a redelivery to
 * either one still collides and is discarded.
 */
export function fanOutToChannels(
  channels: readonly IngestChannel[],
  externalId: string,
  payload: unknown,
): QueuedEvent[] {
  const seen = new Set<string>();

  return channels
    .filter((channel) => {
      // A defensive de-dupe on channel id. The unique index would reject a
      // repeat anyway, but as a 23505 the route would count it as a provider
      // redelivery — which is a different thing and would read as normal in the
      // logs. Two rows for one channel in a single notification is not normal.
      if (!channel?.id || !channel.owner_id || seen.has(channel.id)) return false;
      seen.add(channel.id);
      return true;
    })
    .map((channel) => ({
      owner_id: channel.owner_id,
      channel_id: channel.id,
      external_id: externalId,
      payload,
      status: 'pending' as const,
    }));
}

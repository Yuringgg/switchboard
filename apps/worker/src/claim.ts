import { sql } from 'drizzle-orm';

import type { Database } from '@switchboard/db';

/**
 * Claim one pending event from the queue.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes a plain table safe to use as a queue
 * (ADR-005): the row is locked for this transaction, and any other worker
 * skips past it instead of blocking. Two workers never claim the same event,
 * and no broker is involved.
 *
 * The status flip to 'processing' happens in the same statement as the claim.
 * Selecting and then updating separately leaves a window where a crash strands
 * the row in 'pending' and it gets processed twice.
 */
export interface ClaimedEvent {
  id: string;
  /**
   * ⚠ Derived from the `channels` row, NOT from the payload.
   *
   * The worker connects with credentials that bypass RLS, so this value is the
   * only thing keeping one tenant's messages out of another's console, and no
   * database policy will catch it if it is wrong. A provider payload is
   * attacker-influenced input; the channel row is ours.
   */
  ownerId: string;
  channelId: string;
  channelType: string;
  externalId: string | null;
  payload: unknown;
  attempts: number;
}

export async function claimNextEvent(db: Database): Promise<ClaimedEvent | null> {
  const rows = await db.execute<{
    id: string;
    owner_id: string;
    channel_id: string;
    channel_type: string;
    external_id: string | null;
    payload: unknown;
    attempts: number;
  }>(sql`
    with claimed as (
      select re.id
        from raw_events re
       where re.status = 'pending'
       order by re.received_at
       limit 1
         for update skip locked
    )
    update raw_events re
       set status = 'processing',
           attempts = re.attempts + 1
      from claimed c, channels ch
     where re.id = c.id
       and ch.id = re.channel_id
    returning
      re.id,
      -- owner_id read from the CHANNEL, not from re.owner_id and never from
      -- the payload. If the two ever disagree the channel is authoritative.
      ch.owner_id     as owner_id,
      re.channel_id   as channel_id,
      ch.type         as channel_type,
      re.external_id  as external_id,
      re.payload      as payload,
      re.attempts     as attempts
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    ownerId: row.owner_id,
    channelId: row.channel_id,
    channelType: row.channel_type,
    externalId: row.external_id,
    payload: row.payload,
    attempts: row.attempts,
  };
}

export async function markDone(db: Database, id: string): Promise<void> {
  await db.execute(sql`update raw_events set status = 'done', last_error = null where id = ${id}`);
}

/**
 * Return an event to the queue, or fail it permanently once it has burned
 * through its attempts. Without the ceiling a poison payload is retried
 * forever and starves everything behind it.
 */
export async function markFailed(
  db: Database,
  id: string,
  attempts: number,
  maxAttempts: number,
  error: unknown,
): Promise<void> {
  // Message bodies are never logged (docs/02-ARCHITECTURE.md §6), and an error
  // from a parse failure can contain one. Keep only the message.
  const reason = error instanceof Error ? error.message : 'unknown error';
  const terminal = attempts >= maxAttempts;

  await db.execute(sql`
    update raw_events
       set status = ${terminal ? 'failed' : 'pending'},
           last_error = ${reason}
     where id = ${id}
  `);
}

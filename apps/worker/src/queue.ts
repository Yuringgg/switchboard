import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

/**
 * The queue's own housekeeping: getting stranded events back into it, and
 * saying whether it has live work.
 *
 * ── ⚠ Why this exists: one stranded row switched the catch-up off for seven weeks
 *
 * `claimNextEvent` flips a row to 'processing' as it claims it. If the process
 * dies before `markDone` or `markFailed` — a deploy that outlives the 10-second
 * SIGTERM grace in `index.ts`, an OOM kill, a container restart — the row stays
 * 'processing' forever, because the claim query only ever selects 'pending'.
 *
 * Measured against the live database on 2026-09-24: **27 rows in
 * 'processing'**, the oldest received 2026-08-04, all with attempts = 1.
 *
 * On its own that is 27 Gmail notifications nobody re-read — harmless, because
 * Gmail ingest pulls history from the channel's stored cursor rather than from
 * the notification, so the mail still arrived with the next one. What made it
 * an outage was `extract-catchup.ts`: it only runs when the queue is idle, and
 * it counted 'processing' as busy. The first stranded row switched the sweep
 * off for good, with nothing in any log, and by 24 September **183 of 393
 * messages had never been through extraction**. The same "is the queue idle?"
 * question now gates the summary and embedding catch-ups too, so it lives here
 * once rather than in three files that could drift.
 */

/**
 * How long a row may sit in 'processing' before it is presumed dead.
 *
 * ⚠ Far longer than any real event takes, on purpose. The slowest real case is
 * a Gmail history replay: a dozen new messages, each summarised, embedded and
 * extracted in sequence, with Groq calls capped at 15 seconds apiece — a few
 * minutes at the very worst. Reclaiming a row that is still being worked on
 * would process it twice concurrently, so the threshold errs a long way the
 * other way. A stranded row waiting an extra twenty minutes costs nothing;
 * the next sweep is five minutes away.
 */
export const STALE_CLAIM_MINUTES = 30;

/**
 * Every row a claim cannot be LIVE for. Written once, because the reaper and
 * the idle check must agree exactly on what "stale" means — if the idle check
 * counted a row the reaper ignores, the catch-up would stay switched off again.
 *
 * `coalesce` with `received_at` covers rows claimed before migration 0018, which
 * have no `claimed_at`. A receipt is always earlier than its claim, so the
 * fallback can only make an old row look staler, never make a live one stale.
 */
const staleClaim = (minutes: number) => sql`
  status = 'processing'
  and coalesce(claimed_at, received_at) < now() - make_interval(mins => ${minutes}::int)
`;

export interface ReclaimResult {
  /** Put back to 'pending' — the next claim picks them up. */
  requeued: number;
  /** Had already used their last attempt, so parked as 'failed' instead. */
  failed: number;
}

/**
 * Return every stranded event to the queue.
 *
 * ⚠ The attempt the dead process spent is KEPT. `claimNextEvent` incremented it
 * on claim, and an event that keeps killing the worker — the one poison payload
 * that OOMs a container, say — must still run out of attempts and park, rather
 * than being reclaimed and re-run forever. At the ceiling it goes straight to
 * 'failed', with a reason that says what happened.
 *
 * `last_error` records the reclaim so a row that comes back and then succeeds
 * still shows it was once stranded — until `markDone` clears it.
 */
export async function reclaimStaleEvents(
  db: Database,
  maxAttempts: number,
  staleMinutes: number = STALE_CLAIM_MINUTES,
): Promise<ReclaimResult> {
  const rows = await db.execute<{ status: string }>(sql`
    update raw_events
       set status = case when attempts >= ${maxAttempts} then 'failed' else 'pending' end,
           last_error = ${`reclaimed: left in processing for over ${staleMinutes} minutes, so the worker stopped mid-event`}
     where ${staleClaim(staleMinutes)}
    returning status
  `);

  return {
    requeued: rows.filter((row) => row.status === 'pending').length,
    failed: rows.filter((row) => row.status === 'failed').length,
  };
}

/**
 * True when the queue has no LIVE work: nothing pending, and nothing being
 * processed right now.
 *
 * ⚠ A stale 'processing' row is NOT live work. Counting it is what switched the
 * extraction catch-up off from 4 August to 24 September. The reaper returns
 * those rows to 'pending' within five minutes anyway; this makes sure that even
 * a reaper that never ran cannot hold the catch-ups off.
 *
 * The column is named `pending` because callers and their tests read it by
 * that name.
 */
export async function queueIsIdle(
  db: Database,
  staleMinutes: number = STALE_CLAIM_MINUTES,
): Promise<boolean> {
  const rows = await db.execute<{ pending: number }>(sql`
    select count(*)::int as pending
      from raw_events
     where status = 'pending'
        or (status = 'processing' and not (${staleClaim(staleMinutes)}))
  `);
  return (rows[0]?.pending ?? 0) === 0;
}

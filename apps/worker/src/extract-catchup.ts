import type { CompletionProvider } from '@switchboard/ai';
import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

import { extractMessage } from './extract';

/**
 * Re-extract messages the live ingest path dropped.
 *
 * ── ⚠ Why this exists: the work was being lost, not deferred ─────────────────
 *
 * `extractBatch` stops on a retryable failure and records nothing, which is
 * correct on its own terms — a 429 would hit the next twelve messages
 * identically, and recording a run for work that never happened would mark the
 * message done and lose its real commitments forever.
 *
 * Its comment then says: *"They are not lost — no run is recorded for a
 * failure, so `extractMessage` is idempotent and the backfill picks up anything
 * without a run."*
 *
 * That is true of the DATA and false of the PROCESS. **Nothing scheduled the
 * backfill.** The `raw_events` row is marked done — extraction must never fail
 * an event — so the message never comes back through the worker, and the
 * extraction stays outstanding until a human remembers to run a script.
 *
 * Measured against the live database on 2026-08-03: **84 messages, 78
 * extraction runs.** Two of the six gaps are `\r\n`-only bodies, correctly
 * skipped. The other four were real mail from the preceding 24 hours — a
 * payment notification and three job alerts — every one of them summarised and
 * embedded, none extracted:
 *
 *     3 Aug 04:27  BDO InstaPay Successful                 2 chunks   no run
 *     3 Aug 03:05  Systems Applications Engineering Intern 7 chunks   no run
 *     3 Aug 01:05  SOC Analyst at Commit                   8 chunks   no run
 *     2 Aug 21:42  CAI is hiring for IT Assistant         12 chunks   no run
 *
 * Extraction was not disabled — a message at 06:35 the same morning was
 * extracted 17 seconds after it arrived. It is the shared **6,000 tokens/minute**
 * window: extraction runs LAST of the three AI steps on the same message, so it
 * is the one that meets an exhausted window, and a big message makes it likelier
 * (three of the four above are over 5,000 characters).
 *
 * ⚠ This matters beyond the missing rows. `/attention` and the calendar
 * proposals read `extractions`, and ADR-020 proposes grounding the **assistant**
 * in it. A source that silently drops most of a day's mail fails in the worst
 * available way: confidently, and with no error anywhere. "You have no upcoming
 * meetings" drawn from a table that never saw the meeting is exactly the
 * fabrication ADR-007 exists to prevent, arriving through the back door.
 *
 * ── Why a sweep and not an inline retry ─────────────────────────────────────
 *
 * Retrying inside `extractBatch` would block `markDone`, and behind it the whole
 * ingest loop, for however long Groq's `retry-after` says — tens of seconds per
 * message, minutes for a Gmail history replay. That trades a lost proposal for
 * delayed mail, and `docs/04-ROADMAP.md` already settled which of those to
 * prefer: extraction runs last precisely *because* it is the right thing to
 * lose. This keeps that property and adds the missing half — something that
 * comes back for it later.
 *
 * Same shape as `watchRenewalLoop`, for the same reason: a periodic sweep over
 * an indexed query, cheap enough to run forever and loud enough to notice.
 */

/**
 * ⚠ Only when the queue is EMPTY.
 *
 * The sweep and live ingest draw on one 6,000/minute window. A sweep grinding
 * through yesterday's newsletters while today's mail arrives would starve the
 * step that a person is about to look at — reintroducing the exact failure this
 * file exists to fix, with the priorities inverted.
 */
async function queueIsIdle(db: Database): Promise<boolean> {
  const rows = await db.execute<{ pending: number }>(sql`
    select count(*)::int as pending
      from raw_events
     where status in ('pending', 'processing')
  `);
  return (rows[0]?.pending ?? 0) === 0;
}

export interface CatchUpResult {
  considered: number;
  written: number;
  rows: number;
  skipped: number;
  failed: number;
  /** True when the queue was busy and the sweep deliberately did nothing. */
  deferred: boolean;
}

/**
 * One pass. Bounded on purpose — see `CATCH_UP_BATCH`.
 */
export async function catchUpExtractions(
  db: Database,
  provider: CompletionProvider,
  batchSize: number,
  delayMs: number,
): Promise<CatchUpResult> {
  const empty: CatchUpResult = {
    considered: 0,
    written: 0,
    rows: 0,
    skipped: 0,
    failed: 0,
    deferred: false,
  };

  if (!(await queueIsIdle(db))) return { ...empty, deferred: true };

  /*
   * Newest first, and only messages the pass has never seen — the same query
   * `backfill-extractions.ts` uses, deliberately, so the two cannot disagree
   * about what "outstanding" means.
   *
   * ⚠ The `where` is on `message_extraction_runs`, NOT on `extractions`.
   * Filtering on "has no extraction rows" would re-send every message that
   * correctly yielded nothing — most of a real mailbox — on every sweep. That
   * is the whole reason migration 0011 exists (ADR-019).
   *
   * ⚠ `btrim` with ONE argument trims spaces only — not tabs, not newlines,
   * where JavaScript's `.trim()` in `shouldExtract` strips all of them. Left at
   * the default, a body that is nothing but `\r\n` is selected here and skipped
   * there, so every sweep would pick up the same message forever and report
   * work it never did. This corpus contains exactly such a message.
   */
  const pending = await db.execute<{ id: string }>(sql`
    select m.id
      from messages m
      left join message_extraction_runs r on r.message_id = m.id
     where r.message_id is null
       and btrim(m.body_text, E' \t\r\n') <> ''
     order by m.sent_at desc
     limit ${batchSize}
  `);

  const result: CatchUpResult = { ...empty, considered: pending.length };

  for (const [index, row] of pending.entries()) {
    const outcome = await extractMessage(db, provider, row.id);

    if (outcome.status === 'written') {
      result.written += 1;
      result.rows += outcome.rows;
    } else if (outcome.status === 'skipped') {
      result.skipped += 1;
    } else {
      result.failed += 1;
      // Message id and a reason, never content. docs/02-ARCHITECTURE.md §6.
      console.warn(`[extract-catchup] message=${row.id} failed: ${outcome.reason}`);

      /*
       * Stop the sweep, don't grind.
       *
       * Unlike `extractBatch`, stopping here costs nothing: the next sweep is
       * in minutes and no run was recorded, so this message is first in line
       * again. That "next sweep" is the entire point of this file.
       */
      if (outcome.retryable) break;
    }

    if (index < pending.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }

  return result;
}

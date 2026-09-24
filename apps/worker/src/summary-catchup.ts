import { SUMMARY_MIN_BODY, type CompletionProvider } from '@switchboard/ai';
import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

import { queueIsIdle } from './queue';
import { summariseMessage } from './summarize';

/**
 * Summarise messages the live ingest path missed.
 *
 * ── ⚠ Why this exists: summaries had no way back ─────────────────────────────
 *
 * Summaries are written once, inline, as a message is ingested. `summariseBatch`
 * stops on a retryable failure and its comment says the rest *"are not lost —
 * the backfill script picks up anything without a summary"*. True of the data,
 * false of the process: nothing runs that script. It is the exact hole
 * `extract-catchup.ts` was written to close for extraction on 2026-08-03 — and
 * summaries never got the same fix.
 *
 * It mattered on 2026-09-24, measured against the live database: **no summary
 * had been written since 2026-08-14**, and 153 messages long enough to deserve
 * one had none. Two things stopped them — the Llama model going away, then the
 * gpt-oss model being asked with no room to answer (`SUMMARY_COMPLETION_OPTIONS`)
 * — and once each was fixed, nothing would have come back for the backlog.
 * Summaries are the half of the product in Ms. Maria's founding message.
 *
 * Same shape as `catchUpExtractions`, deliberately: one idle check, newest
 * first, a bounded batch, stop on a retryable failure.
 */

export interface SummaryCatchUpResult {
  considered: number;
  written: number;
  skipped: number;
  failed: number;
  /** True when the queue was busy and the sweep deliberately did nothing. */
  deferred: boolean;
}

export async function catchUpSummaries(
  db: Database,
  provider: CompletionProvider,
  batchSize: number,
  delayMs: number,
  /**
   * Messages that failed NON-retryably earlier in this process's life — an
   * answer `validateSummary` rejects, say. A summary failure records nothing,
   * so without this the same few would head the list on every sweep and the
   * sweep would never reach anything older. See `catchUpExtractions`.
   */
  giveUp: Set<string> = new Set(),
): Promise<SummaryCatchUpResult> {
  const empty: SummaryCatchUpResult = {
    considered: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    deferred: false,
  };

  if (!(await queueIsIdle(db))) return { ...empty, deferred: true };

  /*
   * ⚠ The length rule mirrors `shouldSummarise`'s `already-short` skip, and
   * `btrim` gets the full whitespace set to agree with JavaScript's `.trim()`.
   * Out of step in either direction, a message is SELECTED here and SKIPPED
   * there — and since a skip writes nothing, it is selected again on every
   * sweep forever. `backfill-summaries.ts` uses the same predicate for the
   * same reason.
   *
   * ⚠ The `kind` filter sits in the JOIN condition. In the WHERE it would turn
   * the LEFT join into an inner one and select nothing — migration 0010's trap.
   */
  const candidates = await db.execute<{ id: string }>(sql`
    select m.id
      from messages m
      left join extractions e on e.message_id = m.id and e.kind = 'summary'
     where e.id is null
       and length(btrim(m.body_text, E' \t\r\n')) >= ${SUMMARY_MIN_BODY}
     order by m.sent_at desc
     limit ${batchSize + giveUp.size}
  `);

  const pending = candidates.filter((row) => !giveUp.has(row.id)).slice(0, batchSize);
  const result: SummaryCatchUpResult = { ...empty, considered: pending.length };

  for (const [index, row] of pending.entries()) {
    const outcome = await summariseMessage(db, provider, row.id);

    if (outcome.status === 'written') {
      result.written += 1;
    } else if (outcome.status === 'skipped') {
      result.skipped += 1;
    } else {
      result.failed += 1;
      // Message id and a reason, never content. docs/02-ARCHITECTURE.md §6.
      console.warn(`[summary-catchup] message=${row.id} failed: ${outcome.reason}`);

      // The next sweep is minutes away and nothing was recorded, so this
      // message is simply first in line again. Grinding on turns one 429 into
      // five.
      if (outcome.retryable) break;
      giveUp.add(row.id);
    }

    if (index < pending.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }

  return result;
}

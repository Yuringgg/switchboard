import { isEmbedderLoaded } from '@switchboard/ai';
import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

import { embedMessage } from './embed-messages';
import { queueIsIdle } from './queue';

/**
 * Embed messages the live ingest path missed.
 *
 * Embedding is local and costs no quota, so it cannot be starved of a token
 * window the way summaries and extraction were. It can still be skipped: the
 * ingest step is guarded on the model having loaded, and a revision whose model
 * failed to load — or one that was killed mid-event — leaves messages that
 * search's semantic half and the assistant simply never see.
 *
 * Measured on 2026-09-24: **36 messages with a body and no chunks.** They are
 * findable by keyword and invisible to the assistant, with no error anywhere —
 * the assistant just answers from the other 357 and cannot say it is missing
 * any.
 *
 * Waits for an idle queue like the other two catch-ups: not for a token window,
 * but because the worker is sized for one job at a time (0.5 vCPU) and live
 * mail comes first.
 */

export interface EmbedCatchUpResult {
  considered: number;
  embedded: number;
  chunks: number;
  skipped: number;
  failed: number;
  deferred: boolean;
}

export async function catchUpEmbeddings(
  db: Database,
  batchSize: number,
  /**
   * Messages that failed or were skipped earlier in this process's life. A
   * body that chunks to nothing is skipped by `embedMessage` and writes no
   * chunk, so it would be selected again on every sweep without this.
   */
  giveUp: Set<string> = new Set(),
): Promise<EmbedCatchUpResult> {
  const empty: EmbedCatchUpResult = {
    considered: 0,
    embedded: 0,
    chunks: 0,
    skipped: 0,
    failed: 0,
    deferred: false,
  };

  // No model, no work — and not a failure worth a line every sweep; startup
  // already said so loudly.
  if (!isEmbedderLoaded()) return empty;
  if (!(await queueIsIdle(db))) return { ...empty, deferred: true };

  /*
   * ⚠ `btrim` with the full whitespace set, for the same reason as the other
   * two sweeps: a `\r\n`-only body must not be selected here and then have
   * nothing to embed, forever.
   */
  const candidates = await db.execute<{ id: string }>(sql`
    select m.id
      from messages m
     where btrim(m.body_text, E' \t\r\n') <> ''
       and not exists (select 1 from message_chunks k where k.message_id = m.id)
     order by m.sent_at desc
     limit ${batchSize + giveUp.size}
  `);

  const pending = candidates.filter((row) => !giveUp.has(row.id)).slice(0, batchSize);
  const result: EmbedCatchUpResult = { ...empty, considered: pending.length };

  for (const row of pending) {
    const outcome = await embedMessage(db, row.id);

    if (outcome.status === 'embedded') {
      result.embedded += 1;
      result.chunks += outcome.chunks;
    } else if (outcome.status === 'skipped') {
      result.skipped += 1;
      giveUp.add(row.id);
    } else {
      result.failed += 1;
      giveUp.add(row.id);
      // Message id and a reason, never content. docs/02-ARCHITECTURE.md §6.
      console.warn(`[embed-catchup] message=${row.id} failed: ${outcome.reason}`);
    }
  }

  return result;
}

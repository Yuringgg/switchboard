/**
 * Backfill summaries over messages that already exist (Phase 4A, ADR-015).
 *
 * Run:
 *   node --env-file=apps/worker/.env \
 *     apps/worker/node_modules/tsx/dist/cli.mjs \
 *     apps/worker/scripts/backfill-summaries.ts --limit 20
 *
 * Flags:
 *   --limit N    stop after N messages          (default 25)
 *   --dry-run    decide and report, call nothing
 *   --delay MS   pause between requests         (default 2500)
 *
 * ── ⚠ Why this is a script and not a loop in the worker ──────────────────────
 *
 * `docs/04-ROADMAP.md` is explicit: the backfill runs "rate-limited, as a
 * script — not in the request path and not in the ingest loop", and **it must
 * not consume the daily allowance that live summarisation depends on.**
 *
 * That is the real hazard. Groq's free tier gives 14,400 requests/day on
 * `llama-3.1-8b-instant` (verified 2026-08-02 from the rate-limit headers), and
 * a backfill is the one operation that can spend a large slice of it in a
 * minute. If it did, every email arriving afterwards would silently ingest
 * without a summary until midnight UTC — and nothing would look broken, which
 * is the worst shape of failure.
 *
 * Three things keep that from happening, and none of them is optional:
 *
 *   · `--limit` defaults to 25, not "everything". Backfilling a corpus is a
 *     decision to make repeatedly and watch, not once and walk away from.
 *   · A delay between requests, well under the 30/minute ceiling.
 *   · **It stops dead on a retryable failure.** A 429 means the quota is gone
 *     or the minute is full; continuing turns one rate-limit response into
 *     twenty-five. Nothing is lost — every message without a summary is still
 *     without one on the next run.
 */

import { createGroqProvider } from '@switchboard/ai';
import { createDbClient } from '@switchboard/db';
import { sql } from 'drizzle-orm';

import { summariseMessage } from '../src/summarize';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const LIMIT = Number(flag('limit') ?? 25);
const DELAY_MS = Number(flag('delay') ?? 2_500);
const DRY_RUN = process.argv.includes('--dry-run');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey && !DRY_RUN) {
    throw new Error('GROQ_API_KEY is not set (use --dry-run to plan without it)');
  }

  const { db, sql: client } = createDbClient(databaseUrl);
  const provider = createGroqProvider({ apiKey: apiKey ?? '' });

  try {
    /*
     * Newest first, and only messages with no summary yet.
     *
     * Newest because if the run is cut short — by a quota, by a person — the
     * messages that got summarised are the ones anybody is currently looking
     * at. Oldest-first would spend the whole allowance on last month's
     * newsletters.
     *
     * The length filter mirrors `shouldSummarise`'s `already-short` rule so the
     * count printed below is honest: without it this would report "40 pending"
     * and then skip 30 of them locally, which reads as a broken backfill.
     */
    const pending = await db.execute<{ id: string; length: number }>(sql`
      select m.id, length(btrim(m.body_text)) as length
        from messages m
        left join extractions e
          on e.message_id = m.id and e.kind = 'summary'
       where e.id is null
         and length(btrim(m.body_text)) >= 280
       order by m.sent_at desc
       limit ${LIMIT}
    `);

    console.info(
      `[backfill] ${pending.length} message(s) to summarise` +
        `${DRY_RUN ? ' (dry run — nothing will be sent)' : ''}`,
    );

    if (DRY_RUN) {
      for (const row of pending) {
        console.info(`[backfill] would summarise message=${row.id} (${row.length} chars)`);
      }
      return;
    }

    let written = 0;
    let skipped = 0;
    let failed = 0;

    for (const [index, row] of pending.entries()) {
      const outcome = await summariseMessage(db, provider, row.id);

      if (outcome.status === 'written') {
        written += 1;
        console.info(`[backfill] ${index + 1}/${pending.length} written  message=${row.id}`);
      } else if (outcome.status === 'skipped') {
        skipped += 1;
        console.info(
          `[backfill] ${index + 1}/${pending.length} skipped  message=${row.id} (${outcome.reason})`,
        );
      } else {
        failed += 1;
        console.error(
          `[backfill] ${index + 1}/${pending.length} FAILED   message=${row.id}: ${outcome.reason}`,
        );

        // ⚠ Stop, do not continue. See the header: a 429 will hit every
        // remaining message identically, and grinding through them turns one
        // rate-limit response into twenty-five.
        if (outcome.retryable) {
          console.error('[backfill] stopping: the failure is retryable, so the rest would fail too.');
          break;
        }
      }

      // No delay after the final message — it would only slow the exit.
      if (index < pending.length - 1) await sleep(DELAY_MS);
    }

    console.info(
      `[backfill] done: written=${written} skipped=${skipped} failed=${failed}`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('[backfill]', error instanceof Error ? error.message : error);
  process.exit(1);
});

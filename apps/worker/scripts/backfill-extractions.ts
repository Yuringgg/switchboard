/**
 * Backfill extraction over messages that already exist (Phase 5, US-7, US-9).
 *
 * Run:
 *   node --env-file=apps/worker/.env \
 *     apps/worker/node_modules/tsx/dist/cli.mjs \
 *     apps/worker/scripts/backfill-extractions.ts --limit 20
 *
 * Flags:
 *   --limit N    stop after N messages          (default 25)
 *   --dry-run    decide and report, call nothing
 *   --delay MS   pause between requests         (default 2500)
 *
 * ── ⚠ Why this is a script and not a loop in the worker ──────────────────────
 *
 * Identical reasoning to `backfill-summaries.ts`, with one limit tightened.
 * Extraction shares `llama-3.1-8b-instant` with the summariser, so it draws on
 * the same **6,000 tokens/minute** window that live summarisation needs — and
 * its prompts are larger, because the model is asked for JSON rather than two
 * sentences. A backfill that ran flat out would leave arriving mail
 * unsummarised *and* unextracted, with nothing looking broken.
 *
 * Three things keep that from happening, and none is optional:
 *
 *   · `--limit` defaults to 25, not "everything".
 *   · A delay between requests, well under the 30/minute ceiling.
 *   · It waits out one rate limit using Groq's own `retry-after`, then stops.
 *     ⚠ `retry-after` can be FRACTIONAL ("11.75") — `parseFloat`, not
 *     `parseInt`, or an 11.75s wait becomes 11s and 429s again immediately.
 *     That is handled in `groq.ts`; it is noted here because it is the kind of
 *     thing a future edit of this file would reintroduce.
 *
 * ── ⚠ Re-running this does NOT duplicate proposals ──────────────────────────
 *
 * `extractMessage` reads `message_extraction_runs` before it spends anything,
 * so a message that has been through the pass is skipped even when it produced
 * zero rows — which is most of them. To deliberately re-extract with a better
 * prompt, delete the run rows for the model you are replacing; the pass then
 * replaces that message's UNCONFIRMED proposals and leaves confirmed ones
 * alone. See the delete in `apps/worker/src/extract.ts` and ADR-010.
 */

import { createGroqProvider, GROQ_EXTRACTION_MODEL } from '@switchboard/ai';
import { createDbClient } from '@switchboard/db';
import { sql } from 'drizzle-orm';

import { extractMessage } from '../src/extract';

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
  const provider = createGroqProvider({
    apiKey: apiKey ?? '',
    model: GROQ_EXTRACTION_MODEL,
  });

  try {
    /*
     * Newest first, and only messages the pass has never seen.
     *
     * Newest because if the run is cut short — by a quota, by a person — the
     * messages that got processed are the ones anybody is currently looking at.
     * Oldest-first would spend the whole allowance on last month's newsletters.
     *
     * ⚠ The `where` is on `message_extraction_runs`, NOT on `extractions`.
     * Filtering on "has no extraction rows" would re-send every message that
     * correctly yielded nothing — which is most of a real mailbox — on every
     * single run. That is the whole reason migration 0011 exists.
     *
     * The body filter mirrors `shouldExtract`'s only skip rule so the count
     * printed below is honest rather than optimistic.
     *
     * ⚠ `btrim` with ONE argument trims spaces only — not tabs, not newlines.
     * JavaScript's `.trim()`, which `shouldExtract` uses, strips all of them.
     * Left at the default, a body that is nothing but `\r\n` counts as 2
     * characters here and as 0 there, so the run reports work it then skips.
     * This corpus contains exactly such a message, which is how it was found.
     */
    const pending = await db.execute<{ id: string; length: number }>(sql`
      select m.id, length(btrim(m.body_text, E' \t\r\n')) as length
        from messages m
        left join message_extraction_runs r on r.message_id = m.id
       where r.message_id is null
         and btrim(m.body_text, E' \t\r\n') <> ''
       order by m.sent_at desc
       limit ${LIMIT}
    `);

    console.info(
      `[backfill] ${pending.length} message(s) to extract from` +
        `${DRY_RUN ? ' (dry run — nothing will be sent)' : ''}`,
    );

    if (DRY_RUN) {
      for (const row of pending) {
        console.info(`[backfill] would extract from message=${row.id} (${row.length} chars)`);
      }
      return;
    }

    let written = 0;
    let rows = 0;
    let skipped = 0;
    let failed = 0;

    for (const [index, row] of pending.entries()) {
      const position = `${index + 1}/${pending.length}`;
      let outcome = await extractMessage(db, provider, row.id);

      /*
       * Wait out a rate limit once, rather than abandoning the run.
       *
       * The binding limit is tokens per minute, which is a pause of seconds,
       * not a quota gone for the day. Treating the two the same is what made
       * the first version of the summaries backfill abandon 57 messages over an
       * eleven-second wait. A second failure still stops the run.
       */
      if (outcome.status === 'failed' && outcome.retryable && outcome.retryAfterMs) {
        const waitMs = Math.min(outcome.retryAfterMs + 500, 60_000);
        console.warn(
          `[backfill] ${position} rate limited, waiting ${Math.round(waitMs / 1000)}s — ${outcome.reason}`,
        );
        await sleep(waitMs);
        outcome = await extractMessage(db, provider, row.id);
      }

      if (outcome.status === 'written') {
        written += 1;
        rows += outcome.rows;
        // ⚠ `rows=0` is printed rather than hidden: it is the ORDINARY result
        // for most mail, and a backfill that only reported its hits would read
        // as though it had failed on everything else.
        console.info(
          `[backfill] ${position} extracted message=${row.id} rows=${outcome.rows}` +
            (outcome.dropped > 0 ? ` (dropped ${outcome.dropped})` : ''),
        );
      } else if (outcome.status === 'skipped') {
        skipped += 1;
        console.info(`[backfill] ${position} skipped   message=${row.id} (${outcome.reason})`);
      } else {
        failed += 1;
        console.error(`[backfill] ${position} FAILED    message=${row.id}: ${outcome.reason}`);

        if (outcome.retryable) {
          console.error(
            '[backfill] stopping: still limited after waiting, so the rest would fail too. ' +
              'Nothing is lost — no run was recorded, so re-running resumes here.',
          );
          break;
        }
      }

      if (index < pending.length - 1) await sleep(DELAY_MS);
    }

    console.info(
      `[backfill] done: messages=${written} rows=${rows} skipped=${skipped} failed=${failed}`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('[backfill]', error instanceof Error ? error.message : error);
  process.exit(1);
});

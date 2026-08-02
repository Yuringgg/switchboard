/**
 * Backfill chunk embeddings over messages that already exist (Phase 4B).
 *
 * Run:
 *   node --env-file=apps/worker/.env \
 *     apps/worker/node_modules/tsx/dist/cli.mjs \
 *     apps/worker/scripts/backfill-embeddings.ts --limit 100
 *
 * Flags:
 *   --limit N    stop after N messages   (default 100)
 *   --dry-run    plan only, load nothing
 *
 * ── Why this has no rate limiting, unlike the summary backfill ───────────────
 *
 * Embeddings are **local** (ADR-003). There is no quota to exhaust, no
 * `retry-after` to honour and no provider to be down — which is the entire
 * reason the model was chosen to run in-process rather than behind an API. The
 * only cost is CPU on the machine running this, so it goes as fast as it can.
 *
 * That property is worth more than it sounds: it means semantic search cannot
 * break during a demo because someone else used the quota, and it means this
 * script can be re-run freely after a chunking change without paying for it.
 */

import { warmEmbedder } from '@switchboard/ai';
import { createDbClient } from '@switchboard/db';
import { sql } from 'drizzle-orm';

import { embedMessage } from '../src/embed-messages';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const LIMIT = Number(flag('limit') ?? 100);
const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const { db, sql: client } = createDbClient(databaseUrl);

  try {
    /*
     * Messages with no chunks yet. Newest first for the same reason the summary
     * backfill is: if the run is interrupted, the messages that got embedded
     * are the ones anybody is currently looking at.
     *
     * No length filter here, unlike summaries. A short chat message is still
     * worth embedding — "Nasa office ka ba bukas?" is exactly the kind of thing
     * the assistant should retrieve for "do I have upcoming meetings?", and it
     * is far too short to be worth summarising. The two features have genuinely
     * different thresholds and it would be a mistake to share one.
     */
    const pending = await db.execute<{ id: string; length: number }>(sql`
      select m.id, length(btrim(m.body_text)) as length
        from messages m
        left join message_chunks mc on mc.message_id = m.id
       where mc.id is null
         and length(btrim(m.body_text)) > 0
       group by m.id, m.body_text
       order by max(m.sent_at) desc
       limit ${LIMIT}
    `);

    console.info(
      `[embed-backfill] ${pending.length} message(s) to embed` +
        `${DRY_RUN ? ' (dry run — the model will not be loaded)' : ''}`,
    );

    if (DRY_RUN) {
      for (const row of pending) {
        console.info(`[embed-backfill] would embed message=${row.id} (${row.length} chars)`);
      }
      return;
    }

    if (pending.length === 0) return;

    // Loaded once, up front, so the timing below measures embedding rather than
    // a 129 MB model load attributed to the first message.
    console.info('[embed-backfill] loading the model…');
    const warm = await warmEmbedder();
    if (!warm.ok) throw new Error(`embedder failed to load: ${warm.reason}`);
    console.info(`[embed-backfill] model ready in ${(warm.ms / 1000).toFixed(1)}s`);

    let embedded = 0;
    let chunks = 0;
    let skipped = 0;
    let failed = 0;
    const started = Date.now();

    for (const [index, row] of pending.entries()) {
      const outcome = await embedMessage(db, row.id);
      const position = `${index + 1}/${pending.length}`;

      if (outcome.status === 'embedded') {
        embedded += 1;
        chunks += outcome.chunks;
        console.info(`[embed-backfill] ${position} embedded message=${row.id} (${outcome.chunks} chunks)`);
      } else if (outcome.status === 'skipped') {
        skipped += 1;
        console.info(`[embed-backfill] ${position} skipped  message=${row.id} (${outcome.reason})`);
      } else {
        failed += 1;
        console.error(`[embed-backfill] ${position} FAILED   message=${row.id}: ${outcome.reason}`);
      }
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.info(
      `[embed-backfill] done in ${seconds}s: ` +
        `messages=${embedded} chunks=${chunks} skipped=${skipped} failed=${failed}`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('[embed-backfill]', error instanceof Error ? error.message : error);
  process.exit(1);
});

/**
 * Measure the similarity distribution, to set the refusal floor from evidence.
 *
 * Run:
 *   node --env-file=apps/worker/.env \
 *     apps/worker/node_modules/tsx/dist/cli.mjs \
 *     apps/worker/scripts/probe-floor.ts
 *
 * ── Why this exists rather than a guessed constant ───────────────────────────
 *
 * ADR-007 requires the assistant to **refuse rather than guess**, and the
 * mechanism is a similarity floor. Picking that number by intuition is how the
 * refusal path ends up either useless (nothing is ever refused) or hostile
 * (everything is). It has to be read off the real corpus.
 *
 * The reason it needs measuring at all is a property of e5: its normalised
 * embeddings sit in a **narrow band**. An early two-sentence probe put a
 * relevant match at 0.854 and an unrelated one at 0.771 — a gap of 0.08, not
 * the 0.9-vs-0.2 spread people expect from cosine similarity. A floor of 0.5,
 * which looks conservative, would let literally everything through.
 *
 * ⚠ Run this again after any change to the model, the chunker, or the e5
 * prefixes. All three move the distribution.
 */

import { embedQuery, toVectorLiteral, warmEmbedder } from '@switchboard/ai';
import { createDbClient } from '@switchboard/db';
import { sql } from 'drizzle-orm';

/** Questions the corpus can genuinely answer — Yuri's real mail. */
const ANSWERABLE = [
  'do I have any upcoming meetings?',
  'did any deployment fail?',
  'what did the bank say about my transfer?',
  'are there any job applications or interviews?',
  'what failed in CI?',
];

/**
 * Questions with nothing behind them. These MUST be refused — ADR-007 is
 * explicit that a monitoring tool inventing a meeting is worse than one saying
 * "I don't have anything about that".
 */
const UNANSWERABLE = [
  'what did we agree about the Jakarta office?',
  'how much did the helicopter lease cost?',
  'what is the recipe for adobo my grandmother sent?',
  'when is the submarine delivery scheduled?',
  'what did the veterinarian say about the horse?',
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const { db, sql: client } = createDbClient(databaseUrl);

  try {
    const warm = await warmEmbedder();
    if (!warm.ok) throw new Error(warm.reason);

    const measure = async (question: string) => {
      const vector = await embedQuery(question);
      const rows = await db.execute<{ similarity: number; subject: string | null }>(sql`
        select similarity, subject
          from match_chunks(${toVectorLiteral(vector)}::vector, 5, 0.0, null)
      `);
      return {
        question,
        top: rows[0]?.similarity ?? 0,
        fifth: rows[4]?.similarity ?? 0,
        best: (rows[0]?.subject ?? '(no subject)').slice(0, 46),
      };
    };

    console.info('\n── ANSWERABLE ─────────────────────────────────────────────');
    const answerable = [];
    for (const q of ANSWERABLE) {
      const r = await measure(q);
      answerable.push(r.top);
      console.info(`  top=${r.top.toFixed(4)}  5th=${r.fifth.toFixed(4)}  ${r.question}`);
      console.info(`      best match: ${r.best}`);
    }

    console.info('\n── UNANSWERABLE (must be refused) ─────────────────────────');
    const unanswerable = [];
    for (const q of UNANSWERABLE) {
      const r = await measure(q);
      unanswerable.push(r.top);
      console.info(`  top=${r.top.toFixed(4)}  5th=${r.fifth.toFixed(4)}  ${r.question}`);
      console.info(`      best match: ${r.best}`);
    }

    const min = (a: number[]) => Math.min(...a);
    const max = (a: number[]) => Math.max(...a);

    const lowestAnswerable = min(answerable);
    const highestUnanswerable = max(unanswerable);

    console.info('\n── VERDICT ────────────────────────────────────────────────');
    console.info(`  lowest ANSWERABLE top score   : ${lowestAnswerable.toFixed(4)}`);
    console.info(`  highest UNANSWERABLE top score: ${highestUnanswerable.toFixed(4)}`);
    console.info(`  separation                    : ${(lowestAnswerable - highestUnanswerable).toFixed(4)}`);

    if (lowestAnswerable > highestUnanswerable) {
      const floor = (lowestAnswerable + highestUnanswerable) / 2;
      console.info(`\n  ✓ SEPARABLE. Suggested floor: ${floor.toFixed(3)}`);
    } else {
      console.info(
        '\n  ✗ NOT SEPARABLE by top score alone. A floor cannot cleanly divide these,\n' +
          '    so the refusal path must lean on the model being told to refuse from\n' +
          '    context rather than on retrieval alone.',
      );
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

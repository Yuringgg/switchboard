/**
 * What actually reaches the model — retrieval only, ZERO provider calls.
 *
 * Run:
 *   node --env-file=apps/worker/.env \
 *     apps/worker/node_modules/tsx/dist/cli.mjs \
 *     apps/worker/scripts/probe-context.ts
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * `eval-assistant.ts` measures the ANSWER, which costs one Groq call per case —
 * roughly half a day's token budget for one full run. That makes it a bad
 * instrument for the question "why did this case fail?", because you can only
 * ask twice.
 *
 * Everything before the model call is free: embeddings are local and
 * `match_chunks` is Postgres. So this prints the *input* to the model — how many
 * messages survived `selectContext`, how tightly they cluster, and which ones
 * they are — for every eval question at once, at no quota cost.
 *
 * It answers a specific question the answer-level eval cannot: is a failing case
 * failing because the PROMPT judged wrongly, or because the context handed to it
 * was starved before the model ever saw it? Those have opposite fixes.
 *
 * ⚠ Prints subjects and similarity only, never bodies. `docs/02-ARCHITECTURE.md`
 * §6: message content is not logged.
 */

import {
  ABSOLUTE_FLOOR,
  MAX_CONTEXT_MESSAGES,
  RELATIVE_FLOOR,
  embedQuery,
  selectContext,
  toVectorLiteral,
  warmEmbedder,
  type RetrievedMessage,
} from '@switchboard/ai';
import { createDbClient } from '@switchboard/db';
import { sql } from 'drizzle-orm';

import { selectCases } from './eval-cases';

const OWNER_ID = process.env.EVAL_OWNER_ID ?? 'ec7645a6-11b8-456a-bbcc-03b94e5841db';

/**
 * `--only "<substring>"` narrows to matching questions and prints ALL retrieved
 * rows, marking which the floors dropped — which is how you tell "the model
 * judged this wrongly" from "the model never saw it".
 */
const only = process.argv.includes('--only');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const { db, sql: client } = createDbClient(databaseUrl);

  try {
    const warm = await warmEmbedder();
    if (!warm.ok) throw new Error(warm.reason);
    console.info(`model ready in ${(warm.ms / 1000).toFixed(1)}s`);
    console.info(
      `absolute=${ABSOLUTE_FLOOR} relative=${RELATIVE_FLOOR} max=${MAX_CONTEXT_MESSAGES}\n`,
    );

    for (const testCase of selectCases(process.argv)) {
      const vector = await embedQuery(testCase.question);

      // Same transaction-scoped RLS impersonation as eval-assistant.ts: the
      // worker's connection is service_role, and searching every tenant would
      // measure something the product never does.
      const rows = await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('role', 'authenticated', true)`);
        await tx.execute(
          sql`select set_config('request.jwt.claims', ${JSON.stringify({
            sub: OWNER_ID,
            role: 'authenticated',
          })}, true)`,
        );
        return tx.execute<{
          message_id: string;
          content: string;
          similarity: number;
          subject: string | null;
          body_text: string;
          sent_at: string;
          direction: string;
          sender_name: string | null;
          sender_ref: string | null;
        }>(sql`select * from match_chunks(${toVectorLiteral(vector)}::vector, 20, 0, null)`);
      });

      const retrieved: RetrievedMessage[] = rows.map((row) => ({
        messageId: row.message_id,
        similarity: row.similarity,
        subject: row.subject,
        content: row.content,
        bodyText: row.body_text,
        sentAt: row.sent_at,
        direction: row.direction,
        senderName: row.sender_name,
        senderRef: row.sender_ref,
        channelLabel: 'Gmail',
      }));

      const context = selectContext(retrieved);
      const top = retrieved[0]?.similarity ?? 0;
      const spread = top - (retrieved.at(-1)?.similarity ?? top);

      const label = { answer: '[answer]  ', refuse: '[refuse]  ', 'known-gap': '[gap]     ' };
      console.info(`${label[testCase.expect]}${testCase.question}`);
      console.info(
        `   retrieved=${retrieved.length} kept=${context.length}` +
          `  top=${top.toFixed(4)} spread=${spread.toFixed(4)}` +
          `  cutoff=${(top - RELATIVE_FLOOR).toFixed(4)}`,
      );

      // With --only, show everything retrieved and mark what the floors cut, so
      // a missing message is visibly missing rather than silently absent.
      const shown = only ? retrieved : context;
      const kept = new Set(context.map((message) => message.messageId));

      for (const [index, message] of shown.entries()) {
        const subject = (message.subject ?? '(no subject)').replace(/\s+/g, ' ').slice(0, 58);
        const mark = only ? (kept.has(message.messageId) ? ' keep ' : ' DROP ') : '';
        console.info(
          `     ${String(index + 1).padStart(2)}.${mark}${message.similarity.toFixed(4)}  ${message.sentAt.slice(0, 10)}  ${subject}`,
        );
      }
      console.info('');
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

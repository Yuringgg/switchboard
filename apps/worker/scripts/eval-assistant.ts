/**
 * The Phase 4B eval set (US-6, ADR-007, ADR-016, `docs/04-ROADMAP.md`).
 *
 * Run:
 *   node --env-file=apps/worker/.env \
 *     apps/worker/node_modules/tsx/dist/cli.mjs \
 *     apps/worker/scripts/eval-assistant.ts
 *
 * ── Why this exists, and why it was written before the prompt was tuned ──────
 *
 * The roadmap is explicit: *"write the eval set before tuning the prompt, or
 * you're adjusting wording and guessing."* It is doubly true here, because
 * ADR-016 moved the entire refusal from a threshold — which could be checked
 * with arithmetic — onto the model. The refusal is now a **measured** property,
 * and this is the thing that measures it.
 *
 * ⚠ Half these cases MUST be refused. That is not a fringe case: the success
 * criteria in `docs/01-PRODUCT-SPEC.md` §7 require *"Assistant answers with no
 * citation — must refuse rather than guess"*, and a monitoring tool that
 * invents a meeting is worse than one that admits it does not know.
 *
 * ⚠ This costs real Gemini quota — one call per case. Run it when the prompt,
 * the model, the chunker or the floors change. It is deliberately NOT part of
 * `pnpm check`: a suite needing a key and a network starts getting skipped.
 */

import {
  ASSISTANT_SYSTEM_PROMPT,
  buildAssistantPrompt,
  createAssistantProvider,
  embedQuery,
  parseAnswer,
  selectContext,
  toVectorLiteral,
  warmEmbedder,
  type RetrievedMessage,
} from '@switchboard/ai';
import { createDbClient } from '@switchboard/db';
import { sql } from 'drizzle-orm';

import { selectCases } from './eval-cases';

/** The tenant whose mail the corpus belongs to. RLS is set to them per query. */
const OWNER_ID = process.env.EVAL_OWNER_ID ?? 'ec7645a6-11b8-456a-bbcc-03b94e5841db';

/**
 * The cases, their three expectations, and the reasoning behind each, live in
 * `eval-cases.ts` — shared with `probe-context.ts` so the two cannot drift.
 */

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const chosen = createAssistantProvider({
    groqApiKey: process.env.GROQ_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    preferred: process.env.ASSISTANT_PROVIDER,
  });
  if (!chosen.ok) throw new Error(chosen.reason);
  const gemini = chosen.provider;

  const { db, sql: client } = createDbClient(databaseUrl);
  console.info(`assistant model: ${gemini.model}`);

  try {
    const warm = await warmEmbedder();
    if (!warm.ok) throw new Error(warm.reason);
    console.info(`model ready in ${(warm.ms / 1000).toFixed(1)}s\n`);

    const selected = selectCases(process.argv);
    console.info(`${selected.length} case${selected.length === 1 ? '' : 's'} selected\n`);

    const score = {
      answer: { passed: 0, total: 0 },
      refuse: { passed: 0, total: 0 },
    };
    let gaps = 0;
    let providerErrors = 0;

    for (const testCase of selected) {
      const vector = await embedQuery(testCase.question);

      /*
       * ⚠ RLS is set explicitly, exactly as it would be for a signed-in user.
       *
       * The worker's connection is `service_role`, which BYPASSES RLS — running
       * `match_chunks` on it would search every tenant and the eval would pass
       * while the product leaked. Setting the role and the JWT claim makes this
       * measure what the console actually does.
       */
      /*
       * ⚠ A TRANSACTION, not three separate statements.
       *
       * `set_config(..., is_local => true)` is scoped to the current
       * transaction AND the current connection. postgres.js pools, so issued as
       * separate `db.execute` calls the two settings and the query can land on
       * three different connections — the role reverts, `match_chunks` runs as
       * `service_role`, RLS is bypassed, and the eval passes while measuring
       * something the product never does.
       *
       * (Combining them into one multi-statement string does not work either:
       * postgres.js refuses parameters in a multi-statement query.)
       */
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

      let answer = "I don't have anything about that in your messages.";
      let parsed = { text: answer, citedMessageIds: [] as string[], refused: true };

      if (context.length > 0) {
        const prompt = buildAssistantPrompt(testCase.question, context);
        let completion = await gemini.complete(ASSISTANT_SYSTEM_PROMPT, prompt);

        /*
         * ⚠ Gemini 2.5 Flash's free tier is **10 requests per minute**, and
         * that is the limit this hits — not the 250,000 tokens/min that ADR-003
         * chose it for. The first run of this eval sent one case every 1.2s and
         * seven of fifteen came back 429, which reads as "the assistant is
         * broken" when it is "the eval is impatient".
         *
         * Waiting and retrying once is right here for the same reason it is in
         * the summary backfill: a busy minute is not an exhausted quota.
         */
        if (!completion.ok && completion.retryable) {
          const waitMs = Math.min(completion.retryAfterMs ?? 20_000, 60_000);
          console.info(`       rate limited, waiting ${Math.round(waitMs / 1000)}s…`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          completion = await gemini.complete(ASSISTANT_SYSTEM_PROMPT, prompt);
        }

        if (!completion.ok) {
          /*
           * ⚠ A provider failure is NOT a logic failure, and must not be
           * counted as one. `groq rate limit` here means the day's token
           * allowance is gone — re-run tomorrow rather than "fixing" a prompt
           * that was never measured. Counted separately so a run that lost
           * cases to quota cannot be mistaken for a run that regressed.
           */
          console.info(`[SKIP] ${testCase.question}\n   ->  provider: ${completion.reason}\n`);
          providerErrors += 1;
          continue;
        }
        parsed = parseAnswer(completion.text, context);
        answer = parsed.text;
      }

      const problems: string[] = [];

      if (testCase.expect === 'refuse' && !parsed.refused) {
        problems.push(
          `ANSWERED a question with no answer in the corpus (cited ${parsed.citedMessageIds.length})`,
        );
      }
      if (testCase.expect === 'answer' && parsed.refused) {
        problems.push('refused a question the corpus can answer');
      }
      if (testCase.expect === 'answer' && testCase.expectSomeOf) {
        const lower = answer.toLowerCase();
        if (!testCase.expectSomeOf.some((term) => lower.includes(term))) {
          problems.push(`none of [${testCase.expectSomeOf.join(', ')}] in the answer`);
        }
      }

      let mark: string;

      if (testCase.expect === 'known-gap') {
        // Reported, never scored. Printing what it actually did is the point:
        // if a future change makes one of these answer well, it shows up here
        // rather than staying invisible behind an exclusion.
        mark = parsed.refused ? 'GAP ' : 'GAP*';
        gaps += 1;
      } else {
        const bucket = score[testCase.expect];
        bucket.total += 1;
        if (problems.length === 0) {
          bucket.passed += 1;
          mark = 'PASS';
        } else {
          mark = 'FAIL';
        }
      }

      const label =
        testCase.expect === 'refuse'
          ? '(must refuse) '
          : testCase.expect === 'known-gap'
            ? '(known gap) '
            : '';

      console.info(`[${mark}] ${label}${testCase.question}`);
      console.info(
        `       retrieved=${retrieved.length} context=${context.length} cited=${parsed.citedMessageIds.length}`,
      );
      console.info(`       ${answer.replace(/\s+/g, ' ').slice(0, 150)}`);
      for (const problem of problems) console.info(`   ->  ${problem}`);
      if (testCase.gap) console.info(`   ->  ${testCase.gap}`);
      console.info('');

      /*
       * Paced for the token window, which is what binds a RAG prompt.
       *
       * Groq's 70B allows 12,000 tokens/min and a prompt here runs 2,000–3,000,
       * so ~4 requests/minute is the ceiling. 3s is comfortably inside it.
       *
       * ⚠ On `ASSISTANT_PROVIDER=gemini` this eval will fail most of its cases
       * regardless of pacing: the free tier is **20 requests per DAY** (measured
       * 2026-08-02), and one full run needs 15.
       */
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }

    /*
     * Reported as two separate scores, never as one number.
     *
     * A single "11/15" hides the only thing worth knowing: which DIRECTION it
     * is failing in. ADR-007 is explicit that the two are not equivalent —
     * refusing wrongly is safe, answering wrongly is the failure that gets a
     * monitoring tool uninstalled. A combined score would have read identically
     * for the 7/7-answerable-3/8-refusals prompt and for its opposite.
     */
    const line = (name: string, bucket: { passed: number; total: number }) =>
      `${name}: ${bucket.passed}/${bucket.total}`;

    console.info(
      `${line('answerable', score.answer)}   ${line('must-refuse', score.refuse)}` +
        (gaps > 0 ? `   known gaps: ${gaps} (reported, not scored)` : '') +
        (providerErrors > 0 ? `   provider errors: ${providerErrors}` : ''),
    );

    if (providerErrors > 0) {
      console.info(
        '\n⚠ Cases were lost to the provider, most likely the daily token cap.\n' +
          '  That is not a logic result — re-run tomorrow before concluding anything.',
      );
    }

    const failures =
      score.answer.total -
      score.answer.passed +
      (score.refuse.total - score.refuse.passed);

    if (failures > 0 || providerErrors > 0) process.exitCode = 1;
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

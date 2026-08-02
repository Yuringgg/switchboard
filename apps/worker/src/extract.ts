import {
  buildExtractionPrompt,
  randomNonce,
  shouldExtract,
  EXTRACTION_SYSTEM_PROMPT,
  validateExtractions,
  type CompletionProvider,
} from '@switchboard/ai';
import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

/**
 * Phase 5: pull structured rows out of a message (US-7, US-9, ADR-006).
 *
 * ⚠⚠ **THIS STEP MUST NEVER FAIL AN EVENT.**
 *
 * The same guarantee `summarize.ts` carries, for the same reason and with the
 * same shape: extraction is additive. If Groq is down, rate-limited, slow, or
 * simply not configured, the message must still ingest, still appear on the
 * timeline, still be searchable and still be embedded. One provider outage
 * stopping all mail would be a far worse product than one with no proposals.
 *
 * So every path here returns an outcome; nothing thrown escapes. The caller
 * logs the outcome and moves on.
 *
 * ── Where this runs ──────────────────────────────────────────────────────────
 *
 * In the worker, AFTER `persistMessage`, never in the ingest webhook — that
 * path must answer in milliseconds or providers retry and eventually disable
 * the endpoint (ADR-011).
 *
 * ── What it feeds ────────────────────────────────────────────────────────────
 *
 * The "needs attention" view (US-9) and the calendar proposals (US-7b,
 * ADR-010). ⚠ **Nothing here writes to a calendar and nothing here is
 * confirmed.** Every row lands with `calendar_event_id` and `confirmed_at`
 * null, which is what makes it a proposal. ADR-010 is absolute: propose, never
 * assert.
 */

export type ExtractOutcome =
  | { status: 'written'; rows: number; dropped: number }
  | { status: 'skipped'; reason: string }
  | {
      status: 'failed';
      reason: string;
      retryable: boolean;
      /** From the provider's `retry-after`, when it gave one. */
      retryAfterMs?: number;
    };

/** `extends Record<string, unknown>` to satisfy `db.execute`'s row constraint. */
interface Candidate extends Record<string, unknown> {
  id: string;
  owner_id: string;
  subject: string | null;
  body_text: string;
  sent_at: string;
  sender_display_name: string | null;
  channel_type: string | null;
}

/**
 * JSON needs more room than prose.
 *
 * The summariser asks for 160 tokens because two sentences fit in that. Six
 * structured items carrying verbatim quotes will not: a truncated response is
 * invalid JSON, which `validateExtractions` correctly rejects — so an
 * under-sized ceiling shows up as "the model keeps returning malformed JSON",
 * which reads as a prompt problem and is not one.
 *
 * ── ⚠ 900 was too low, and the way it failed is the point ───────────────────
 *
 * Measured on the first full backfill, 2026-08-03: two messages failed with
 * **1,798 characters** of JSON that stopped mid-structure. 1,798 characters is
 * nowhere near 900 tokens at the usual four-characters-per-token rule of thumb
 * — but this corpus is **Taglish with emoji**, and non-ASCII inside quoted
 * strings tokenises at closer to two characters per token. So 1,798 characters
 * *is* the 900-token ceiling, reached at half the length anyone would predict
 * from the English intuition.
 *
 * Raised to 1,600. It costs nothing to do so: `max_tokens` is a ceiling, not a
 * reservation — measured against the live API the same day, a request with
 * `max_tokens: 900` was billed `completion_tokens: 159`. The tokens-per-minute
 * window is spent on the **prompt** (~3,370 of ~3,530), so this constant is
 * free headroom and the input cap is the lever that is not.
 *
 * ⚠ It was only diagnosable because `validateExtractions` distinguishes "ended
 * mid-structure" from "answered in prose". Reported as one message they have
 * the same words and opposite fixes.
 */
const EXTRACTION_MAX_TOKENS = 1600;

/**
 * Extract from one message.
 *
 * ── The idempotency check comes FIRST, before anything is spent ──────────────
 *
 * Redelivery and re-ingest are routine on this pipeline: Pub/Sub redelivers,
 * Meta retries for up to 7 days, and the backfill script exists to be run more
 * than once.
 *
 * ⚠ Unlike summaries, `extractions` has **no unique key to conflict on** —
 * Phase 5's kinds are many-per-message by design (migration 0008), and a
 * message that legitimately yields nothing is indistinguishable from one never
 * processed. `on conflict` cannot help and `exists(... from extractions ...)`
 * answers the wrong question. That is what `message_extraction_runs` is for
 * (migration 0011), and reading it here — before the API call — is what stops
 * a redelivery re-paying a shared daily allowance to be told nothing again.
 */
export async function extractMessage(
  db: Database,
  provider: CompletionProvider,
  messageId: string,
): Promise<ExtractOutcome> {
  try {
    const already = await db.execute<{ message_id: string }>(sql`
      select message_id from message_extraction_runs
       where message_id = ${messageId}
       limit 1
    `);
    if (already[0]) return { status: 'skipped', reason: 'already extracted' };

    const rows = await db.execute<Candidate>(sql`
      select
        m.id, m.owner_id, m.subject, m.body_text, m.sent_at,
        ci.display_name as sender_display_name,
        c.type          as channel_type
      from messages m
      left join contact_identities ci on ci.id = m.sender_identity
      left join channels c            on c.id = m.channel_id
      where m.id = ${messageId}
      limit 1
    `);

    const message = rows[0];
    if (!message) return { status: 'skipped', reason: 'message not found' };

    const sentAt = new Date(message.sent_at);

    const decision = shouldExtract(message.body_text);
    if (!decision.extract) {
      /*
       * Recorded as a completed run even though no request was made.
       *
       * The pass ran and decided there was nothing to send — that is a real,
       * final outcome for this message, and remembering it is what keeps the
       * backfill's "remaining" count meaningful. `rows_written = 0` says
       * plainly that nothing came of it.
       */
      await recordRun(db, message.owner_id, message.id, provider.model, 0);
      return { status: 'skipped', reason: decision.reason };
    }

    const prompt = buildExtractionPrompt(
      {
        subject: message.subject,
        bodyText: message.body_text,
        senderName: message.sender_display_name,
        channel: message.channel_type,
        sentAt,
      },
      // ⚠ A FRESH nonce per request. A fixed delimiter is guessable, and a
      // guessable delimiter is one a hostile message body can close.
      randomNonce(),
    );

    const completion = await provider.complete(EXTRACTION_SYSTEM_PROMPT, prompt, {
      maxTokens: EXTRACTION_MAX_TOKENS,
      // Lower than the summariser's 0.2. This is a structural task with a right
      // answer, not a writing task — variability here is not creativity, it is
      // the same message yielding different proposals on different days.
      temperature: 0,
    });

    if (!completion.ok) {
      // ⚠ No run recorded: the work is still outstanding and the backfill must
      // pick it up. A rate limit is not a result.
      return {
        status: 'failed',
        reason: completion.reason,
        retryable: completion.retryable,
        ...(completion.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: completion.retryAfterMs }),
      };
    }

    const validated = validateExtractions(completion.text, message.body_text, sentAt);

    if (!validated.ok) {
      /*
       * ⚠ *"A parse failure is a failed job to retry, not a row to insert"* —
       * `docs/02-ARCHITECTURE.md` §8. Nothing is inserted and **no run is
       * recorded**, so the message stays outstanding for the backfill.
       *
       * `retryable: false` all the same: an identical prompt at temperature 0
       * reproduces an identical malformed answer, so retrying it *immediately*
       * spends a request to fail the same way. It is the batch that must not
       * stop, not the work that must be abandoned.
       */
      return { status: 'failed', reason: validated.reason, retryable: false };
    }

    /*
     * ── The write, in ONE transaction ─────────────────────────────────────────
     *
     * ⚠ The rows and the run record must land together. Rows without a run mean
     * the next pass extracts the same message again and **doubles every
     * proposal**; a run without its rows means the message is marked done and
     * its real commitments are lost with no way to notice.
     */
    await db.transaction(async (tx) => {
      /*
       * ⚠⚠ NEVER DELETE A CONFIRMED PROPOSAL.
       *
       * Re-extraction replaces a message's unconfirmed proposals, which is what
       * makes "re-run with a better prompt" a clean operation. But a row that
       * has been confirmed carries `calendar_event_id` — **the idempotency
       * guard for a real Google Calendar event** (ADR-010). Deleting it orphans
       * the event AND throws away the only record that it exists, so the next
       * confirmation creates a SECOND event on someone's real calendar. That is
       * the exact failure `docs/02-ARCHITECTURE.md` §4b exists to prevent.
       *
       * `kind <> 'summary'` because Phase 4A's row lives in this table too and
       * is none of this pass's business.
       */
      await tx.execute(sql`
        delete from extractions
         where message_id = ${message.id}
           and kind <> 'summary'
           and calendar_event_id is null
           and confirmed_at is null
      `);

      for (const item of validated.items) {
        /*
         * ⚠ owner_id comes from the MESSAGE row, which took it from the
         * channel. The worker runs as `service_role`, so RLS is inert here and
         * this value is the only thing keeping tenants apart. There is no path
         * by which a provider payload reaches it.
         */
        await tx.execute(sql`
          insert into extractions
            (owner_id, message_id, kind, payload, confidence, model)
          values (
            ${message.owner_id}, ${message.id}, ${item.kind},
            ${JSON.stringify({
              title: item.title,
              quote: item.quote,
              starts_at: item.startsAt,
              ends_at: item.endsAt,
              due_at: item.dueAt,
              owed_by: item.owedBy,
              participants: item.participants,
              location: item.location,
            })}::jsonb,
            ${item.confidence}, ${completion.model}
          )
        `);
      }

      await recordRun(
        tx,
        message.owner_id,
        message.id,
        completion.model,
        validated.items.length,
      );
    });

    return {
      status: 'written',
      rows: validated.items.length,
      dropped: validated.dropped.length,
    };
  } catch (cause) {
    /*
     * The catch-all that makes the guarantee at the top of this file true.
     *
     * ⚠ The message, never the cause object: an error from a completion API can
     * echo the prompt, and the prompt is a message body. §6.
     */
    return {
      status: 'failed',
      reason: cause instanceof Error ? cause.message : 'extraction errored',
      retryable: true,
    };
  }
}

/**
 * Mark a message as having been through the pass.
 *
 * An upsert rather than an insert: the guard above means we normally only get
 * here once, but a concurrent worker replica claiming a redelivery of the same
 * event could race it, and a primary-key violation inside the transaction would
 * roll back rows that are perfectly good.
 */
async function recordRun(
  db: Pick<Database, 'execute'>,
  ownerId: string,
  messageId: string,
  model: string,
  rowsWritten: number,
): Promise<void> {
  await db.execute(sql`
    insert into message_extraction_runs (message_id, owner_id, model, rows_written)
    values (${messageId}, ${ownerId}, ${model}, ${rowsWritten})
    on conflict (message_id) do update
      set model = excluded.model,
          rows_written = excluded.rows_written,
          created_at = now()
  `);
}

/**
 * Extract from everything an ingest just created, without letting any of it
 * disturb the ingest.
 *
 * Sequential rather than `Promise.all`, and the reason is sharper than it was
 * for summaries: extraction shares `llama-3.1-8b-instant`'s **6,000
 * tokens/minute** window with the summariser, and this step runs immediately
 * after it on the same messages. Firing a Gmail history replay's dozen messages
 * concurrently is the shape that trips the limit, and the reward would be a few
 * seconds saved on a step nothing is waiting for.
 */
export async function extractBatch(
  db: Database,
  provider: CompletionProvider,
  messageIds: string[],
): Promise<{ written: number; rows: number; skipped: number; failed: number }> {
  let written = 0;
  let rows = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of messageIds) {
    const outcome = await extractMessage(db, provider, id);

    if (outcome.status === 'written') {
      written += 1;
      rows += outcome.rows;
    } else if (outcome.status === 'skipped') {
      skipped += 1;
    } else {
      failed += 1;
      // Message id and a reason, never content. docs/02-ARCHITECTURE.md §6.
      console.warn(`[extract] message=${id} failed: ${outcome.reason}`);

      /*
       * Stop the batch on a retryable failure.
       *
       * A 429 or an outage will hit the next twelve messages identically, and
       * grinding through them turns one rate-limit response into twelve. They
       * are not lost — no run is recorded for a failure, so `extractMessage` is
       * idempotent and the backfill picks up anything without a run.
       */
      if (outcome.retryable) break;
    }
  }

  return { written, rows, skipped, failed };
}

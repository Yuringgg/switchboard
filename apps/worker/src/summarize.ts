import {
  buildSummaryPrompt,
  randomNonce,
  shouldSummarise,
  SUMMARY_SYSTEM_PROMPT,
  validateSummary,
  type CompletionProvider,
} from '@switchboard/ai';
import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

/**
 * Phase 4A: write one summary per message (ADR-015).
 *
 * ⚠⚠ **THIS STEP MUST NEVER FAIL AN EVENT.**
 *
 * A summary is additive. If Groq is down, rate-limited, slow, or simply not
 * configured, the message must still ingest and still appear on the timeline —
 * `docs/04-ROADMAP.md` states that as a requirement and it is the single most
 * important property of this file. One provider outage stopping all mail would
 * be a far worse product than one with no summaries.
 *
 * So every path here returns an outcome; nothing thrown escapes. The caller
 * logs the outcome and moves on.
 *
 * ── Where this runs ──────────────────────────────────────────────────────────
 *
 * In the worker, AFTER `persistMessage`, never in the ingest webhook. ADR-015
 * rejects summarising in the webhook outright: that path must answer in
 * milliseconds or providers retry and eventually disable the endpoint (ADR-011).
 */

export type SummaryOutcome =
  | { status: 'written' }
  | { status: 'skipped'; reason: string }
  | {
      status: 'failed';
      reason: string;
      retryable: boolean;
      /** From the provider's `retry-after`, when it gave one. */
      retryAfterMs?: number;
    };

/** `extends Record<string, unknown>` to satisfy `db.execute`'s row constraint,
 *  the same way `ChannelRow` does in gmail-ingest.ts. */
interface Candidate extends Record<string, unknown> {
  id: string;
  owner_id: string;
  subject: string | null;
  body_text: string;
  sender_display_name: string | null;
  channel_type: string | null;
}

/**
 * Summarise one message.
 *
 * ── The idempotency check comes FIRST, before the skip rules ─────────────────
 *
 * Redelivery and re-ingest are routine on this pipeline: Pub/Sub redelivers,
 * Meta retries for up to 7 days, and the backfill script exists to be run more
 * than once. Paying for the same summary twice is the mild outcome; exhausting
 * a 14,400/day allowance on work already done is the real one.
 *
 * It reads `extractions` rather than trusting `on conflict do nothing` to
 * absorb it, because `on conflict` only saves the *write* — by then the request
 * has been made and the quota spent.
 */
export async function summariseMessage(
  db: Database,
  provider: CompletionProvider,
  messageId: string,
): Promise<SummaryOutcome> {
  try {
    const existing = await db.execute<{ id: string }>(sql`
      select id from extractions
       where message_id = ${messageId} and kind = 'summary'
       limit 1
    `);
    if (existing[0]) return { status: 'skipped', reason: 'already summarised' };

    const rows = await db.execute<Candidate>(sql`
      select
        m.id, m.owner_id, m.subject, m.body_text,
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

    const decision = shouldSummarise(message.body_text);
    if (!decision.summarise) {
      return { status: 'skipped', reason: decision.reason };
    }

    const prompt = buildSummaryPrompt(
      {
        subject: message.subject,
        bodyText: message.body_text,
        senderName: message.sender_display_name,
        channel: message.channel_type,
      },
      // ⚠ A FRESH nonce per request. A fixed delimiter is guessable, and a
      // guessable delimiter is one a hostile message body can close.
      randomNonce(),
    );

    const completion = await provider.complete(SUMMARY_SYSTEM_PROMPT, prompt);
    if (!completion.ok) {
      return {
        status: 'failed',
        reason: completion.reason,
        retryable: completion.retryable,
        ...(completion.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: completion.retryAfterMs }),
      };
    }

    const validated = validateSummary(completion.text);
    if (!validated.ok) {
      // Not retryable: the model answered, we just could not use the answer.
      // Retrying an identical prompt at temperature 0.2 mostly reproduces it.
      return { status: 'failed', reason: validated.reason, retryable: false };
    }

    /*
     * ⚠ owner_id comes from the MESSAGE row, which took it from the channel.
     * The worker runs as `service_role`, so RLS is inert here and this value is
     * the only thing keeping tenants apart. There is no path by which a
     * provider payload reaches it.
     *
     * `on conflict` targets the partial unique index from migration 0008 and
     * updates rather than ignores: re-running with a better prompt should
     * REPLACE the summary, and `model` records which prompt produced it, which
     * is what makes "did the new prompt help?" answerable (ADR-006).
     */
    await db.execute(sql`
      insert into extractions (owner_id, message_id, kind, payload, model)
      values (
        ${message.owner_id}, ${message.id}, 'summary',
        ${JSON.stringify({ text: validated.text })}::jsonb, ${completion.model}
      )
      on conflict (message_id) where kind = 'summary'
      do update set payload = excluded.payload, model = excluded.model, created_at = now()
    `);

    return { status: 'written' };
  } catch (cause) {
    /*
     * The catch-all that makes the guarantee at the top of this file true.
     *
     * A database hiccup, a malformed row, an unexpected shape — none of it may
     * reach the worker's event loop, because there `markFailed` would burn an
     * attempt and eventually park a message that ingested perfectly well.
     *
     * ⚠ The message, never the cause object: an error from a completion API can
     * echo the prompt, and the prompt is a message body. §6.
     */
    return {
      status: 'failed',
      reason: cause instanceof Error ? cause.message : 'summarisation errored',
      retryable: true,
    };
  }
}

/**
 * Summarise every message an ingest just created, without letting any of it
 * disturb the ingest.
 *
 * Sequential rather than `Promise.all`: Groq's free tier is 30 requests/minute,
 * and a Gmail history replay can create a dozen messages in one event. Firing
 * them together is the shape that trips a rate limit, and the reward would be a
 * second saved on a step nothing is waiting for.
 */
export async function summariseBatch(
  db: Database,
  provider: CompletionProvider,
  messageIds: string[],
): Promise<{ written: number; skipped: number; failed: number }> {
  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of messageIds) {
    const outcome = await summariseMessage(db, provider, id);

    if (outcome.status === 'written') written += 1;
    else if (outcome.status === 'skipped') skipped += 1;
    else {
      failed += 1;
      // Message id and a reason, never content. §6.
      console.warn(`[summary] message=${id} failed: ${outcome.reason}`);

      /*
       * Stop the batch on a retryable failure.
       *
       * A 429 or an outage will hit the next twelve messages identically, and
       * grinding through them turns one rate-limit response into twelve. They
       * are not lost — `summariseMessage` is idempotent and the backfill script
       * picks up anything without a summary.
       */
      if (outcome.retryable) break;
    }
  }

  return { written, skipped, failed };
}

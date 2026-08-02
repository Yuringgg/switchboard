import { chunkText, embedPassages, toVectorLiteral } from '@switchboard/ai';
import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

/**
 * Phase 4B: chunk a message and store its embeddings.
 *
 * ⚠⚠ **THIS MUST NEVER FAIL AN EVENT**, exactly like summarisation. Embedding
 * is additive: without it the assistant has less to retrieve, but the message
 * still arrives, still renders, and is still findable by keyword search. A
 * model that failed to load must degrade to "no semantic search", never to "no
 * mail". Every path here returns an outcome; nothing thrown escapes.
 */

export type EmbedOutcome =
  | { status: 'embedded'; chunks: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

interface Candidate extends Record<string, unknown> {
  id: string;
  owner_id: string;
  subject: string | null;
  body_text: string;
}

/**
 * Chunk and embed one message.
 *
 * ── The idempotency check comes first ────────────────────────────────────────
 *
 * Redelivery and re-ingest are routine here — Pub/Sub redelivers, Meta retries
 * for up to 7 days, and the backfill exists to be run more than once. Embedding
 * costs no quota (it is local), but it does cost CPU on a container sized for
 * one job at a time, and re-embedding the corpus on every redelivery would
 * starve ingest.
 */
export async function embedMessage(
  db: Database,
  messageId: string,
): Promise<EmbedOutcome> {
  try {
    const existing = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from message_chunks where message_id = ${messageId}
    `);
    if ((existing[0]?.n ?? 0) > 0) {
      return { status: 'skipped', reason: 'already embedded' };
    }

    const rows = await db.execute<Candidate>(sql`
      select id, owner_id, subject, body_text
        from messages where id = ${messageId} limit 1
    `);

    const message = rows[0];
    if (!message) return { status: 'skipped', reason: 'message not found' };

    /*
     * The subject is prepended to the FIRST chunk, not embedded separately.
     *
     * An email's subject is often the only place its topic is named outright —
     * "Invoice 2026-118" whose body never says "invoice". Embedded as its own
     * chunk it would be three words against a 512-token window, which produces
     * a vector close to every other short fragment in the corpus and surfaces
     * as noise. Folded into the first chunk it does what it actually is:
     * context for the opening of the message.
     */
    const body = message.subject
      ? `${message.subject}\n\n${message.body_text}`
      : message.body_text;

    const chunks = chunkText(body);

    if (chunks.length === 0) {
      // A WhatsApp photo with no caption. Nothing to embed, and inventing a
      // placeholder would salt the corpus with words nobody sent — the same
      // rule `normalize` follows for `body_text`.
      return { status: 'skipped', reason: 'no text to embed' };
    }

    // One batched call: the model is far more efficient over a batch than over
    // a loop, and a long email is a dozen chunks.
    const vectors = await embedPassages(chunks.map((chunk) => chunk.content));

    if (vectors.length !== chunks.length) {
      return {
        status: 'failed',
        reason: `embedder returned ${vectors.length} vectors for ${chunks.length} chunks`,
      };
    }

    for (const [i, chunk] of chunks.entries()) {
      /*
       * ⚠ owner_id comes from the MESSAGE row, which took it from the channel.
       * The worker runs as `service_role`, so RLS is inert here and this value
       * is the only thing keeping tenants apart. A wrong one puts one tenant's
       * message text into another tenant's search results, and no policy
       * catches it.
       *
       * The vector is cast from a pgvector literal string. Passing a JS array
       * renders as a Postgres array (`{0.1,0.2}`) and fails on a `vector`
       * column with a type error that reads as a driver bug.
       */
      await db.execute(sql`
        insert into message_chunks (owner_id, message_id, chunk_index, content, embedding)
        values (
          ${message.owner_id}, ${message.id}, ${chunk.index},
          ${chunk.content}, ${toVectorLiteral(vectors[i]!)}::vector
        )
        on conflict (message_id, chunk_index) do update
          set content = excluded.content, embedding = excluded.embedding
      `);
    }

    return { status: 'embedded', chunks: chunks.length };
  } catch (cause) {
    // The catch-all that makes the guarantee at the top true. Never let this
    // reach the worker's event handler, which would call markFailed and burn an
    // attempt on a message that ingested perfectly.
    return {
      status: 'failed',
      reason: cause instanceof Error ? cause.message : 'embedding errored',
    };
  }
}

/**
 * Embed everything one ingest created.
 *
 * Sequential, like `summariseBatch`, and for a sharper reason: the model holds
 * a single ONNX session and the container is sized for one job at a time.
 * Firing a dozen embeddings concurrently does not make them finish sooner; it
 * makes memory spike on a replica that is also holding 129 MB of weights.
 */
export async function embedBatch(
  db: Database,
  messageIds: string[],
): Promise<{ embedded: number; chunks: number; skipped: number; failed: number }> {
  let embedded = 0;
  let chunks = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of messageIds) {
    const outcome = await embedMessage(db, id);

    if (outcome.status === 'embedded') {
      embedded += 1;
      chunks += outcome.chunks;
    } else if (outcome.status === 'skipped') {
      skipped += 1;
    } else {
      failed += 1;
      // Message id and a reason, never content. docs/02-ARCHITECTURE.md §6.
      console.warn(`[embed] message=${id} failed: ${outcome.reason}`);
    }
  }

  return { embedded, chunks, skipped, failed };
}

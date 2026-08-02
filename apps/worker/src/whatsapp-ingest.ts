/*
 * Subpath imports, matching the Gmail rule next door.
 *
 * The Gmail adapter's ROOT re-exports the Pub/Sub OIDC verifier, which pulls in
 * google-auth-library and crashes this ESM bundle at startup — that is why
 * `test/import-boundary.test.ts` exists. This adapter has no such dependency
 * today, so its root would bundle cleanly. Importing by subpath anyway costs
 * nothing and means the day someone adds an HTTP client to the WhatsApp
 * adapter's index (for media download, which is exactly what Phase 3 needs)
 * the worker is not already reaching through it.
 */
import { normalizeWhatsAppMessage } from '@switchboard/adapter-whatsapp/normalize';
import type { WhatsAppEnvelope } from '@switchboard/adapter-whatsapp/parse';
import type { Database } from '@switchboard/db';

import type { ClaimedEvent } from './claim';
import { persistMessage } from './persist';

/**
 * Turn one queued WhatsApp message into a stored message.
 *
 * ── Why this is so much shorter than gmail-ingest.ts ─────────────────────────
 *
 * This is the structural difference Phase 2 exists to demonstrate, and it shows
 * up as an absence. Gmail's notification carries no content — only a cursor —
 * so ingesting one means decrypting a refresh token, exchanging it for an
 * access token, walking `history.list` with pagination, fetching each message,
 * and advancing a cursor only once every one of them succeeded. WhatsApp is
 * pure push: the payload already holds the message.
 *
 * So there is **no cursor, no `sync_state` row, no credential, and no network
 * call** on this path. A WhatsApp channel's `sync_state` staying empty is
 * correct, not a symptom — worth knowing before someone debugs it as one.
 *
 * The one thing this shares with Gmail is the write, and that is the point:
 * both end at `persistMessage`, which is where `owner_id` discipline, the
 * conversation upsert and identity resolution live once rather than twice.
 */

export interface WhatsAppIngestOutcome {
  created: number;
  skipped: number;
  /** Our `messages.id` for each row newly created. Phase 4A summarises these. */
  createdIds: string[];
}

export async function ingestWhatsAppEvent(
  db: Database,
  event: ClaimedEvent,
): Promise<WhatsAppIngestOutcome> {
  // ⚠ ownerId comes from the channels row — claim.ts read it there, not from
  // the payload. Every table persistMessage touches inherits it.
  const ctx = { ownerId: event.ownerId, channelId: event.channelId };

  const envelope = event.payload as WhatsAppEnvelope;
  const normalized = normalizeWhatsAppMessage(envelope);

  if (!normalized.ok) {
    /*
     * Skipped, not thrown.
     *
     * A throw here fails the event, retries it to MAX_ATTEMPTS and then parks
     * it in `failed` forever — for a message that will never normalize
     * differently no matter how many times it is retried. The raw payload
     * stays in `raw_events` for inspection either way.
     *
     * The reason string is adapter-written and carries no content. §6.
     */
    console.warn(`[whatsapp] skipping event=${event.id}: ${normalized.reason}`);
    return { created: 0, skipped: 1, createdIds: [] };
  }

  /*
   * `payload_raw` gets the whole envelope, not just the message.
   *
   * The business number and the sender's profile are part of what arrived, and
   * `messages.payload_raw` is the record of what the provider actually said —
   * including every attachment reference, which is what makes Phase 3's media
   * download a backfill rather than a re-ingest.
   */
  const persisted = await persistMessage(db, ctx, normalized.message, envelope);

  return {
    created: persisted.created ? 1 : 0,
    skipped: 0,
    createdIds: persisted.created ? [persisted.messageId] : [],
  };
}

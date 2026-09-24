import { normalizeMeetingTranscript } from '@switchboard/adapter-meeting/normalize';
import type { MeetingContext, RecallTranscript } from '@switchboard/adapter-meeting/types';
import type { Database } from '@switchboard/db';

import type { ClaimedEvent } from './claim';
import { persistMessage } from './persist';

/**
 * Turn one queued meeting transcript into a stored message.
 *
 * ── Where the payload comes from, and why it is not a webhook ───────────────
 *
 * Gmail is pull-after-push (a cursor arrives, the worker fetches). WhatsApp is
 * pure push (the payload holds the message). **Meetings are neither**: Recall's
 * webhook portal cannot create an endpoint on this account at all — their
 * embedded Svix portal does nothing in two browsers and there is no webhook
 * path anywhere in their public API — so nothing pushes to us.
 *
 * `meeting-sweep.ts` therefore polls, and writes a `raw_events` row holding the
 * transcript *and* the context the transcript does not carry. By the time this
 * function runs, the payload is self-sufficient, which is the rule ADR-014
 * settled at Phase 2's refactor checkpoint — WhatsApp's stored payload is
 * self-sufficient and Gmail's is not.
 *
 * So this file looks like `whatsapp-ingest.ts` rather than `gmail-ingest.ts`:
 * no cursor, no credential, no network call. The fetching already happened.
 */

/** What `meeting-sweep.ts` writes into `raw_events.payload`. */
export interface MeetingEventPayload {
  recordingId: string;
  /** ISO 8601. Every word's `relative` offset is measured from here. */
  startedAt: string;
  title?: string | null;
  meetingUrl?: string | null;
  /** Diagnostic: which bot produced it. Never used to resolve a tenant. */
  botId?: string | null;
  transcript: RecallTranscript;
}

export interface MeetingIngestOutcome {
  created: number;
  skipped: number;
  /** Our `messages.id` for each row newly created. Phase 4A summarises these. */
  createdIds: string[];
}

export async function ingestMeetingEvent(
  db: Database,
  event: ClaimedEvent,
): Promise<MeetingIngestOutcome> {
  /*
   * ⚠ `ownerId` comes from the CHANNELS ROW — `claim.ts` read it there, not
   * from the payload. This is the one path in the worker where a payload field
   * would look like a plausible source: the sweep knows the owner, and it would
   * be natural to write it into the event. It must not be trusted if it is.
   * ADR-026, and the same rule migration 0016 exists to enforce.
   */
  const ctx = { ownerId: event.ownerId, channelId: event.channelId };

  const payload = event.payload as MeetingEventPayload | null;

  if (!payload || typeof payload !== 'object') {
    console.warn(`[meeting] skipping event=${event.id}: payload is not an object`);
    return { created: 0, skipped: 1, createdIds: [] };
  }

  const startedAt = new Date(payload.startedAt);

  const context: MeetingContext = {
    recordingId: payload.recordingId,
    startedAt,
    title: payload.title ?? null,
    meetingUrl: payload.meetingUrl ?? null,
  };

  const normalized = normalizeMeetingTranscript(payload.transcript, context);

  if (!normalized.ok) {
    /*
     * Skipped, not thrown — the same call `whatsapp-ingest.ts` makes and for
     * the same reason. A throw fails the event, retries it to MAX_ATTEMPTS and
     * parks it in `failed` forever, for a transcript that will never normalize
     * differently however often it is retried. The raw payload stays in
     * `raw_events` either way.
     *
     * The reason string is adapter-written and carries no transcript content.
     * `docs/02-ARCHITECTURE.md` §6.
     */
    console.warn(`[meeting] skipping event=${event.id}: ${normalized.reason}`);
    return { created: 0, skipped: 1, createdIds: [] };
  }

  /*
   * `payload_raw` gets the whole event payload, transcript included.
   *
   * It is the record of what Recall actually returned, and it is what makes a
   * future re-mapping — per-utterance rows, better speaker merging, anything
   * this first pass got wrong — a backfill over stored data rather than a
   * re-recording of meetings that will never happen twice.
   */
  const persisted = await persistMessage(db, ctx, normalized.message, payload);

  return {
    created: persisted.created ? 1 : 0,
    skipped: 0,
    createdIds: persisted.created ? [persisted.messageId] : [],
  };
}

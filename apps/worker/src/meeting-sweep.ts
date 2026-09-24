import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

import type { RecallTranscript } from '@switchboard/adapter-meeting/types';

import type { MeetingEventPayload } from './meeting-ingest';

/**
 * Ask Recall what happened to the bots we sent, and queue the transcripts.
 *
 * ── ⚠⚠ THIS EXISTS BECAUSE THE WEBHOOK CANNOT ─────────────────────────────
 *
 * Every other channel is pushed to us. Recall's dashboard webhook page is an
 * embedded Svix portal whose Create button does nothing — tried in Chrome and
 * Edge — and there is **no webhook path anywhere in their public API**, which
 * `list_rate_limits` confirms by listing every endpoint they publish. Support
 * was emailed 2026-09-19 with no reply.
 *
 * ⚠ An earlier note in this project blamed an *account write restriction*.
 * **That was wrong** and `list_rate_limits` disproved it: every write endpoint
 * reports `source: "default"`. If that claim survives anywhere, it is stale.
 *
 * A webhook is Recall telling us; polling is us asking. The answer is the same
 * and the read endpoints are public at 300/min. So this sweep is not a
 * workaround for a missing feature — it is the same information arriving the
 * other way round, and `/api/webhooks/recall` stays built and tested for the
 * day their portal works.
 *
 * ── What one pass does ──────────────────────────────────────────────────────
 *
 *   1. find sessions this app wrote that have no message yet
 *   2. GET /bot/{id} — is it finished, and did it produce a recording?
 *   3. GET /recording/{id} — is there a transcript on it yet?
 *   4. request one if not, download it if so
 *   5. write ONE `raw_events` row; the ordinary worker loop does the rest
 *
 * ⚠ It writes a queue row and stops. Normalizing is `meeting-ingest.ts`'s job
 * and it runs through the same `persistMessage` as Gmail and WhatsApp. Doing
 * both here would put a second, subtly different write path into the codebase
 * for the one channel whose tenant rule is newest.
 *
 * ── Idempotency is free, and that is why there is no new column ─────────────
 *
 * `raw_events` is unique on `(channel_id, external_id)` — migration 0004 — and
 * the external id is the RECORDING id. A sweep that runs twice over the same
 * finished meeting writes one row. A sweep interrupted halfway writes one row.
 * No `ingested_at` column, no migration, nothing to keep in step.
 */

/**
 * Terminal bot states. Nothing further will happen, so a bot here is either
 * ready to transcribe or never will be.
 *
 * ⚠ `media_expired` is terminal and is NOT a failure — Recall deletes media
 * after its retention window, and a bot can reach it having worked perfectly.
 * There is simply nothing left to fetch.
 */
const FINISHED = new Set(['done', 'fatal', 'media_expired', 'analysis_done', 'analysis_failed']);

/** States where a recording still exists to work with. */
const USABLE = new Set(['done', 'analysis_done']);

export interface MeetingSweepResult {
  considered: number;
  /** Transcription asked for; the result arrives on a later pass. */
  requested: number;
  queued: number;
  /** Still in the meeting, or still transcribing. Normal. */
  pending: number;
  failed: number;
}

const EMPTY: MeetingSweepResult = {
  considered: 0,
  requested: 0,
  queued: 0,
  pending: 0,
  failed: 0,
};

interface SessionRow extends Record<string, unknown> {
  recall_bot_id: string;
  owner_id: string;
  channel_id: string;
  meeting_url: string | null;
}

async function recallGet(
  apiKey: string,
  base: string,
  path: string,
): Promise<Record<string, unknown> | null> {
  // ⚠ No `Bearer`. Recall's own examples use the bare key, and the prefix
  // produces a 401 that reads exactly like a wrong key.
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: apiKey, accept: 'application/json' },
  });

  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

function statusCodeOf(value: unknown): string {
  if (value && typeof value === 'object') {
    const code = (value as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'unknown';
}

/**
 * One pass.
 *
 * ⚠ Bounded by `batchSize`. A tenant who sent thirty bots in a day must not
 * produce thirty serial round trips inside one tick of a loop that also has
 * mail to ingest.
 */
export async function sweepMeetings(
  db: Database,
  apiKey: string,
  region: string,
  batchSize: number,
): Promise<MeetingSweepResult> {
  const base = `https://${region}.recall.ai/api/v1`;

  /*
   * Sessions with no queued event yet.
   *
   * ⚠ The NOT EXISTS is on `raw_events.external_id = recording id` — but the
   * recording id is not known until Recall is asked, so this cannot filter on
   * it. It filters on the session being recent enough to still matter and
   * leaves the duplicate check to the unique index, which is the thing that
   * actually guarantees it. Trying to be clever here would trade a real
   * guarantee for a racy one.
   *
   * `expires_at` bounds the work: a session past its TTL can no longer be
   * acted on, and sweeping every meeting ever held would grow without limit.
   */
  const sessions = await db.execute<SessionRow>(sql`
    select recall_bot_id, owner_id, channel_id, meeting_url
      from meeting_bot_sessions
     where expires_at > now()
     order by created_at desc
     limit ${batchSize}
  `);

  if (sessions.length === 0) return EMPTY;

  const result: MeetingSweepResult = { ...EMPTY, considered: sessions.length };

  for (const session of sessions) {
    try {
      const bot = await recallGet(apiKey, base, `/bot/${session.recall_bot_id}/`);
      if (!bot) {
        result.failed += 1;
        continue;
      }

      /*
       * ⚠ The LAST status change, not a `status` field. `GET /bot/{id}` returns
       * `status_changes` as an append-only history and has no current-status
       * field at all — `bot.status` is undefined, which would read as "unknown"
       * forever on a bot working perfectly. Read off a real bot 2026-09-20.
       */
      const changes = Array.isArray(bot.status_changes) ? bot.status_changes : [];
      const code = changes.length ? statusCodeOf(changes[changes.length - 1]) : 'unknown';

      if (!FINISHED.has(code)) {
        // Still in the meeting. Entirely normal.
        result.pending += 1;
        continue;
      }

      if (!USABLE.has(code)) {
        // Failed or expired. Nothing to fetch, and asking again tomorrow will
        // not change it.
        continue;
      }

      const recordings = Array.isArray(bot.recordings) ? bot.recordings : [];
      const recordingId = (recordings[0] as { id?: string } | undefined)?.id;
      if (!recordingId) continue;

      const recording = await recallGet(apiKey, base, `/recording/${recordingId}/`);
      if (!recording) {
        result.failed += 1;
        continue;
      }

      const shortcuts = (recording.media_shortcuts ?? {}) as Record<string, unknown>;
      const transcriptRef = shortcuts.transcript as
        | { id?: string; status?: unknown; data?: { download_url?: string } }
        | null
        | undefined;

      /*
       * No transcript yet → ask for one, and come back next pass.
       *
       * ⚠ `recallai_async`, NOT `recallai_streaming`. The streaming providers
       * belong in `recording_config` on the bot and are configured BEFORE the
       * meeting; this one runs against the finished recording. Sending the
       * async name to the bot endpoint is a 400 and it already cost a round
       * trip once (commit 6dc53fd).
       *
       * ⚠ A recording allows 10 successful transcripts and 100 attempts, ever.
       * This is why the request only fires when there is genuinely none — a
       * sweep that asked every pass would exhaust a recording in under a day.
       */
      if (!transcriptRef) {
        const response = await fetch(`${base}/recording/${recordingId}/create_transcript/`, {
          method: 'POST',
          headers: {
            authorization: apiKey,
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            provider: { recallai_async: { language_code: 'auto' } },
            // Attributes each utterance to a named participant using their own
            // audio stream. Speaker names are the whole point for a brief: an
            // utterance nobody is attached to cannot become a useful message.
            diarization: { use_separate_streams_when_available: true },
          }),
        });

        if (response.ok) result.requested += 1;
        else result.failed += 1;
        continue;
      }

      if (statusCodeOf(transcriptRef.status) !== 'done') {
        // Transcribing. A minute or so for an hour of audio.
        result.pending += 1;
        continue;
      }

      const downloadUrl = transcriptRef.data?.download_url;
      if (!downloadUrl) continue;

      // ⚠ No auth header. It is a pre-signed S3 URL, and sending the API key
      // to a third party buys nothing and risks everything.
      const body = await fetch(downloadUrl);
      if (!body.ok) {
        result.failed += 1;
        continue;
      }

      /*
       * ⚠ Cast, not validated, and deliberately so. The adapter's
       * `normalizeMeetingTranscript` refuses anything that is not an array of
       * turns and returns a REASON — validating here as well would put a second
       * opinion about the shape in a second file, and the two would drift. This
       * layer fetches; the adapter decides what is usable.
       */
      const transcript = (await body.json()) as RecallTranscript;

      const meta = (shortcuts.meeting_metadata ?? {}) as Record<string, unknown>;
      const startedAt =
        typeof recording.started_at === 'string'
          ? recording.started_at
          : new Date().toISOString();

      const payload: MeetingEventPayload = {
        recordingId,
        /*
         * ⚠⚠ THE RECORDING'S START TIME, carried explicitly.
         *
         * The transcript has no absolute time on any word — only `relative`
         * seconds. Without this the adapter cannot date the meeting, and a
         * relative offset read as an epoch puts every meeting in January 1970,
         * sorting correctly among itself so nothing looks wrong.
         */
        startedAt,
        title: typeof meta.title === 'string' ? meta.title : null,
        meetingUrl: session.meeting_url,
        botId: session.recall_bot_id,
        transcript,
      };

      /*
       * ⚠ `on conflict do nothing` against migration 0004's unique index. This
       * is the whole idempotency story: the sweep can run twice, be
       * interrupted, or race itself, and one meeting still produces one row.
       *
       * ⚠ `owner_id` and `channel_id` come from the SESSION ROW — written by
       * `/api/meetings/bot` while a real signed-in session existed. Never from
       * anything Recall returned. ADR-026.
       */
      const inserted = await db.execute<{ id: string }>(sql`
        insert into raw_events (owner_id, channel_id, external_id, payload, status)
        values (
          ${session.owner_id}, ${session.channel_id}, ${recordingId},
          ${JSON.stringify(payload)}::jsonb, 'pending'
        )
        on conflict (channel_id, external_id) where external_id is not null
        do nothing
        returning id
      `);

      if (inserted.length > 0) result.queued += 1;
    } catch {
      /*
       * One bad session must not stop the others, and this loop must never take
       * the worker down — mail ingests perfectly well without meetings.
       *
       * ⚠ The error is NOT logged. A fetch failure can carry a response body,
       * and a Recall error echoes the meeting URL, which carries a Zoom
       * password in its query string. `docs/02-ARCHITECTURE.md` §6.
       */
      result.failed += 1;
    }
  }

  return result;
}

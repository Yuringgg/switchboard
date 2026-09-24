/**
 * Recall.ai's transcript payload, **as it actually arrives**.
 *
 * ── ⚠ EVERY FIELD HERE WAS READ OFF A REAL TRANSCRIPT, NOT OFF DOCUMENTATION ─
 *
 * Generated 2026-09-23 for recording `3299fb14-…` and read back before a line
 * of this file existed. That order is deliberate and it is the whole lesson of
 * Phase 6: Vapi's documented tool-call shape was flat, the real one was nested,
 * every tool failed identically, and it took a new database column to see it.
 * `apps/console/src/lib/meetings/payload.ts` carries the full account.
 *
 * The measured sample: 1 speaker turn, 67 words, 350 characters once joined,
 * spanning 27.9s to 57.0s of a 68-second Zoom recording.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 *
 *     [ { participant: { id, name, is_host, platform, email, extra_data },
 *         words: [ { text, start_timestamp, end_timestamp } ],
 *         language_code } ]
 *
 * An array of **speaker turns**, each holding its words individually. There is
 * no sentence structure in the payload at all.
 */

/**
 * One word, with its place in the recording.
 *
 * ⚠⚠ `absolute` IS NULL. Only `relative` is populated, and it is **seconds
 * from the start of the recording**, not an epoch.
 *
 * This is the single most dangerous field in the file. `messages.sent_at` is a
 * `timestamptz`, and a relative offset read as a timestamp puts every utterance
 * in January 1970 — where it will sort *correctly among the other utterances*,
 * so a meetings-only view looks completely normal while being fifty-six years
 * wrong. That is the WhatsApp seconds-versus-milliseconds trap (AGENTS.md §6)
 * wearing a different hat, and it is why `normalize` takes the recording's
 * start time as a separate argument rather than trying to find one in here.
 */
export interface TranscriptWordTimestamp {
  /** Seconds from the start of the recording. Always present. */
  relative: number;
  /** Wall-clock time. **Null on every word measured so far.** */
  absolute: string | null;
}

export interface TranscriptWord {
  text: string;
  start_timestamp: TranscriptWordTimestamp;
  end_timestamp: TranscriptWordTimestamp;
}

/**
 * Who was speaking.
 *
 * ⚠ `email` IS NULL on Zoom. The platform does not hand addresses over, so a
 * speaker arrives with a display name and nothing else. Gmail resolves a
 * contact by address and this channel cannot — see `speakerIdentity` in
 * `normalize.ts` for what is used instead, and why it is not interchangeable.
 *
 * ⚠ `platform` read `"unknown"` on a Zoom call. It is recorded and it decides
 * nothing.
 */
export interface TranscriptParticipant {
  id: number;
  name: string | null;
  is_host: boolean;
  platform: string | null;
  email: string | null;
  extra_data?: Record<string, unknown>;
}

/** One speaker's uninterrupted turn. */
export interface TranscriptTurn {
  participant: TranscriptParticipant;
  words: TranscriptWord[];
  language_code: string | null;
}

/** The whole transcript: turns in the order they were spoken. */
export type RecallTranscript = TranscriptTurn[];

/**
 * What the worker knows about the meeting from outside the transcript.
 *
 * ⚠ `startedAt` does not appear anywhere in the transcript payload, and
 * `recordingId` is what makes ingestion idempotent — `raw_events` is unique on
 * `(channel_id, external_id)` (migration 0004), so re-ingesting the same
 * recording is a no-op rather than a duplicate meeting in the timeline. That is
 * why this adapter needs no table of its own to track what it has seen.
 */
export interface MeetingContext {
  recordingId: string;
  /** When the recording began. Every `relative` offset is measured from here. */
  startedAt: Date;
  /** Shown as the subject. Recall supplies it as `meeting_metadata.title`. */
  title?: string | null;
  /** Diagnostic only, and never rendered raw — a Zoom link carries a password. */
  meetingUrl?: string | null;
}

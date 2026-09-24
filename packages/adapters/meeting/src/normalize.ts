import type { CanonicalMessage, ContactIdentityRef, NormalizeResult } from '@switchboard/core';

import type { MeetingContext, RecallTranscript, TranscriptTurn } from './types';

/**
 * A meeting transcript → one canonical message.
 *
 * ── ⚠⚠ ONE MESSAGE PER MEETING, NOT ONE PER THING SAID ─────────────────────
 *
 * This is the decision the whole file rests on, and the alternative is worse in
 * a way that is not obvious until it ships.
 *
 * A meeting delivers an hour of several people talking, once, after it has
 * ended — ADR-026 says so and calls the fit uncomfortable. The measured sample
 * was a 68-second solo test and produced 1 turn; an hour with four people
 * produces hundreds. **One timeline row per turn would bury a week of Gmail and
 * WhatsApp underneath a single meeting**, and the timeline would stop being a
 * timeline.
 *
 * So the whole meeting is one message whose body is the transcript, speaker by
 * speaker. What that buys, for free, because everything downstream already
 * works on `messages`:
 *
 *   · the timeline shows one row, weighted like one email
 *   · `chunk.ts` splits the body for embedding, so search still finds a
 *     sentence somebody said in the middle of an hour
 *   · extraction reads it like any other message, and the quote check still
 *     works because the speaker's words are in the body verbatim
 *   · summaries run on it, which is exactly the "meeting brief"
 *
 * ⚠ What it costs: there is no per-utterance row to join against, so anything
 * wanting "every sentence Maria said" has to parse the body. That is the right
 * trade today. Revisit it only with a real multi-speaker meeting in hand — not
 * on the strength of this comment.
 *
 * ── ⚠ Speaker names are IN the body, and that is load-bearing ───────────────
 *
 * `"Maria Santos: we should ship on Thursday"` keeps attribution attached to the
 * words through chunking, embedding, search and extraction, none of which know
 * anything about participants. Strip the prefix to make the body "cleaner" and
 * an extracted commitment becomes untraceable to a person.
 *
 * ── Pure, like every other adapter ──────────────────────────────────────────
 *
 * No I/O, so this is testable against a recorded fixture with no network and no
 * Recall account. `startedAt` and the title arrive as arguments precisely so
 * this function never has to go and look them up.
 */

/** Joining words back into prose. */
function textOf(turn: TranscriptTurn): string {
  return turn.words
    .map((word) => (typeof word.text === 'string' ? word.text : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

/**
 * A speaker, as a contact identity.
 *
 * ── ⚠⚠ THE EXTERNAL ID IS A NAME, AND THAT IS NOT WHAT IT IS ON GMAIL ──────
 *
 * `ContactIdentityRef.externalId` is an email address on Gmail and a phone
 * number on WhatsApp — both globally unique, both stable, both issued by
 * somebody else. **Zoom hands over neither.** `participant.email` was null on
 * every speaker measured, so the only thing available is a display name.
 *
 * A display name is weaker in three specific ways, and whoever builds contact
 * merging needs all three:
 *
 *   1. It is **not unique.** Two different people called "Maria" in different
 *      meetings resolve to one identity here.
 *   2. It is **self-chosen and changeable.** Someone renaming themselves in
 *      Zoom becomes a new contact.
 *   3. It is **not the same namespace** as an email address, so a speaker
 *      cannot be matched to a Gmail contact of the same person automatically.
 *
 * ⚠ Do **not** "fix" this by guessing an address from a name. A wrong merge
 * silently attributes one person's commitments to another, and the console has
 * no way to show that it happened. An unmerged duplicate contact is visible and
 * recoverable; a wrong merge is neither.
 *
 * ⚠ The name is lower-cased for the id so that "Maria Santos" and "maria
 * santos" are one identity rather than two, while `displayName` keeps the
 * original casing for display.
 */
function speakerIdentity(turn: TranscriptTurn): ContactIdentityRef {
  const name = typeof turn.participant?.name === 'string' ? turn.participant.name.trim() : '';

  return {
    channelType: 'meeting',
    // An unnamed participant is a real case — Zoom allows joining without a
    // name — and it has to resolve to something stable rather than to ''.
    externalId: name ? name.toLowerCase() : 'unknown-speaker',
    displayName: name || 'Unknown speaker',
  };
}

/** Everyone who spoke, once each, in the order they first spoke. */
function participantsOf(transcript: RecallTranscript): ContactIdentityRef[] {
  const seen = new Map<string, ContactIdentityRef>();

  for (const turn of transcript) {
    const identity = speakerIdentity(turn);
    if (!seen.has(identity.externalId)) seen.set(identity.externalId, identity);
  }

  return [...seen.values()];
}

export function normalizeMeetingTranscript(
  transcript: unknown,
  context: MeetingContext,
): NormalizeResult {
  if (!Array.isArray(transcript)) {
    return { ok: false, reason: 'transcript is not an array' };
  }

  const turns = (transcript as RecallTranscript).filter(
    (turn) => turn && typeof turn === 'object' && Array.isArray(turn.words),
  );

  /*
   * ⚠ An empty transcript is a REFUSAL, not an empty message.
   *
   * `docs/02-ARCHITECTURE.md` §2 says `''` is legal for `bodyText` — an
   * attachment-only mail genuinely has no text. A meeting is different: a
   * recording with no words is a meeting nobody spoke in, or a transcription
   * that failed, and writing an empty row for it puts a meeting in the timeline
   * that says nothing and cannot be told apart from a bug.
   */
  const spoken = turns.map((turn) => ({ turn, text: textOf(turn) })).filter((t) => t.text);

  if (spoken.length === 0) {
    return { ok: false, reason: 'transcript contains no spoken words' };
  }

  /*
   * ⚠ Speaker label per turn, and CONSECUTIVE TURNS BY THE SAME PERSON ARE
   * MERGED. Recall splits a turn on a pause, so one person talking for a minute
   * can arrive as several turns, and labelling each one produces
   * "Yuri: … / Yuri: … / Yuri: …" down the page. That reads as an argument
   * rather than a monologue.
   */
  const lines: string[] = [];
  let lastSpeaker: string | null = null;

  for (const { turn, text } of spoken) {
    const speaker = speakerIdentity(turn).displayName ?? 'Unknown speaker';

    if (speaker === lastSpeaker) {
      lines[lines.length - 1] += ` ${text}`;
    } else {
      lines.push(`${speaker}: ${text}`);
      lastSpeaker = speaker;
    }
  }

  const bodyText = lines.join('\n\n');

  /*
   * ⚠⚠ `sentAt` IS COMPUTED, NOT READ.
   *
   * The transcript has no absolute time on any word — only `relative` seconds
   * from the start of the recording. So the meeting's time is the recording's
   * start, full stop. Reading `relative` as an epoch would date every meeting
   * to January 1970, and they would sort correctly among themselves, so nothing
   * would look wrong on a meetings-only view.
   *
   * The START of the recording rather than the first word: a meeting happened
   * when it happened, not when somebody first spoke in it.
   */
  const sentAt = context.startedAt;

  if (Number.isNaN(sentAt.getTime())) {
    return { ok: false, reason: 'recording start time is not a valid date' };
  }

  const speakers = participantsOf(turns);

  const message: CanonicalMessage = {
    /*
     * ⚠ The RECORDING id, and this is what makes ingestion idempotent.
     * `raw_events` is unique on `(channel_id, external_id)` (migration 0004),
     * so a sweep that runs twice over the same finished meeting writes one row.
     * That is why this adapter needs no table tracking what it has ingested.
     */
    externalId: context.recordingId,
    // One meeting is one conversation. There is no threading to model.
    externalThreadId: context.recordingId,
    /*
     * ⚠ `inbound`, even though the owner sent the bot and may have done all the
     * talking. Direction on this channel means "arrived into the record", the
     * same sense the timeline uses it in. Marking it `outbound` would drop
     * every meeting out of the inbound-only views.
     */
    direction: 'inbound',
    /*
     * The first person who spoke, as the sender.
     *
     * ⚠ Not the host, and not the owner. `messages.sender_identity` is a single
     * column, a meeting has no single author, and picking the host would
     * attribute an hour of somebody else's words to whoever scheduled it. The
     * first speaker is arbitrary but honest, and every speaker is in
     * `recipients` so nobody is lost.
     */
    sender: speakerIdentity(spoken[0]!.turn),
    recipients: speakers,
    subject: context.title?.trim() || 'Meeting',
    bodyText,
    attachments: [],
    sentAt,
  };

  return { ok: true, message };
}

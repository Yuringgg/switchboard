import {
  samePhoneNumber,
  type AttachmentRef,
  type CanonicalMessage,
  type ContactIdentityRef,
  type NormalizeResult,
} from '@switchboard/core';

import type { WhatsAppEnvelope } from './parse';
import type { WhatsAppMedia, WhatsAppMessage } from './types';

/**
 * WhatsApp envelope → CanonicalMessage.
 *
 * ⚠ PURE. No I/O, no clock, no network — `docs/02-ARCHITECTURE.md` §2. Unlike
 * Gmail this costs nothing to honour: the webhook already carries the content,
 * so there is no second fetch to resist. The one thing it *does* forbid is
 * exchanging a media id for a download URL here. That is the worker's job.
 *
 * ── The four decisions this file makes ───────────────────────────────────────
 *
 * **1. A conversation is a chat, and a chat is a person.** WhatsApp has no
 * thread id — nothing corresponds to Gmail's `threadId`. What it has is a
 * continuous conversation per counterparty, which is exactly the unit
 * `conversations` models. So `externalThreadId` is the other party's number.
 * A reply's `context.id` names a quoted message, not a thread; using it would
 * make every quoted reply its own conversation.
 *
 * **2. `subject` is always absent.** Email has one, chat does not — the
 * canonical type says so. The console already renders a message's opening line
 * as its headline when there is no subject, precisely so WhatsApp does not read
 * as degraded email.
 *
 * **3. `bodyText` is always synthesised, and `''` is a legal value** — the same
 * settled rule Gmail follows. The column is `not null`, and a photo with no
 * caption genuinely has no text. What it does NOT do is invent one: writing
 * `"[image]"` would put a word into `body_text` that nobody sent, and Phase 4
 * embeds that column. A corpus salted with machine-written tokens returns them
 * in search results.
 *
 * **4. Media is a reference, never bytes.** Meta sends a media `id`, not a URL
 * and not the file. Fetching is I/O; see `AttachmentRef` in core for why that
 * cannot happen here. Attachments land in Phase 3 together with Gmail's, when
 * the Blob container exists — `messages.payload_raw` keeps every reference
 * until then, so nothing is lost.
 */

/** Unix SECONDS as a string. Milliseconds would place every message in 1970. */
function parseTimestamp(value: string | undefined): Date | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

/** The media object for whichever media type this message is, if any. */
function mediaOf(message: WhatsAppMessage): WhatsAppMedia | undefined {
  switch (message.type) {
    case 'image':
      return message.image;
    case 'video':
      return message.video;
    case 'audio':
      return message.audio;
    case 'document':
      return message.document;
    case 'sticker':
      return message.sticker;
    default:
      return undefined;
  }
}

/**
 * The human-written text of a message, or `''`.
 *
 * Every branch returns something a person actually typed, chose or sent. The
 * default is empty rather than descriptive — see decision 3 above.
 */
function bodyTextOf(message: WhatsAppMessage): string {
  switch (message.type) {
    case 'text':
      return message.text?.body ?? '';

    // Captions are optional on all of these; Meta documents them on images and
    // videos, and sends them on documents when the user adds one.
    case 'image':
    case 'video':
    case 'document':
      return mediaOf(message)?.caption ?? '';

    // A voice note's words are in the audio. Transcription is a stretch item
    // (docs/04-ROADMAP.md), so for now there is honestly no text.
    case 'audio':
    case 'sticker':
      return '';

    /*
     * A pinned location IS text — the place name and street are what someone
     * would search for when asking "where did they say to meet". Unlike an
     * "[image]" placeholder these words came from the sender's map pin, so
     * embedding them in Phase 4 is faithful rather than invented.
     */
    case 'location': {
      const { name, address } = message.location ?? {};
      return [name, address].filter(Boolean).join('\n');
    }

    // Likewise a forwarded contact card: the names are the content.
    case 'contacts':
      return (message.contacts ?? [])
        .map((card) =>
          card?.name?.formatted_name ??
          [card?.name?.first_name, card?.name?.last_name].filter(Boolean).join(' '),
        )
        .filter(Boolean)
        .join('\n');

    /*
     * A reaction is stored as a message rather than dropped.
     *
     * It is a real signal on a monitoring console — a client reacting to a
     * quote is an answer — and dropping it would mean the record silently
     * omits something that happened. It reads as its emoji on one row, and
     * `reaction.message_id` in `payload_raw` says what it was aimed at. If
     * these turn out to be noise in practice, filter them in the console where
     * the decision is reversible, not at ingest where the data is gone.
     */
    case 'reaction':
      return message.reaction?.emoji ?? '';

    // Replies to interactive templates: the user chose these words from a list.
    case 'button':
      return message.button?.text ?? '';

    case 'interactive':
      return (
        message.interactive?.button_reply?.title ??
        message.interactive?.list_reply?.title ??
        ''
      );

    /*
     * `unsupported` means Meta itself could not render the message — and it is
     * still stored. "Something arrived at 14:03 that could not be read" is a
     * true and useful row; dropping it would leave a silent hole in a record
     * whose whole promise is completeness. `errors[]` survives in payload_raw.
     */
    default:
      return '';
  }
}

/** Media as a provider reference. No URL, no bytes — see AttachmentRef in core. */
function attachmentsOf(message: WhatsAppMessage): AttachmentRef[] {
  const media = mediaOf(message);
  if (!media?.id) return [];

  return [
    {
      externalId: media.id,
      // Only documents carry a filename. A sensible fallback is deliberately
      // NOT invented here: the console can say "photo" from the mime type,
      // whereas a fabricated "image.jpg" would look like the sender's own name
      // for the file.
      ...(media.filename ? { filename: media.filename } : {}),
      ...(media.mime_type ? { mimeType: media.mime_type } : {}),
    },
  ];
}

export function normalizeWhatsAppMessage(envelope: WhatsAppEnvelope): NormalizeResult {
  const { message, contact, metadata } = envelope ?? {};

  if (!message?.id) return { ok: false, reason: 'message has no id' };
  if (!message.from) return { ok: false, reason: 'message has no sender' };

  const sentAt = parseTimestamp(message.timestamp);
  if (!sentAt) return { ok: false, reason: 'message has no usable timestamp' };

  const businessNumber = metadata?.display_phone_number;

  /*
   * Direction, defensively.
   *
   * The `messages` webhook field carries messages sent TO the business, so in
   * practice this is always inbound. The comparison is here because the
   * alternative is hard-coding `'inbound'`, and a hard-coded value silently
   * becomes a lie the day `message_echoes` is subscribed or Meta starts
   * folding business-sent messages into this field. Comparing costs nothing
   * and stays true; see samePhoneNumber() for why it is not `===`.
   */
  const outbound = samePhoneNumber(message.from, businessNumber);

  const sender: ContactIdentityRef = {
    channelType: 'whatsapp',
    externalId: message.from,
    // The WhatsApp profile name — user-controlled and changeable, which is why
    // contact merging stays manual (Q3, docs/06-OPEN-QUESTIONS.md).
    ...(contact?.profile?.name ? { displayName: contact.profile.name } : {}),
  };

  /*
   * The business number is a recipient identity like any other.
   *
   * Gmail does the same with the connected mailbox, and it is what makes a
   * contact's history complete rather than sender-only. Omitted when the
   * payload did not name it rather than substituted — an identity row keyed on
   * a guess outlives the message that created it.
   */
  const recipients: ContactIdentityRef[] = businessNumber
    ? [{ channelType: 'whatsapp', externalId: businessNumber }]
    : [];

  /*
   * The conversation is the chat with the other party. See decision 1.
   *
   * For the defensive outbound branch the counterparty is not in the payload —
   * a `messages` notification names no recipient — so a quoted message's author
   * is the best available answer, and the sender itself is the last resort.
   * Both are unreachable via the `messages` field today.
   */
  const counterparty = outbound
    ? (message.context?.from ?? message.from)
    : message.from;

  return {
    ok: true,
    message: {
      externalId: message.id,
      externalThreadId: counterparty,
      direction: outbound ? 'outbound' : 'inbound',
      sender,
      recipients,
      // No subject, ever. Decision 2 — do not add a synthetic one.
      bodyText: bodyTextOf(message),
      attachments: attachmentsOf(message),
      sentAt,
    } satisfies CanonicalMessage,
  };
}

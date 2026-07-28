/**
 * The WhatsApp Cloud API webhook payload, as Meta actually sends it.
 *
 * Verified against Meta's webhook reference rather than recalled — see
 * `docs/03-RESOURCES.md` §2 for the source links, and `fixtures/whatsapp/` for
 * recorded examples of every shape below.
 *
 * The envelope is four levels deep before anything useful appears:
 *
 *   object → entry[] → changes[] → value → messages[]
 *
 * Every one of those is an ARRAY except `value`. Meta batches, so a single POST
 * can carry several entries, each with several changes, each with several
 * messages. Reading `entry[0].changes[0].value.messages[0]` works on every
 * example payload in the documentation and silently drops mail in production.
 *
 * ⚠ Everything here is UNTRUSTED input. These interfaces describe what Meta
 * documents, not what arrived — the fields are optional because a real payload
 * may be missing any of them, and `parse.ts` narrows rather than casts.
 */

/** Which business number the message was sent TO. The tenant lookup key. */
export interface WhatsAppMetadata {
  /** Human-readable, e.g. `15550783881`. Shown; never used to look up a tenant. */
  display_phone_number?: string;
  /**
   * Meta's stable identifier for the business number.
   *
   * ⚠ THIS is the lookup key, not `display_phone_number`. The display number is
   * a formatted string whose punctuation Meta has changed before; the id is an
   * opaque numeric string that never changes for the life of the number.
   */
  phone_number_id?: string;
}

/** The sender's WhatsApp profile. Present once per distinct sender, not per message. */
export interface WhatsAppContact {
  /** The sender's phone number in international format, no `+`. */
  wa_id?: string;
  profile?: { name?: string };
}

/**
 * A media object: image, video, audio, document or sticker.
 *
 * ⚠ **There are no bytes here.** Meta delivers only an `id`, which has to be
 * exchanged for a short-lived download URL against the Graph API. That is I/O,
 * `normalize` is pure, and so media becomes an `AttachmentRef` and nothing
 * more — exactly as Gmail's attachments do. See `docs/02-ARCHITECTURE.md` §2.
 */
export interface WhatsAppMedia {
  /** Media id, exchanged for a download URL. Not a URL itself. */
  id?: string;
  mime_type?: string;
  /** Meta's own integrity hash. Kept in `payload_raw`; not on `AttachmentRef`. */
  sha256?: string;
  /** Images and videos only. */
  caption?: string;
  /** Documents only. */
  filename?: string;
  /** Audio only: true when this is a voice note rather than an audio file. */
  voice?: boolean;
}

export interface WhatsAppLocation {
  latitude?: number | string;
  longitude?: number | string;
  name?: string;
  address?: string;
}

/** A contact card forwarded into the chat. Deliberately not stored as a contact. */
export interface WhatsAppContactCard {
  name?: { formatted_name?: string; first_name?: string; last_name?: string };
  phones?: { phone?: string; type?: string; wa_id?: string }[];
  emails?: { email?: string; type?: string }[];
}

export interface WhatsAppMessage {
  /** `wamid.…`. Stable across redeliveries — the idempotency key. */
  id?: string;
  /** The sender's number, international format, no `+`. */
  from?: string;
  /** Unix SECONDS, as a string. Not milliseconds, not a number. */
  timestamp?: string;
  type?: string;

  text?: { body?: string };
  image?: WhatsAppMedia;
  video?: WhatsAppMedia;
  audio?: WhatsAppMedia;
  document?: WhatsAppMedia;
  sticker?: WhatsAppMedia;
  location?: WhatsAppLocation;
  contacts?: WhatsAppContactCard[];
  reaction?: { message_id?: string; emoji?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };

  /** Present when this message replies to another. `id` is the quoted wamid. */
  context?: { from?: string; id?: string; forwarded?: boolean };

  /** Present on `type: 'unsupported'` — the message exists but cannot be read. */
  errors?: { code?: number; title?: string; message?: string; details?: string }[];
}

/**
 * A delivery receipt for a message the BUSINESS sent.
 *
 * These arrive on the same `messages` webhook field as inbound mail and are by
 * far the most common notification in a live account. They are not messages and
 * carry no content; `parse.ts` drops them.
 */
export interface WhatsAppStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
}

export interface WhatsAppChangeValue {
  messaging_product?: string;
  metadata?: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
  errors?: { code?: number; title?: string; message?: string }[];
}

export interface WhatsAppChange {
  /** `messages` for everything this adapter handles. Other values exist. */
  field?: string;
  value?: WhatsAppChangeValue;
}

export interface WhatsAppEntry {
  /** The WABA id, NOT the phone number id. Never used as a tenant key. */
  id?: string;
  changes?: WhatsAppChange[];
}

export interface WhatsAppWebhookPayload {
  object?: string;
  entry?: WhatsAppEntry[];
}

import type {
  WhatsAppContact,
  WhatsAppMessage,
  WhatsAppMetadata,
  WhatsAppWebhookPayload,
} from './types';

/**
 * Webhook payload → one self-contained envelope per inbound message.
 *
 * ⚠ PURE. No I/O, no clock. Same rule as Gmail's `normalize` — it is what lets
 * this be tested against `fixtures/whatsapp/` with no Meta account.
 *
 * ── Why one row per MESSAGE and not one per webhook ──────────────────────────
 *
 * Meta batches: a single POST can carry several messages, and it redelivers for
 * up to 7 days on any non-200, so duplicates are routine rather than
 * exceptional. `raw_events` is keyed `(channel_id, external_id)` — migration
 * 0004 — and the only id that is stable across a redelivery is the per-message
 * `wamid`. A row per webhook has no such key: a redelivery of a batch where two
 * of three messages already processed would either re-process all three or, if
 * keyed on something synthetic, queue the batch twice.
 *
 * So each message is split out with the metadata and the sender's profile it
 * needs, and nothing else. The message object itself is copied VERBATIM — this
 * splits the payload, it does not parse it. `docs/02-ARCHITECTURE.md` §2.
 */

/** What one queued `raw_events` row carries. Self-contained by design. */
export interface WhatsAppEnvelope {
  /** Which business number received it. Carries the tenant lookup key. */
  metadata: WhatsAppMetadata;
  /**
   * The sender's profile, matched to this message by `wa_id`.
   *
   * Meta sends `contacts` once per distinct sender per change, not once per
   * message, so a batch of three messages from one person carries one contact
   * entry. Attaching it here is what stops the worker from having to hold the
   * whole batch to learn a display name.
   */
  contact: WhatsAppContact | null;
  /** Untouched. */
  message: WhatsAppMessage;
}

export interface InboundEvent {
  /** `metadata.phone_number_id` — how ingest finds the channel, and the tenant. */
  phoneNumberId: string;
  /** The `wamid`. Idempotency key for `raw_events` and for `messages`. */
  externalId: string;
  envelope: WhatsAppEnvelope;
}

/**
 * Counts only — never content.
 *
 * These exist so a quiet webhook can be told apart from a broken one in the
 * logs. `statuses` being the only thing arriving is the normal state of a live
 * account and must not read as a failure. `docs/02-ARCHITECTURE.md` §6.
 */
export interface ParseSkips {
  /** Delivery receipts for messages we sent. Not messages. */
  statuses: number;
  /** A subscribed field other than `messages`. */
  otherFields: number;
  /** A message with no id, no sender, or no phone_number_id to attribute it to. */
  unusable: number;
}

export interface ParsedWebhook {
  events: InboundEvent[];
  skipped: ParseSkips;
}

/** Narrow an unknown value to an array without trusting its element type. */
function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function parseWebhookPayload(payload: unknown): ParsedWebhook {
  const events: InboundEvent[] = [];
  const skipped: ParseSkips = { statuses: 0, otherFields: 0, unusable: 0 };

  const body = (payload ?? {}) as WhatsAppWebhookPayload;

  // Every level is an array and Meta genuinely uses all of them. Indexing [0]
  // works against every documented example and drops messages in production.
  for (const entry of asArray(body.entry)) {
    for (const change of asArray(entry?.changes)) {
      // Other fields can be subscribed on the same app — account_update,
      // message_template_status_update, phone_number_quality_update. None of
      // them is a message and none has a `messages` array to misread.
      if (change?.field && change.field !== 'messages') {
        skipped.otherFields += 1;
        continue;
      }

      const value = change?.value;
      if (!value) continue;

      // Delivery receipts. Counted, not queued — they are most of the traffic.
      skipped.statuses += asArray(value.statuses).length;

      const messages = asArray(value.messages);
      if (messages.length === 0) continue;

      const phoneNumberId = value.metadata?.phone_number_id;

      // Index the senders once per change rather than scanning per message.
      const contactsByWaId = new Map<string, WhatsAppContact>();
      for (const contact of asArray(value.contacts)) {
        if (contact?.wa_id) contactsByWaId.set(contact.wa_id, contact);
      }

      for (const message of messages) {
        /*
         * Three things must be present or the message cannot be stored at all:
         *
         *  · `phone_number_id` — without it there is no channel to attribute
         *    the message to, and therefore no owner. Guessing an owner is the
         *    one mistake in this system that RLS cannot catch.
         *  · `id` — the idempotency key. Without it a redelivery duplicates.
         *  · `from` — `messages.sender_identity` needs someone to point at.
         *
         * Dropped rather than defaulted. A message attributed to the wrong
         * tenant is worse than a message that never arrived.
         */
        if (!phoneNumberId || !message?.id || !message.from) {
          skipped.unusable += 1;
          continue;
        }

        events.push({
          phoneNumberId,
          externalId: message.id,
          envelope: {
            metadata: value.metadata ?? {},
            contact: contactsByWaId.get(message.from) ?? null,
            message,
          },
        });
      }
    }
  }

  return { events, skipped };
}

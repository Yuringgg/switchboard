/**
 * The adapter contract.
 *
 * Every channel implements this one interface, which is what makes adding a
 * platform a single file rather than a refactor. See `docs/02-ARCHITECTURE.md` §2.
 *
 * Three rules for adapter authors, all of which have a reason:
 *
 *  1. `normalize` must be a PURE function with no I/O. That is what lets a
 *     channel be tested from a recorded fixture payload instead of a live
 *     account — which keeps the suite fast and keeps work unblocked when a
 *     provider API is down.
 *  2. Always keep the raw payload. When a provider does something unexpected,
 *     the raw payload is the only way to find out what.
 *  3. `externalId` must be stable and unique per channel. It is the idempotency
 *     key: providers *will* redeliver webhooks, and `messages` carries a
 *     `unique (channel_id, external_id)` constraint that depends on it.
 */

/** The channels in scope for v1. Telegram was cut; calls are out entirely. ADR-001, ADR-008. */
export const CHANNEL_TYPES = ['gmail', 'whatsapp'] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];

/** Narrow untrusted input — webhook payloads and route params are not to be cast. */
export function isChannelType(value: unknown): value is ChannelType {
  return (
    typeof value === 'string' && (CHANNEL_TYPES as readonly string[]).includes(value)
  );
}

/**
 * A person's handle on one channel — an email address on Gmail, a phone number
 * on WhatsApp. Resolving these back to a single `contacts` row across channels
 * is what makes the merged contact view work.
 */
export interface ContactIdentityRef {
  channelType: ChannelType;
  /** Email address or phone number. Unique per (owner, channel). */
  externalId: string;
  displayName?: string;
}

/**
 * An attachment as the provider describes it, BEFORE the worker downloads it.
 *
 * ⚠ **Do not add a URL field to this type.** It looks like an omission; it isn't.
 *
 * A URL would have to come from somewhere. Either `normalize` fetches or uploads
 * to get one — which makes it do I/O — or it fabricates a blob URL for bytes
 * that haven't been uploaded yet. Both break the rule this whole type hierarchy
 * rests on: **`normalize` is pure**, and that purity is what lets every adapter
 * be tested against a recorded fixture with no network and no live account.
 * Lose it and the test suite needs credentials to run.
 *
 * The flow is: the adapter reports *what exists*, the worker fetches the bytes
 * and uploads them to Azure Blob, and only then does an `attachments` row gain
 * its `blob_url`. The URL belongs to the database record, not the canonical
 * message.
 */
export interface AttachmentRef {
  /** Provider's attachment id — what the worker uses to fetch the bytes. */
  externalId: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
}

/**
 * What ingest writes and nothing more. Verify the signature, persist this,
 * return 200 — all slow work happens in the worker. A webhook that answers
 * slowly gets retried and eventually disabled by the provider. ADR-011.
 */
export interface RawEvent {
  channelType: ChannelType;
  channelId: string;
  /** Provider's message id — used for idempotency. */
  externalId: string;
  receivedAt: Date;
  /** Untouched provider payload, stored as jsonb. Never pre-parse it here. */
  payload: unknown;
}

/** One message, in the single shape every layer above the adapters speaks. */
export interface CanonicalMessage {
  externalId: string;
  externalThreadId: string;
  direction: 'inbound' | 'outbound';
  sender: ContactIdentityRef;
  recipients: ContactIdentityRef[];
  /** Email has one, chat doesn't. */
  subject?: string;
  /** Plain text, always populated — this is what gets embedded and searched. */
  bodyText: string;
  bodyHtml?: string;
  attachments: AttachmentRef[];
  sentAt: Date;
}

export interface ChannelAdapter {
  readonly type: ChannelType;

  /** Push channels: validate the provider's signature. Reject if invalid. */
  verifyWebhook?(headers: Headers, rawBody: string): boolean;

  /** Push channels: provider payload → zero or more raw events. */
  parseWebhook?(payload: unknown): RawEvent[];

  /** Pull channels: fetch since cursor. Returns events + the next cursor. */
  poll?(cursor: string | null): Promise<{ events: RawEvent[]; nextCursor: string }>;

  /** All channels: raw event → canonical form. Pure function, unit-testable. */
  normalize(event: RawEvent): CanonicalMessage;

  /** Optional, stretch goal (US-12). Outbound is deliberately last. */
  send?(to: ContactIdentityRef, body: string): Promise<void>;
}

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

/**
 * What `normalize` returns.
 *
 * ── Why a result instead of a throw ──────────────────────────────────────────
 *
 * A message that cannot be normalized is ordinary, not exceptional: mail with
 * no parseable `From`, a WhatsApp message type Meta has not shipped a decoder
 * for. The worker skips those one at a time and keeps draining the queue —
 * whereas a throw fails the whole event, retries it to `MAX_ATTEMPTS`, and then
 * parks every *other* message that arrived in the same batch in `failed`
 * forever. One odd message must not be able to block the ones behind it.
 *
 * The `reason` is a short machine-written string. ⚠ It is logged, so it must
 * never contain message content (`docs/02-ARCHITECTURE.md` §6).
 *
 * Lifted into `core` at Phase 2's refactor checkpoint: both adapters had
 * written the same union independently, which is the signal the checkpoint
 * exists to catch.
 */
export type NormalizeResult =
  | { ok: true; message: CanonicalMessage }
  | { ok: false; reason: string };

/**
 * What a PURE webhook parse can actually produce.
 *
 * ── Why this exists, and why `parseWebhook` no longer returns `RawEvent[]` ────
 *
 * `RawEvent` carries a `channelId`. A channel id comes from a database lookup
 * against the account the provider addressed, and that lookup is the single
 * most security-critical step in the system — it is where `owner_id` is
 * decided, and the worker bypasses RLS, so nothing downstream will catch it if
 * it is wrong. An adapter cannot do it: it has no database, and giving it one
 * would end `normalize`'s purity and the fixture-driven tests that rest on it.
 *
 * So a parse reports *what the provider said*, and ingest turns that into a
 * tenant. This type is the seam between those two responsibilities.
 */
export interface InboundRef {
  /**
   * The connected ACCOUNT the provider addressed, in the provider's own terms —
   * a mailbox address for Gmail, a `phone_number_id` for WhatsApp.
   *
   * ⚠ Untrusted. This is a claim made by a request, not an identity. Ingest
   * resolves it against `channels` and takes `owner_id` from the row it finds;
   * a lookup that misses means *drop it*, never *guess*.
   */
  accountRef: string;
  /** Provider's message id. The idempotency key `raw_events` is keyed on. */
  externalId: string;
  /**
   * What gets stored as `raw_events.payload`.
   *
   * ⚠ Must be SELF-SUFFICIENT — everything `normalize` will later need, and
   * nothing the database already knows. See the note on `normalize` below.
   */
  payload: unknown;
}

/**
 * The adapter contract.
 *
 * ⚠ **AMENDED at Phase 2's refactor checkpoint (2026-07-28).** The original
 * three method signatures could not be implemented by either adapter, which is
 * precisely what this phase existed to discover — `docs/04-ROADMAP.md` calls
 * the checkpoint "where you find out whether the abstraction was real or
 * wishful". The abstraction was real; three of its signatures were wishful.
 * What changed, and why:
 *
 *  · `verifyWebhook(headers, rawBody)` had **no secret to verify against**, so
 *    the only way to implement it was to read `process.env` inside a package
 *    that is supposed to be pure. The secret is now a parameter.
 *
 *  · `parseWebhook` returned `RawEvent[]`, which requires a `channelId` a pure
 *    function cannot know. It now returns `InboundRef[]` — see above.
 *
 *  · `normalize(event: RawEvent)` took a shape that exists only in ingest.
 *    By the time normalization happens the event has been through the queue and
 *    what is in hand is a stored payload. It now takes that payload.
 *
 * **The rule that fell out of it, and it is the useful one:** a stored payload
 * must be self-sufficient. WhatsApp's is — `parseWebhook` attaches the business
 * number and the sender's profile to each message, so `normalize` needs one
 * argument. Gmail's is not: a Gmail message resource does not say which mailbox
 * fetched it, so `normalizeGmailMessage` takes the address separately and the
 * worker reads it from `channels`. Gmail was left as it is rather than
 * retrofitted — it is working in production against real mail, and the
 * divergence is documented rather than hidden.
 */
export interface ChannelAdapter {
  readonly type: ChannelType;

  /**
   * Push channels: validate the provider's signature over the RAW bytes.
   *
   * `rawBody` must be the exact bytes received. A `JSON.parse` →
   * `JSON.stringify` round trip reorders keys and drops whitespace, and no
   * digest will ever match again. Read as text, verify, then parse.
   */
  verifyWebhook?(rawBody: string, headers: Headers, secret: string): boolean;

  /** Push channels: provider payload → zero or more inbound references. Pure. */
  parseWebhook?(payload: unknown): InboundRef[];

  /** Pull channels: fetch since cursor. Returns events + the next cursor. */
  poll?(cursor: string | null): Promise<{ events: RawEvent[]; nextCursor: string }>;

  /** All channels: stored payload → canonical form. Pure, unit-testable. */
  normalize(payload: unknown): NormalizeResult;

  /** Optional, stretch goal (US-12). Outbound is deliberately last. */
  send?(to: ContactIdentityRef, body: string): Promise<void>;
}

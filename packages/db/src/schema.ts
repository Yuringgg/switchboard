import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle has no built-in `bytea`.
 *
 * Typed as `Buffer` rather than `string` on purpose: the only column using it
 * holds AES-256-GCM ciphertext, and a `string` type would make assigning a
 * plaintext token typecheck cleanly. Making the type inconvenient for plaintext
 * is the point — see docs/02-ARCHITECTURE.md §6.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Drizzle mirror of the applied schema.
 *
 * ⚠ The SQL in `../migrations/` is the baseline and it is what actually ran.
 * This file exists for **typed queries**, not to re-derive the database. Keep
 * the two in step: change the SQL, change this, or `drizzle-kit` will propose a
 * migration that undoes work already applied.
 *
 * ⚠ Every table carries `ownerId`. The worker connects as `service_role`, which
 * BYPASSES RLS — none of the policies in 0002 constrain it. Setting `ownerId`
 * correctly is therefore application logic here, not a database guarantee, and
 * it must be derived from the channel being processed, never from a provider
 * payload. See `../tests/tenant_isolation.sql`.
 */

// `auth.users` is managed by Supabase Auth. Referenced by id only; deliberately
// not modelled, so nothing here can be tempted to write to it.

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    /** 'gmail' | 'whatsapp' — enforced by a CHECK constraint in SQL. */
    type: text('type').notNull(),
    /** What a human reads: a mailbox address, or a formatted phone number. */
    displayName: text('display_name').notNull(),
    /**
     * The provider's own identifier for this account — `phone_number_id` for
     * WhatsApp. Null for Gmail, which resolves on `displayName`.
     *
     * ⚠ This is a TENANT LOOKUP KEY. Ingest matches an inbound payload against
     * it and takes `owner_id` from the row it finds. The worker runs as
     * `service_role`, so RLS is inert and nothing downstream catches a wrong
     * match. A miss means drop the message, never guess. Migration 0006.
     */
    externalAccountId: text('external_account_id'),
    /** ENCRYPTED (AES-256-GCM). Never assign plaintext to this column. */
    credentials: bytea('credentials').notNull(),
    /** 'active' | 'paused' | 'error' */
    status: text('status').notNull().default('active'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('channels_owner_idx').on(t.ownerId),
    // Globally unique per type, NOT per owner: a business number belongs to
    // exactly one tenant, and the ingest lookup runs before any owner is known.
    unique().on(t.type, t.externalAccountId),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    displayName: text('display_name').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('contacts_owner_idx').on(t.ownerId)],
);

export const contactIdentities = pgTable(
  'contact_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    channelType: text('channel_type').notNull(),
    /** Email address or phone number. */
    externalId: text('external_id').notNull(),
    displayName: text('display_name'),
  },
  (t) => [
    // ownerId MUST be in this key: two tenants can both know the same number.
    unique().on(t.ownerId, t.channelType, t.externalId),
    index('contact_identities_contact_idx').on(t.contactId),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    externalThreadId: text('external_thread_id').notNull(),
    subject: text('subject'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  },
  (t) => [
    unique().on(t.channelId, t.externalThreadId),
    index('conversations_owner_recent_idx').on(t.ownerId, t.lastMessageAt),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    /** 'inbound' | 'outbound' */
    direction: text('direction').notNull(),
    senderIdentity: uuid('sender_identity').references(() => contactIdentities.id, {
      onDelete: 'set null',
    }),
    subject: text('subject'),
    bodyText: text('body_text').notNull(),
    bodyHtml: text('body_html'),
    payloadRaw: jsonb('payload_raw').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // ← idempotency guard. Providers WILL redeliver; upsert on this conflict
    //   target, never plain insert.
    unique().on(t.channelId, t.externalId),
    index('messages_owner_sent_idx').on(t.ownerId, t.sentAt),
    index('messages_conversation_idx').on(t.conversationId),
    index('messages_sender_idx').on(t.senderIdentity),
  ],
);

export const messageChunks = pgTable(
  'message_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    /** Xenova/multilingual-e5-small. Multilingual is mandatory — the corpus is Taglish. */
    embedding: vector('embedding', { dimensions: 384 }),
  },
  (t) => [
    unique().on(t.messageId, t.chunkIndex),
    index('message_chunks_owner_idx').on(t.ownerId),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    /** Azure Blob URL, assigned after upload — never by an adapter. */
    blobUrl: text('blob_url').notNull(),
    filename: text('filename'),
    mimeType: text('mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
  },
  (t) => [
    index('attachments_message_idx').on(t.messageId),
    index('attachments_owner_idx').on(t.ownerId),
  ],
);

export const extractions = pgTable(
  'extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    /** 'commitment' | 'meeting' | 'action_item' | 'question' */
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    confidence: real('confidence'),
    /** Which model produced this. Makes "did the new prompt help?" answerable. */
    model: text('model').notNull(),
    /**
     * ← idempotency guard for calendar write-back (ADR-010). Check this before
     * every events.insert, or re-running extraction puts the same meeting on a
     * real calendar twice.
     */
    calendarEventId: text('calendar_event_id'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('extractions_owner_kind_idx').on(t.ownerId, t.kind),
    index('extractions_message_idx').on(t.messageId),
  ],
);

export const rawEvents = pgTable(
  'raw_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    /** Untouched provider payload. Ingest must not pre-parse this. */
    payload: jsonb('payload').notNull(),
    /** 'pending' | 'processing' | 'done' | 'failed' */
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('raw_events_channel_idx').on(t.channelId),
    index('raw_events_owner_idx').on(t.ownerId),
  ],
);

export const syncState = pgTable(
  'sync_state',
  {
    channelId: uuid('channel_id')
      .primaryKey()
      .references(() => channels.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull(),
    /** Gmail historyId. */
    cursor: text('cursor'),
    /**
     * ⚠ Gmail's watch expires and must be renewed at least every 7 days, or
     * email ingestion stops SILENTLY. Renew at T-2 days and alert on failure.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sync_state_owner_idx').on(t.ownerId)],
);

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type RawEvent = typeof rawEvents.$inferSelect;
export type NewRawEvent = typeof rawEvents.$inferInsert;
export type Extraction = typeof extractions.$inferSelect;
export type NewExtraction = typeof extractions.$inferInsert;

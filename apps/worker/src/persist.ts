import type { CanonicalMessage, ContactIdentityRef } from '@switchboard/core';
import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

/**
 * Write a normalized message and everything it implies.
 *
 * ⚠ `ownerId` is passed in from the CHANNEL row and is used on EVERY table
 * here — conversations, contacts, contact_identities and messages alike. The
 * worker connects with `service_role`, so RLS is inert: these values are the
 * only thing keeping tenants apart, and a provider payload must never be their
 * source.
 */

export interface PersistContext {
  ownerId: string;
  channelId: string;
}

export interface PersistResult {
  messageId: string;
  created: boolean;
}

/**
 * Upsert the conversation FIRST.
 *
 * `messages.conversation_id` is a foreign key, so the row has to exist before
 * the message references it. And because `conversations` carries
 * `unique (channel_id, external_thread_id)`, a second message in a known thread
 * must UPSERT on that key — a plain insert would violate the constraint on
 * every reply.
 */
async function upsertConversation(
  db: Database,
  ctx: PersistContext,
  message: CanonicalMessage,
): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`
    insert into conversations (owner_id, channel_id, external_thread_id, subject, last_message_at)
    values (
      ${ctx.ownerId}, ${ctx.channelId}, ${message.externalThreadId},
      ${message.subject ?? null}, ${message.sentAt.toISOString()}
    )
    on conflict (channel_id, external_thread_id) do update
      set
        -- Keep the newest activity, but never move it backwards: history can be
        -- replayed out of order, and a backfill must not make a thread look
        -- older than it is.
        last_message_at = greatest(
          conversations.last_message_at,
          excluded.last_message_at
        ),
        -- The first subject wins. Replies carry "Re:" prefixes, and letting
        -- them overwrite turns a thread's title into whatever arrived last.
        subject = coalesce(conversations.subject, excluded.subject)
    returning id
  `);

  const id = rows[0]?.id;
  if (!id) throw new Error('conversation upsert returned no id');
  return id;
}

/**
 * Resolve a channel-specific handle to a `contact_identities` row, creating a
 * `contacts` row for it if it is new.
 *
 * ⚠ NO AUTO-MERGE. Q3 in docs/06-OPEN-QUESTIONS.md is settled for v1: merging
 * is manual, with the UI suggesting matches.
 *
 * Matching on display name is the obvious shortcut and it is explicitly
 * deferred — two different people called Maria exist, and a wrongly merged
 * contact is tedious to unwind because it means splitting a history that has
 * already been threaded together. One identity, one contact. The UI proposes;
 * the user decides.
 */
async function resolveIdentity(
  db: Database,
  ctx: PersistContext,
  ref: ContactIdentityRef,
): Promise<string> {
  // The identity is keyed (owner_id, channel_type, external_id) — owner_id is
  // in the key because two tenants can legitimately know the same address.
  const existing = await db.execute<{ id: string }>(sql`
    select id from contact_identities
     where owner_id = ${ctx.ownerId}
       and channel_type = ${ref.channelType}
       and external_id = ${ref.externalId}
     limit 1
  `);

  const found = existing[0]?.id;
  if (found) return found;

  // New handle: one contact for it, and only it.
  const contactRows = await db.execute<{ id: string }>(sql`
    insert into contacts (owner_id, display_name)
    values (${ctx.ownerId}, ${ref.displayName ?? ref.externalId})
    returning id
  `);

  const contactId = contactRows[0]?.id;
  if (!contactId) throw new Error('contact insert returned no id');

  const identityRows = await db.execute<{ id: string }>(sql`
    insert into contact_identities (owner_id, contact_id, channel_type, external_id, display_name)
    values (
      ${ctx.ownerId}, ${contactId}, ${ref.channelType},
      ${ref.externalId}, ${ref.displayName ?? null}
    )
    -- Two messages from the same new sender can be processed concurrently;
    -- the loser of that race takes the winner's row rather than failing.
    on conflict (owner_id, channel_type, external_id) do update
      set display_name = coalesce(contact_identities.display_name, excluded.display_name)
    returning id
  `);

  const identityId = identityRows[0]?.id;
  if (!identityId) throw new Error('contact identity upsert returned no id');
  return identityId;
}

export async function persistMessage(
  db: Database,
  ctx: PersistContext,
  message: CanonicalMessage,
  /** The provider payload, stored verbatim. */
  payloadRaw: unknown,
): Promise<PersistResult> {
  // Order matters: conversation → identities → message. The message references
  // both by foreign key.
  const conversationId = await upsertConversation(db, ctx, message);
  const senderIdentityId = await resolveIdentity(db, ctx, message.sender);

  // Recipients get identities too — that is what makes a contact's
  // cross-channel history complete rather than sender-only.
  for (const recipient of message.recipients) {
    await resolveIdentity(db, ctx, recipient);
  }

  const rows = await db.execute<{ id: string; inserted: boolean }>(sql`
    insert into messages (
      owner_id, conversation_id, channel_id, external_id, direction,
      sender_identity, subject, body_text, body_html, payload_raw, sent_at
    )
    values (
      ${ctx.ownerId}, ${conversationId}, ${ctx.channelId}, ${message.externalId},
      ${message.direction}, ${senderIdentityId}, ${message.subject ?? null},
      ${message.bodyText}, ${message.bodyHtml ?? null},
      ${JSON.stringify(payloadRaw)}::jsonb, ${message.sentAt.toISOString()}
    )
    -- The idempotency guard. Pub/Sub redelivers and history replays overlap, so
    -- the same message arrives repeatedly; this makes that a no-op instead of a
    -- duplicate. The xmax = 0 test distinguishes a genuine insert from an
    -- update, so "created" counts new messages rather than every touch.
    -- (No backticks in this string: it is a tagged template and one would end it.)
    on conflict (channel_id, external_id) do update
      set body_text = excluded.body_text
    returning id, (xmax = 0) as inserted
  `);

  const row = rows[0];
  if (!row) throw new Error('message upsert returned no id');

  return { messageId: row.id, created: row.inserted };
}

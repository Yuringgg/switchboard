/*
 * ⚠ SUBPATH imports, never the package root.
 *
 * The root re-exports the Pub/Sub OIDC verifier, which pulls in
 * google-auth-library — CommonJS, dynamic `require` — and tsup bundles this
 * worker into a single ESM file where `require('child_process')` throws at
 * startup. The container crashloops naming a module nothing here imports.
 *
 * This has now happened twice. `apps/worker/test/import-boundary.test.ts`
 * fails if a root import reappears.
 */
import {
  fetchMessage,
  fetchProfile,
  listHistory,
  listRecentMessages,
} from '@switchboard/adapter-gmail/history';
import { normalizeGmailMessage } from '@switchboard/adapter-gmail/normalize';
import { refreshAccessToken } from '@switchboard/adapter-gmail/watch';
import { decryptSecret } from '@switchboard/core';
import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

import type { ClaimedEvent } from './claim';
import { persistMessage } from './persist';

/**
 * Turn a queued Gmail notification into stored messages.
 *
 * The notification carries no content — only a cursor. Everything is fetched
 * here, which is why this is in the warm worker and not the webhook (ADR-011).
 */

export interface GmailIngestConfig {
  credentialsKey: string;
  clientId: string;
  clientSecret: string;
}

export interface IngestOutcome {
  fetched: number;
  created: number;
  skipped: number;
  fullSync: boolean;
  /**
   * Our `messages.id` for each row this event newly created — NOT Gmail's
   * message ids, which are the `messageIds` local below.
   *
   * Phase 4A summarises exactly these. Only the newly created ones: a history
   * replay re-fetches messages that already exist, and re-summarising them
   * would spend quota reproducing summaries that are already stored.
   */
  createdIds: string[];
}

interface ChannelRow extends Record<string, unknown> {
  display_name: string;
  credentials: Buffer | Uint8Array;
  cursor: string | null;
}

/** How many messages a full sync will pull. A recovery, not a mailbox import. */
const FULL_SYNC_LIMIT = 50;

export async function ingestGmailEvent(
  db: Database,
  config: GmailIngestConfig,
  event: ClaimedEvent,
): Promise<IngestOutcome> {
  const rows = await db.execute<ChannelRow>(sql`
    select ch.display_name, ch.credentials, ss.cursor
      from channels ch
      left join sync_state ss on ss.channel_id = ch.id
     where ch.id = ${event.channelId}
     limit 1
  `);

  const channel = rows[0];
  if (!channel) throw new Error(`channel ${event.channelId} no longer exists`);

  const credential = JSON.parse(
    decryptSecret(Buffer.from(channel.credentials), config.credentialsKey),
  ) as { refresh_token?: string };

  if (!credential.refresh_token) throw new Error('stored credential has no refresh token');

  const token = await refreshAccessToken(
    credential.refresh_token,
    config.clientId,
    config.clientSecret,
  );
  if (!token.ok) throw new Error(token.reason);

  const ctx = { ownerId: event.ownerId, channelId: event.channelId };
  const mailbox = channel.display_name;

  let messageIds: string[] = [];
  let nextCursor: string | null = null;
  let fullSync = false;

  if (!channel.cursor) {
    // No cursor at all — treat as a first sync rather than guessing.
    fullSync = true;
  } else {
    const history = await listHistory(token.accessToken, channel.cursor);

    if (history.ok) {
      messageIds = history.page.messageIds;
      nextCursor = history.page.nextHistoryId;

      // Pagination. Truncating here loses mail silently.
      let pageToken = history.page.nextPageToken;
      while (pageToken) {
        const next = await listHistory(token.accessToken, channel.cursor, pageToken);
        if (!next.ok) break;
        messageIds.push(...next.page.messageIds.filter((id) => !messageIds.includes(id)));
        nextCursor = next.page.nextHistoryId;
        pageToken = next.page.nextPageToken;
      }
    } else if (history.expired) {
      /*
       * ⚠ THE EXPECTED BRANCH, NOT AN EXCEPTION.
       *
       * Google's guidance: a historyId is usually valid for about a week, but
       * "in rare cases" only a few hours. Once it lapses, every subsequent
       * history.list 404s — so without this recovery the channel goes
       * PERMANENTLY quiet while the watch stays registered, the webhook keeps
       * returning 200, and nothing anywhere reports an error. It is the most
       * likely way ingestion dies after it has been working.
       */
      fullSync = true;
      console.warn(`[gmail] channel=${event.channelId} cursor expired; falling back to full sync`);
    } else {
      throw new Error(history.reason);
    }
  }

  if (fullSync) {
    /*
     * Read the mailbox's current historyId BEFORE listing messages.
     *
     * Taking it afterwards loses anything that arrives during the list: those
     * messages are not in the listing, and a cursor set past them means history
     * never reports them either. Taking it first means such messages are simply
     * seen twice, which the upsert makes free.
     */
    const profile = await fetchProfile(token.accessToken);
    if (!profile.ok) throw new Error(profile.reason);
    nextCursor = profile.profile.historyId;

    const listed = await listRecentMessages(token.accessToken, FULL_SYNC_LIMIT);
    if (!listed.ok) throw new Error(listed.reason);
    messageIds = listed.result.messageIds;
  }

  let fetched = 0;
  let created = 0;
  let skipped = 0;
  const createdIds: string[] = [];

  for (const messageId of messageIds) {
    const result = await fetchMessage(token.accessToken, messageId);

    if (!result.ok) {
      if (result.notFound) {
        /*
         * Deleted between the notification and this fetch. Ordinary, not a
         * failure — the message genuinely is not there.
         *
         * Failing the event here would retry to MAX_ATTEMPTS and then park it
         * in `failed` forever, for a message that no longer exists and never
         * will again. Skip it and keep going.
         */
        skipped += 1;
        continue;
      }
      // A real failure — throw so the event is retried with the whole batch.
      throw new Error(result.reason);
    }

    fetched += 1;

    const normalized = normalizeGmailMessage(result.message, mailbox);
    if (!normalized.ok) {
      // Malformed beyond use. Skipping keeps one odd message from blocking the
      // queue behind it; the raw payload is still in raw_events to inspect.
      console.warn(`[gmail] skipping message=${messageId}: ${normalized.reason}`);
      skipped += 1;
      continue;
    }

    const persisted = await persistMessage(db, ctx, normalized.message, result.message);
    if (persisted.created) {
      created += 1;
      createdIds.push(persisted.messageId);
    }
  }

  /*
   * Advance the cursor ONLY after every message above succeeded.
   *
   * A throw anywhere leaves it where it was, so the retry re-reads the same
   * window. That re-reads messages already stored, which the upsert makes
   * harmless — whereas advancing past an unprocessed window loses mail with no
   * way to notice.
   */
  if (nextCursor) {
    await db.execute(sql`
      insert into sync_state (channel_id, owner_id, cursor, updated_at)
      values (${event.channelId}, ${event.ownerId}, ${nextCursor}, now())
      on conflict (channel_id) do update
        set cursor = excluded.cursor, updated_at = now()
    `);
  }

  return { fetched, created, skipped, fullSync, createdIds };
}

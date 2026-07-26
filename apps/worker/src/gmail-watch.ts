/*
 * Imported from the `/watch` SUBPATH, not the package root, on purpose.
 *
 * The root re-exports the Pub/Sub OIDC verifier, which pulls in
 * google-auth-library — a CommonJS package using dynamic `require`. tsup
 * bundles the worker into a single ESM file, where `require('child_process')`
 * becomes a shim that throws at startup. The container then crashloops with an
 * error naming child_process, which points nowhere near an unused import.
 *
 * This module needs neither: registerWatch and refreshAccessToken are plain
 * fetch calls.
 */
import { refreshAccessToken, registerWatch } from '@switchboard/adapter-gmail/watch';
import { decryptSecret } from '@switchboard/core';
import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

/**
 * Keep Gmail watches alive.
 *
 * ⚠ A Gmail watch expires after 7 days, and when it does Gmail simply STOPS
 * PUBLISHING. There is no error, no final notification, no callback — the
 * mailbox goes quiet and everything else keeps looking healthy. This is the
 * single most likely way the primary channel dies in production, and the only
 * defence is renewing before it lapses.
 *
 * Renewal lives in the WORKER, not in a Vercel cron, because it has to read
 * every user's channel and decrypt their credentials. That needs `service_role`
 * — which the console must never hold, since the console ships code to a
 * browser (ADR-009).
 *
 * Renews at T-2 days, so a failed attempt has two more days of retries before
 * anything is actually lost.
 */

const RENEW_WITHIN_DAYS = 2;

export interface GmailWatchConfig {
  credentialsKey: string;
  clientId: string;
  clientSecret: string;
  topicName: string;
}

/** Index signature required by drizzle's `execute` row constraint. */
interface DueRow extends Record<string, unknown> {
  channel_id: string;
  owner_id: string;
  display_name: string;
  credentials: Buffer | Uint8Array;
  expires_at: string | null;
}

export function readGmailWatchConfig(): GmailWatchConfig | null {
  const credentialsKey = process.env.CHANNEL_CREDENTIALS_KEY;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const topicName = process.env.GOOGLE_PUBSUB_TOPIC;

  if (!credentialsKey || !clientId || !clientSecret || !topicName) return null;
  return { credentialsKey, clientId, clientSecret, topicName };
}

export async function renewExpiringWatches(
  db: Database,
  config: GmailWatchConfig,
): Promise<{ checked: number; renewed: number; failed: number }> {
  const due = await db.execute<DueRow>(sql`
    select
      ss.channel_id,
      ss.owner_id,
      ch.display_name,
      ch.credentials,
      ss.expires_at
    from sync_state ss
    join channels ch on ch.id = ss.channel_id
    where ch.type = 'gmail'
      and ch.status <> 'paused'
      -- NULL expiry means we have no idea when it lapses, which is at least as
      -- urgent as a known-soon one.
      and (ss.expires_at is null
           or ss.expires_at < now() + (${RENEW_WITHIN_DAYS} || ' days')::interval)
  `);

  let renewed = 0;
  let failed = 0;

  for (const row of due) {
    // Channel id only — never the address, never the credential.
    const label = `channel=${row.channel_id}`;

    try {
      const secret = decryptSecret(Buffer.from(row.credentials), config.credentialsKey);
      const parsed: unknown = JSON.parse(secret);

      const refreshToken =
        typeof parsed === 'object' && parsed !== null && 'refresh_token' in parsed
          ? String((parsed as { refresh_token: unknown }).refresh_token)
          : null;

      if (!refreshToken) {
        await markChannelError(db, row.channel_id, 'stored credential has no refresh token');
        failed += 1;
        continue;
      }

      const token = await refreshAccessToken(refreshToken, config.clientId, config.clientSecret);
      if (!token.ok) {
        // A revoked grant is terminal — retrying forever will not fix it, and
        // the user needs to see it in the console and reconnect.
        await markChannelError(db, row.channel_id, token.reason);
        console.error(`[watch] ${label} token refresh failed: ${token.reason}`);
        failed += 1;
        continue;
      }

      const watch = await registerWatch(token.accessToken, config.topicName);
      if (!watch.ok) {
        await markChannelError(db, row.channel_id, watch.reason);
        console.error(`[watch] ${label} renewal failed: ${watch.reason}`);
        failed += 1;
        continue;
      }

      await db.execute(sql`
        update sync_state
           set expires_at = ${watch.watch.expiresAt.toISOString()},
               updated_at = now()
         where channel_id = ${row.channel_id}
      `);

      // Deliberately NOT updating `cursor`. The watch's historyId is where the
      // mailbox is *now*; overwriting the stored cursor with it would skip
      // every message that arrived since the last successful poll.
      await db.execute(sql`
        update channels
           set status = 'active', last_error = null
         where id = ${row.channel_id}
      `);

      console.info(`[watch] ${label} renewed until ${watch.watch.expiresAt.toISOString()}`);
      renewed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.error(`[watch] ${label} renewal errored: ${message}`);
      await markChannelError(db, row.channel_id, message).catch(() => undefined);
      failed += 1;
    }
  }

  return { checked: due.length, renewed, failed };
}

/**
 * Surface the failure where the user will see it. `channels.last_error` renders
 * on /channels, which is the closest thing to an alert this system has — a log
 * line nobody reads is not one.
 */
async function markChannelError(db: Database, channelId: string, reason: string): Promise<void> {
  await db.execute(sql`
    update channels
       set status = 'error', last_error = ${reason}
     where id = ${channelId}
  `);
}

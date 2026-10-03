import type { ContainerClient } from '@azure/storage-blob';
import { fetchAttachment, fetchMessage } from '@switchboard/adapter-gmail/history';
import { normalizeGmailMessage } from '@switchboard/adapter-gmail/normalize';
import { refreshAccessToken } from '@switchboard/adapter-gmail/watch';
import { decryptSecret, type AttachmentRef } from '@switchboard/core';
import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

/**
 * Save every real attachment into the private file store, with no one
 * downloading anything by hand — Ms. Maria's research task 5, *"routing
 * documents directly into database folders without manual file downloads."*
 *
 * ── Why a sweep and not a step in ingest ─────────────────────────────────────
 *
 * Ingest has to be fast and must not fail on something optional. A 20 MB PDF
 * on a slow Gmail call, or Azure having a bad minute, must never stop mail
 * arriving. So ingest persists the message and moves on, and this runs beside
 * it every couple of minutes: find Gmail messages that carry attachment parts
 * and have no `message_attachment_runs` row, download what is worth keeping,
 * write it to Azure Blob (ADR-004) and record the run. The same pass is the
 * backfill for everything that arrived before this existed.
 *
 * ── What is kept ─────────────────────────────────────────────────────────────
 *
 * `whySkip` decides, and it is deliberately conservative about images: a
 * newsletter carries a dozen named logos, and a Files page full of
 * `image001.png` is exactly as useless as no Files page. Calendar invites are
 * skipped because they are already read as meetings (Phase 5).
 *
 * ── Where it goes ────────────────────────────────────────────────────────────
 *
 * Blob `<owner>/<message>/<n>-<filename>` in the private `attachments`
 * container, and one `attachments` row per file. The name is deterministic, so
 * a retry overwrites rather than duplicates, and the rows are replaced in the
 * same transaction that records the run. The "folders" — by person, company
 * and meeting — are derived when the console reads them, not stored: a
 * contact merged or a company learned later re-files everything for free.
 *
 * ⚠ WhatsApp media is NOT handled here yet. Its download URLs are short-lived
 * and the channel has had no traffic since August, so there is nothing to test
 * it against. `docs/04-ROADMAP.md` keeps the item open.
 */

/** Gmail's own ceiling on an attachment. Anything larger is not ours to keep. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Below this an image is a logo, a signature or a tracking pixel. */
export const MIN_IMAGE_BYTES = 30 * 1024;

const CALENDAR_TYPES = new Set(['text/calendar', 'application/ics']);

export type SkipReason = 'unnamed' | 'too-large' | 'small-image' | 'calendar-invite';

/** Why an attachment is not worth keeping, or null to keep it. */
export function whySkip(ref: Pick<AttachmentRef, 'filename' | 'mimeType' | 'sizeBytes'>): SkipReason | null {
  const name = ref.filename?.trim() ?? '';
  if (!name) return 'unnamed';

  const size = ref.sizeBytes ?? 0;
  if (size > MAX_FILE_BYTES) return 'too-large';

  const type = (ref.mimeType ?? '').toLowerCase();
  if (CALENDAR_TYPES.has(type) || /\.ics$/i.test(name)) return 'calendar-invite';
  if (type.startsWith('image/') && size < MIN_IMAGE_BYTES) return 'small-image';

  return null;
}

/**
 * The blob name for one file.
 *
 * ⚠ Owner first, so a whole tenant is one prefix — deletable in one call when
 * somebody asks (the privacy page promises it). The index keeps two files
 * called `scan.pdf` on one message apart. Path separators and control
 * characters are replaced, and the END of a long name is kept, because that is
 * where the extension lives.
 */
export function blobName(
  ownerId: string,
  messageId: string,
  index: number,
  filename: string | undefined,
): string {
  const cleaned = (filename ?? '')
    .normalize('NFC')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = (cleaned.length > 120 ? cleaned.slice(-120) : cleaned) || 'file';
  return `${ownerId}/${messageId}/${index}-${safe}`;
}

export interface FileSweepConfig {
  credentialsKey: string;
  clientId: string;
  clientSecret: string;
}

export interface FileSweepResult {
  considered: number;
  /** Messages finished this pass, including those with nothing worth keeping. */
  done: number;
  saved: number;
  skipped: number;
  failed: number;
}

interface CandidateRow extends Record<string, unknown> {
  id: string;
  owner_id: string;
  channel_id: string;
  external_id: string;
  mailbox: string;
  credentials: Buffer | Uint8Array;
}

export async function sweepFiles(
  db: Database,
  container: ContainerClient,
  config: FileSweepConfig,
  batchSize: number,
  giveUp: Set<string> = new Set(),
): Promise<FileSweepResult> {
  const result: FileSweepResult = { considered: 0, done: 0, saved: 0, skipped: 0, failed: 0 };

  /*
   * ⚠ `payload_raw::text like '%"attachmentId"%'` is a cheap pre-filter, not the
   * decision: an inline image has an attachmentId too. `whySkip` decides, and a
   * message with nothing worth keeping still gets its run row.
   *
   * `ch.status = 'active'` so a channel whose token has lapsed is left alone
   * until somebody reconnects it, rather than failing every two minutes.
   */
  const candidates = await db.execute<CandidateRow>(sql`
    select m.id, m.owner_id, m.channel_id, m.external_id,
           ch.display_name as mailbox, ch.credentials
      from messages m
      join channels ch on ch.id = m.channel_id
     where ch.type = 'gmail'
       and ch.status = 'active'
       and m.payload_raw::text like '%"attachmentId"%'
       -- Never download what Gmail filed as spam or trash (isJunk).
       and not (coalesce(m.payload_raw->'labelIds', '[]'::jsonb) ?| array['SPAM', 'TRASH'])
       and not exists (select 1 from message_attachment_runs r where r.message_id = m.id)
     order by m.sent_at desc
     limit ${batchSize + giveUp.size}
  `);

  // Over-fetched by the size of `giveUp`, the same way the other catch-ups do.
  const pending = candidates.filter((row) => !giveUp.has(row.id)).slice(0, batchSize);
  result.considered = pending.length;
  if (pending.length === 0) return result;

  // One token per channel per pass, not one per message.
  const tokens = new Map<string, string | null>();

  for (const row of pending) {
    try {
      let accessToken = tokens.get(row.channel_id);
      if (accessToken === undefined) {
        const credential = JSON.parse(
          decryptSecret(Buffer.from(row.credentials), config.credentialsKey),
        ) as { refresh_token?: string };
        const token = credential.refresh_token
          ? await refreshAccessToken(credential.refresh_token, config.clientId, config.clientSecret)
          : null;
        accessToken = token?.ok ? token.accessToken : null;
        tokens.set(row.channel_id, accessToken);
        if (!accessToken) {
          console.warn(`[files] channel=${row.channel_id} token refresh failed; skipping it this pass`);
        }
      }
      if (!accessToken) {
        result.failed += 1;
        continue;
      }

      // ⚠ Fresh, not `payload_raw`: attachment ids are not promised stable.
      const fetched = await fetchMessage(accessToken, row.external_id);
      if (!fetched.ok) {
        if (fetched.notFound) {
          // Deleted in Gmail since it arrived. Done — there is nothing to fetch.
          await recordRun(db, row, [], 0);
          result.done += 1;
          continue;
        }
        throw new Error(fetched.reason);
      }

      const normalized = normalizeGmailMessage(fetched.message, row.mailbox);
      const refs = normalized.ok ? normalized.message.attachments : [];

      const files: StoredFile[] = [];
      let skipped = 0;
      for (const [index, ref] of refs.entries()) {
        if (whySkip(ref)) {
          skipped += 1;
          continue;
        }

        const download = await fetchAttachment(accessToken, row.external_id, ref.externalId);
        if (!download.ok) {
          if (download.notFound) {
            skipped += 1;
            continue;
          }
          throw new Error(download.reason);
        }
        // `sizeBytes` is Gmail's estimate; the real length decides.
        if (download.bytes.length > MAX_FILE_BYTES) {
          skipped += 1;
          continue;
        }

        const name = blobName(row.owner_id, row.id, index, ref.filename);
        await container.getBlockBlobClient(name).uploadData(download.bytes, {
          blobHTTPHeaders: {
            blobContentType: ref.mimeType || 'application/octet-stream',
          },
        });
        files.push({
          blobName: name,
          filename: ref.filename?.trim() || 'file',
          mimeType: ref.mimeType ?? null,
          sizeBytes: download.bytes.length,
        });
      }

      await recordRun(db, row, files, skipped);
      result.done += 1;
      result.saved += files.length;
      result.skipped += skipped;
    } catch (error) {
      // Message id only — never a filename or a body. docs/02-ARCHITECTURE.md §6.
      console.error(
        `[files] message=${row.id} failed:`,
        error instanceof Error ? error.message : 'unknown',
      );
      giveUp.add(row.id);
      result.failed += 1;
    }
  }

  return result;
}

interface StoredFile {
  blobName: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
}

/**
 * Replace the message's rows and record the run, together.
 *
 * ⚠ One transaction, the rule `extract.ts` sets for the same shape: rows
 * without a run mean the next pass saves them twice; a run without its rows
 * means files sit in Azure that nothing points at. `owner_id` comes from the
 * MESSAGE row — this runs as service role, so it is the only tenant boundary.
 */
async function recordRun(
  db: Database,
  row: CandidateRow,
  files: StoredFile[],
  skipped: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from attachments where message_id = ${row.id}`);
    for (const file of files) {
      await tx.execute(sql`
        insert into attachments (owner_id, message_id, blob_url, filename, mime_type, size_bytes)
        values (${row.owner_id}, ${row.id}, ${file.blobName}, ${file.filename},
                ${file.mimeType}, ${file.sizeBytes})
      `);
    }
    await tx.execute(sql`
      insert into message_attachment_runs (message_id, owner_id, files_saved, files_skipped)
      values (${row.id}, ${row.owner_id}, ${files.length}, ${skipped})
      on conflict (message_id) do update
        set files_saved = excluded.files_saved,
            files_skipped = excluded.files_skipped,
            created_at = now()
    `);
  });
}

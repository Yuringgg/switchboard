import type { GmailMessage } from './normalize';

/**
 * Gmail history polling.
 *
 * A push notification says only *something changed* and carries a cursor. The
 * delta is fetched here — this is the "pull" half of the hybrid described in
 * docs/02-ARCHITECTURE.md §2.
 */

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface HistoryPage {
  /** Message ids added since the cursor. De-duplicated, order preserved. */
  messageIds: string[];
  /** Cursor to store for the next poll. */
  nextHistoryId: string;
  /** Present when Gmail paginated the result. */
  nextPageToken?: string;
}

export type HistoryResult =
  | { ok: true; page: HistoryPage }
  | {
      /**
       * The cursor is older than Gmail's retained history (roughly a week), so
       * the delta is unknowable. Not an error — recover by re-registering the
       * watch and starting from the historyId it returns. Messages older than
       * that point are simply not backfillable this way.
       */
      ok: false;
      expired: true;
      reason: string;
    }
  | { ok: false; expired: false; reason: string };

interface RawHistoryEntry {
  id?: string;
  messagesAdded?: { message?: { id?: string; threadId?: string } }[];
}

/**
 * Parse a history.list response.
 *
 * Split from the request so the precision handling and de-duplication are
 * testable without a mailbox.
 */
export function parseHistoryResponse(raw: string, fallbackHistoryId: string): HistoryResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, expired: false, reason: 'history response was not JSON' };
  }

  if (typeof decoded !== 'object' || decoded === null) {
    return { ok: false, expired: false, reason: 'history response was not an object' };
  }

  const body = decoded as {
    history?: RawHistoryEntry[];
    nextPageToken?: string;
  };

  // Read from the raw text: historyId exceeds Number.MAX_SAFE_INTEGER on real
  // mailboxes, and JSON.parse rounds it silently. Same trap as the push
  // notification and the watch response.
  const match = /"historyId"\s*:\s*"?(\d+)"?/.exec(raw);
  const nextHistoryId = match?.[1] ?? fallbackHistoryId;

  const seen = new Set<string>();
  const messageIds: string[] = [];

  for (const entry of body.history ?? []) {
    for (const added of entry.messagesAdded ?? []) {
      const id = added.message?.id;
      // The same message appears in several history entries when it is
      // labelled or read shortly after arriving. Without de-duplication the
      // worker fetches and upserts it repeatedly for no gain.
      if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
        seen.add(id);
        messageIds.push(id);
      }
    }
  }

  return {
    ok: true,
    page: {
      messageIds,
      nextHistoryId,
      ...(body.nextPageToken ? { nextPageToken: body.nextPageToken } : {}),
    },
  };
}

export async function listHistory(
  accessToken: string,
  startHistoryId: string,
  pageToken?: string,
): Promise<HistoryResult> {
  const url = new URL(`${BASE}/history`);
  url.searchParams.set('startHistoryId', startHistoryId);
  // Only new mail. Without this filter every read, star and label change
  // produces a notification and a wasted poll.
  url.searchParams.set('historyTypes', 'messageAdded');
  if (pageToken) url.searchParams.set('pageToken', pageToken);

  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    return { ok: false, expired: false, reason: 'could not reach Gmail for history' };
  }

  if (response.status === 404) {
    // Gmail returns 404 when startHistoryId predates its retained window.
    // Distinguished from other failures because the recovery differs: retrying
    // will never succeed, but re-registering the watch will.
    return { ok: false, expired: true, reason: 'history cursor is older than Gmail retains' };
  }

  if (!response.ok) {
    return { ok: false, expired: false, reason: `history.list failed (HTTP ${response.status})` };
  }

  return parseHistoryResponse(await response.text(), startHistoryId);
}

export type FetchMessageResult =
  | { ok: true; message: GmailMessage }
  | { ok: false; reason: string; notFound: boolean };

/**
 * Fetch one message in full.
 *
 * `format=full` returns MIME already parsed into a part tree, which is why the
 * adapter needs no MIME library — see the note in normalize.ts.
 */
export async function fetchMessage(
  accessToken: string,
  messageId: string,
): Promise<FetchMessageResult> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/messages/${encodeURIComponent(messageId)}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return { ok: false, reason: 'could not reach Gmail for the message', notFound: false };
  }

  if (response.status === 404) {
    // Deleted between the notification and the fetch. Ordinary, not a failure:
    // the event should be completed rather than retried forever.
    return { ok: false, reason: 'message no longer exists', notFound: true };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `messages.get failed (HTTP ${response.status})`,
      notFound: false,
    };
  }

  const message = (await response.json()) as GmailMessage;
  return { ok: true, message };
}

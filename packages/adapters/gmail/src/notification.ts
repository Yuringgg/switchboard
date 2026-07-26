/**
 * Parse the Pub/Sub push envelope Gmail sends.
 *
 * The notification carries **no message content** — only the mailbox address
 * and a `historyId`. That is why Gmail is a hybrid channel: the push says
 * *something changed*, and the worker then calls `users.history.list` from the
 * stored cursor to find out what.
 *
 * Envelope shape:
 *   { message: { data: "<base64 of {emailAddress, historyId}>", messageId, publishTime },
 *     subscription: "projects/.../subscriptions/..." }
 */

export interface GmailNotification {
  emailAddress: string;
  historyId: string;
  /** Pub/Sub's own id. Distinct per delivery attempt of the same event. */
  messageId: string;
  publishTime?: string;
}

export type ParseResult =
  | { ok: true; notification: GmailNotification }
  | { ok: false; reason: string };

export function parsePushNotification(body: unknown): ParseResult {
  if (!isRecord(body)) return { ok: false, reason: 'body is not an object' };

  const message = body['message'];
  if (!isRecord(message)) return { ok: false, reason: 'missing message' };

  const data = message['data'];
  if (typeof data !== 'string' || data.length === 0) {
    return { ok: false, reason: 'missing message.data' };
  }

  const messageId = message['messageId'] ?? message['message_id'];
  if (typeof messageId !== 'string' || messageId.length === 0) {
    return { ok: false, reason: 'missing message.messageId' };
  }

  const json = Buffer.from(data, 'base64').toString('utf8');

  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'message.data is not base64 JSON' };
  }

  if (!isRecord(decoded)) return { ok: false, reason: 'decoded data is not an object' };

  const emailAddress = decoded['emailAddress'];
  if (typeof emailAddress !== 'string' || emailAddress.length === 0) {
    return { ok: false, reason: 'missing emailAddress' };
  }

  /*
   * historyId is read from the RAW JSON TEXT, not from the parsed object.
   *
   * Gmail sends it as a JSON number, and mailboxes do exceed
   * Number.MAX_SAFE_INTEGER. `JSON.parse` rounds silently at that point —
   * ...993 becomes ...992 — so by the time you reach the parsed value the
   * damage is already done and `String()` faithfully preserves the wrong
   * number.
   *
   * A cursor off by one lands mid-history, and the symptom is "some emails
   * just never arrive" — which looks like anything but a JSON parsing issue.
   */
  const match = /"historyId"\s*:\s*"?(\d+)"?/.exec(json);
  if (!match?.[1]) {
    const present = decoded['historyId'];
    if (present === undefined || present === null) {
      return { ok: false, reason: 'missing historyId' };
    }
    return { ok: false, reason: 'historyId is not numeric' };
  }
  const historyId = match[1];

  const publishTime = message['publishTime'];

  return {
    ok: true,
    notification: {
      emailAddress,
      historyId,
      messageId,
      ...(typeof publishTime === 'string' ? { publishTime } : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

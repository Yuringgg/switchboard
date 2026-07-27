import type { AttachmentRef, CanonicalMessage, ContactIdentityRef } from '@switchboard/core';

import {
  base64UrlToBuffer,
  charsetFromContentType,
  decodeBytes,
  decodeEncodedWords,
} from './decode';
import { htmlToText } from './html-to-text';

/**
 * Gmail message resource → CanonicalMessage.
 *
 * ⚠ PURE. No I/O, no clock, no network. That is the rule from
 * docs/02-ARCHITECTURE.md §2 and it is what lets this be tested against
 * recorded fixtures instead of a live mailbox.
 *
 * Shapes below were verified against a real inbox rather than recalled, which
 * corrected two assumptions worth stating:
 *
 *   · Header names vary in case between senders — `MIME-Version` and
 *     `Mime-Version` both occur. Lookup must be case-insensitive.
 *   · Parts nest arbitrarily. `multipart/mixed > multipart/related > text/html`
 *     is ordinary, so the tree has to be walked rather than scanned one level
 *     deep.
 *
 * `mailparser` is NOT used here, deviating from docs/02-ARCHITECTURE.md §8.
 * That entry exists because "MIME is not worth writing yourself" — true, and
 * Google already did it: `format=full` returns MIME pre-parsed into a JSON
 * part tree. mailparser becomes relevant if a raw IMAP adapter ever lands.
 */

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  /** Milliseconds since epoch, as a STRING. */
  internalDate?: string;
  payload?: GmailPart;
}

export type NormalizeResult =
  | { ok: true; message: CanonicalMessage }
  | { ok: false; reason: string };

/**
 * Case-insensitive, first match wins — as RFC 5322 headers behave — and
 * RFC 2047 decoded.
 *
 * ⚠ The decode is not optional. Gmail returns header values exactly as they
 * arrived, so any non-ASCII subject is an encoded-word: `=?UTF-8?B?…?=`. Left
 * raw, that string is what lands in `messages.subject`, what the timeline
 * shows, and what Phase 4 embeds — the message becomes unfindable by the words
 * it contains. The corpus is Taglish, so this is the normal case.
 */
function header(payload: GmailPart | undefined, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const raw = payload?.headers?.find((h) => h.name?.toLowerCase() === wanted)?.value;
  return decodeEncodedWords(raw);
}

/** Undecoded, for cases that need the parameters rather than the text. */
function rawHeader(part: GmailPart | undefined, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return part?.headers?.find((h) => h.name?.toLowerCase() === wanted)?.value;
}

/**
 * Decode a part's body using the charset IT declares.
 *
 * Each part carries its own Content-Type, and they differ within one message —
 * a `text/plain` in windows-1252 beside a `text/html` in UTF-8 is ordinary for
 * mail from older clients. Assuming UTF-8 throughout turns every accented
 * character into a replacement glyph, silently.
 */
function decodePartBody(part: GmailPart): string {
  const data = part.body?.data;
  if (!data) return '';
  const charset = charsetFromContentType(rawHeader(part, 'Content-Type'));
  return decodeBytes(base64UrlToBuffer(data), charset);
}

/**
 * Parse an address list into identity references.
 *
 * Handles `Name <a@b.c>`, bare `a@b.c`, and quoted display names containing
 * commas — `"Chua, Lei" <lei@x.com>` must not split into two recipients.
 */
export function parseAddressList(value: string | undefined): ContactIdentityRef[] {
  if (!value) return [];

  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;

  for (const char of value) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === '<') inAngle = true;
    else if (char === '>') inAngle = false;

    if (char === ',' && !inQuotes && !inAngle) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts
    .map((part) => parseAddress(part.trim()))
    .filter((ref): ref is ContactIdentityRef => ref !== null);
}

function parseAddress(raw: string): ContactIdentityRef | null {
  if (!raw) return null;

  const angled = /<([^>]+)>/.exec(raw);
  const email = (angled?.[1] ?? raw).trim().toLowerCase();
  if (!email.includes('@')) return null;

  let displayName = angled ? raw.slice(0, angled.index).trim() : '';
  // Strip surrounding quotes from a display name, keeping any inside it.
  if (displayName.startsWith('"') && displayName.endsWith('"') && displayName.length >= 2) {
    displayName = displayName.slice(1, -1);
  }

  return {
    channelType: 'gmail',
    externalId: email,
    ...(displayName ? { displayName } : {}),
  };
}

/** Depth-first walk. Parts nest arbitrarily deep in real mail. */
function walkParts(part: GmailPart | undefined, visit: (p: GmailPart) => void): void {
  if (!part) return;
  visit(part);
  for (const child of part.parts ?? []) walkParts(child, visit);
}

function collectBodies(payload: GmailPart | undefined): { text: string; html: string } {
  let text = '';
  let html = '';

  walkParts(payload, (part) => {
    const mime = part.mimeType?.toLowerCase() ?? '';
    const data = part.body?.data;
    if (!data) return;

    // A part with a filename is an attachment, even when its type is text/*.
    // Otherwise an attached .txt or .html silently becomes the message body.
    if (part.filename) return;

    if (mime === 'text/plain' && !text) text = decodePartBody(part);
    else if (mime === 'text/html' && !html) html = decodePartBody(part);
  });

  return { text, html };
}

function collectAttachments(payload: GmailPart | undefined): AttachmentRef[] {
  const attachments: AttachmentRef[] = [];

  walkParts(payload, (part) => {
    // An attachment is a part with BOTH a filename and an attachmentId. Inline
    // images in `multipart/related` have an attachmentId but often no filename,
    // and treating those as attachments fills the list with tracking pixels and
    // signature logos.
    if (!part.filename || !part.body?.attachmentId) return;

    attachments.push({
      externalId: part.body.attachmentId,
      // Filenames are encoded-words too when they contain non-ASCII, so a
      // document named in Filipino arrives as `=?UTF-8?B?…?=` and would be
      // shown to the user exactly like that.
      filename: decodeEncodedWords(part.filename) ?? part.filename,
      ...(part.mimeType ? { mimeType: part.mimeType } : {}),
      ...(typeof part.body.size === 'number' ? { sizeBytes: part.body.size } : {}),
    });
  });

  return attachments;
}

export function normalizeGmailMessage(
  message: GmailMessage,
  /** The connected mailbox, used to decide direction. */
  mailboxAddress: string,
): NormalizeResult {
  if (!message?.id) return { ok: false, reason: 'message has no id' };
  if (!message.threadId) return { ok: false, reason: 'message has no threadId' };

  const payload = message.payload;

  const { text, html } = collectBodies(payload);

  // ⚠ body_text is NOT NULL, and most real mail is HTML-only — two of three
  // messages in a live inbox had no text/plain part. Falling back to a
  // conversion is what keeps ingestion working on the majority case.
  const bodyText = text || (html ? htmlToText(html) : '');

  const sender = parseAddressList(header(payload, 'From'))[0];
  if (!sender) return { ok: false, reason: 'message has no parseable From address' };

  const recipients = [
    ...parseAddressList(header(payload, 'To')),
    ...parseAddressList(header(payload, 'Cc')),
  ];

  // internalDate is Gmail's own receipt time in ms. Preferred over the `Date`
  // header, which is set by the sender and is routinely wrong or absent.
  const sentAtMs = Number(message.internalDate);
  if (!Number.isFinite(sentAtMs) || sentAtMs <= 0) {
    return { ok: false, reason: 'message has no usable internalDate' };
  }

  /*
   * Direction is decided by the From address, not the SENT label.
   *
   * A message you send to yourself carries BOTH SENT and INBOX — observed on a
   * real message — so labels alone cannot decide it. Comparing the sender
   * against the connected mailbox gives one answer, and for self-sent mail
   * "outbound" is the truthful one: you did send it.
   */
  const direction: CanonicalMessage['direction'] =
    sender.externalId === mailboxAddress.toLowerCase() ? 'outbound' : 'inbound';

  const subject = header(payload, 'Subject');

  return {
    ok: true,
    message: {
      externalId: message.id,
      externalThreadId: message.threadId,
      direction,
      sender,
      recipients,
      ...(subject ? { subject } : {}),
      bodyText,
      ...(html ? { bodyHtml: html } : {}),
      attachments: collectAttachments(payload),
      sentAt: new Date(sentAtMs),
    },
  };
}

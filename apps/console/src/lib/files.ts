import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAffiliations } from './contacts';
import { assembleClues } from './tell-apart';

/**
 * Files — every saved attachment and every meeting transcript, filed into
 * folders with nobody downloading or sorting anything by hand. Ms. Maria's
 * research task 5: *"routing documents directly into database folders without
 * manual file downloads."*
 *
 * ── The folders are DERIVED, never stored ────────────────────────────────────
 *
 * The worker saves each file once (`apps/worker/src/file-sweep.ts`, one
 * `attachments` row per file). Which folder it belongs in — the person who
 * sent it, their company, "sent by you", "meetings" — is worked out here, on
 * every read. A stored folder would go stale the moment two contacts were
 * merged or a company was learned from a later email; a derived one re-files
 * everything for free.
 *
 * Company is the brief's company when an extraction NAMES the person
 * (ADR-028), otherwise the work domain they email from (`lib/tell-apart.ts`) —
 * the same fact the same-name clues use, so the two screens never disagree.
 *
 * ⚠ RLS scopes every read here, so there is no `owner_id` filter — same rule
 * as `lib/contacts.ts`. No message body is selected anywhere.
 */

export interface FileItem {
  kind: 'file';
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  messageId: string;
  sentAt: string;
  subject: string | null;
  direction: 'inbound' | 'outbound';
  contactId: string | null;
  contactName: string | null;
  organisation: string | null;
  /**
   * What the file says, when the worker has read it (0020): the start of a
   * PDF's text or a recording's transcript. Null for pictures, for files not
   * read yet, and for files with nothing in them.
   */
  textPreview: string | null;
  /** `image_text` (0021): the text OCR found in a picture — only when readable. */
  textKind: 'pdf_text' | 'transcript' | 'image_text' | null;
}

export interface TranscriptItem {
  kind: 'transcript';
  messageId: string;
  title: string;
  sentAt: string;
}

export type LibraryItem = FileItem | TranscriptItem;

export interface Folder {
  key: string;
  label: string;
  count: number;
}

export interface FolderGroups {
  top: Folder[];
  people: Folder[];
  organisations: Folder[];
}

/** What a folder key selects. Pure, so the page and its tests share it. */
export function itemsIn(items: LibraryItem[], key: string): LibraryItem[] {
  if (key === 'all') return items;
  if (key === 'meetings') return items.filter((i) => i.kind === 'transcript');
  if (key === 'sent') return items.filter((i) => i.kind === 'file' && i.direction === 'outbound');
  if (key.startsWith('person:')) {
    const id = key.slice('person:'.length);
    return items.filter((i) => i.kind === 'file' && i.direction === 'inbound' && i.contactId === id);
  }
  if (key.startsWith('org:')) {
    const org = key.slice('org:'.length);
    return items.filter(
      (i) => i.kind === 'file' && i.direction === 'inbound' && i.organisation === org,
    );
  }
  return [];
}

/**
 * The folder list, busiest first within each group.
 *
 * ⚠ A person's files are what THEY sent. Files you sent are one folder, "Sent
 * by you", because `messages` records a sender and no recipients
 * (`docs/02-ARCHITECTURE.md` §3) — filing your own attachment under somebody
 * would be a guess about who it was for.
 */
export function buildFolders(items: LibraryItem[]): FolderGroups {
  const files = items.filter((i): i is FileItem => i.kind === 'file');
  const inbound = files.filter((f) => f.direction === 'inbound');

  const tally = (keyOf: (f: FileItem) => string | null, labelOf: (f: FileItem) => string) => {
    const folders = new Map<string, Folder>();
    for (const file of inbound) {
      const key = keyOf(file);
      if (!key) continue;
      const folder = folders.get(key) ?? { key, label: labelOf(file), count: 0 };
      folder.count += 1;
      folders.set(key, folder);
    }
    return [...folders.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };

  return {
    top: [
      { key: 'all', label: 'All files', count: items.length },
      { key: 'sent', label: 'Sent by you', count: files.length - inbound.length },
      {
        key: 'meetings',
        label: 'Meetings',
        count: items.filter((i) => i.kind === 'transcript').length,
      },
    ],
    people: tally(
      (f) => (f.contactId ? `person:${f.contactId}` : null),
      (f) => f.contactName ?? 'Unknown sender',
    ),
    organisations: tally(
      (f) => (f.organisation ? `org:${f.organisation}` : null),
      (f) => f.organisation ?? '',
    ),
  };
}

type MessageRow = {
  id: string;
  subject: string | null;
  sent_at: string;
  direction: 'inbound' | 'outbound';
  sender_identity: string | null;
  conversation_id: string | null;
};

/**
 * Every saved file and every meeting transcript, newest first.
 *
 * `messageFilter` narrows to some messages (a contact's conversations) —
 * everything else is shared with the full library.
 */
export async function fetchLibrary(
  supabase: SupabaseClient,
  { messageIds }: { messageIds?: string[] } = {},
): Promise<{ items: LibraryItem[]; error: string | null }> {
  try {
    // The preview only — never `text_content`, which can be 100,000 characters
    // per file and is for Uriel, one file at a time.
    let attachmentQuery = supabase
      .from('attachments')
      .select('id, message_id, filename, mime_type, size_bytes, text_preview, text_kind')
      .limit(1000);
    if (messageIds) {
      if (messageIds.length === 0) return { items: [], error: null };
      attachmentQuery = attachmentQuery.in('message_id', messageIds.slice(0, 300));
    }
    const { data: attachmentRows, error: attachmentError } = await attachmentQuery;
    if (attachmentError) return { items: [], error: attachmentError.message };

    const attachments = (attachmentRows ?? []) as {
      id: string;
      message_id: string;
      filename: string | null;
      mime_type: string | null;
      size_bytes: number | null;
      text_preview: string | null;
      text_kind: FileItem['textKind'];
    }[];

    const ids = [...new Set(attachments.map((a) => a.message_id))];
    const messages = new Map<string, MessageRow>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase
        .from('messages')
        .select('id, subject, sent_at, direction, sender_identity, conversation_id')
        .in('id', ids.slice(i, i + 100));
      if (error) return { items: [], error: error.message };
      for (const row of (data ?? []) as MessageRow[]) messages.set(row.id, row);
    }

    const people = await whoSent(supabase, [...messages.values()]);

    const files: FileItem[] = attachments.flatMap((a) => {
      const message = messages.get(a.message_id);
      if (!message) return [];
      const person = message.sender_identity ? people.get(message.sender_identity) : undefined;
      return [
        {
          kind: 'file' as const,
          id: a.id,
          filename: a.filename ?? 'file',
          mimeType: a.mime_type,
          sizeBytes: a.size_bytes,
          messageId: message.id,
          sentAt: message.sent_at,
          subject: message.subject,
          direction: message.direction,
          contactId: person?.contactId ?? null,
          contactName: person?.name ?? null,
          organisation: person?.organisation ?? null,
          textPreview: a.text_preview ?? null,
          textKind: a.text_kind ?? null,
        },
      ];
    });

    const transcripts = messageIds ? [] : await fetchTranscripts(supabase);

    const items: LibraryItem[] = [...files, ...transcripts].sort((a, b) =>
      b.sentAt.localeCompare(a.sentAt),
    );
    return { items, error: null };
  } catch (cause) {
    return {
      items: [],
      error: cause instanceof Error ? cause.message : 'Files are unavailable.',
    };
  }
}

/**
 * Sender identity → the contact, and the organisation to file under.
 *
 * Organisation reuses `assembleClues` so a company here is exactly the company
 * the contact list and Uriel would name.
 */
async function whoSent(
  supabase: SupabaseClient,
  messages: MessageRow[],
): Promise<Map<string, { contactId: string; name: string; organisation: string | null }>> {
  const out = new Map<string, { contactId: string; name: string; organisation: string | null }>();
  const identityIds = [
    ...new Set(messages.map((m) => m.sender_identity).filter((id): id is string => !!id)),
  ];
  if (identityIds.length === 0) return out;

  const { data: identityRows } = await supabase
    .from('contact_identities')
    .select('id, contact_id, channel_type, external_id, display_name')
    .in('id', identityIds);
  const senders = (identityRows ?? []) as {
    id: string;
    contact_id: string | null;
    channel_type: string;
    external_id: string;
    display_name: string | null;
  }[];

  const contactIds = [
    ...new Set(senders.map((s) => s.contact_id).filter((id): id is string => !!id)),
  ];
  if (contactIds.length === 0) return out;

  const { data: contactRows } = await supabase
    .from('contacts')
    .select('id, display_name, notes')
    .in('id', contactIds);
  const contacts = (contactRows ?? []) as { id: string; display_name: string; notes: string | null }[];

  const clues = assembleClues({
    contacts: contacts.map((c) => ({ id: c.id, displayName: c.display_name, notes: c.notes })),
    identities: senders.map((s) => ({
      id: s.id,
      contactId: s.contact_id,
      channelType: s.channel_type,
      externalId: s.external_id,
      displayName: s.display_name,
    })),
    sent: messages.map((m) => ({
      senderIdentity: m.sender_identity,
      subject: m.subject,
      sentAt: m.sent_at,
      conversationId: m.conversation_id,
    })),
    // A failed read costs the company, never the file.
    affiliations: await fetchAffiliations(supabase).catch(() => []),
  });
  const byContact = new Map(clues.map((c) => [c.id, c]));

  for (const sender of senders) {
    if (!sender.contact_id) continue;
    const clue = byContact.get(sender.contact_id);
    if (!clue) continue;
    out.set(sender.id, {
      contactId: clue.id,
      name: clue.name,
      organisation: clue.company ?? clue.domains[0] ?? null,
    });
  }
  return out;
}

/** Meeting transcripts: one message per recorded meeting (Phase 7A). */
async function fetchTranscripts(supabase: SupabaseClient): Promise<TranscriptItem[]> {
  const { data: channelRows } = await supabase.from('channels').select('id').eq('type', 'meeting');
  const channelIds = ((channelRows ?? []) as { id: string }[]).map((c) => c.id);
  if (channelIds.length === 0) return [];

  const { data } = await supabase
    .from('messages')
    .select('id, subject, sent_at')
    .in('channel_id', channelIds)
    .order('sent_at', { ascending: false })
    .limit(200);

  return ((data ?? []) as { id: string; subject: string | null; sent_at: string }[]).map((m) => ({
    kind: 'transcript' as const,
    messageId: m.id,
    title: m.subject?.trim() || 'Recorded meeting',
    sentAt: m.sent_at,
  }));
}

/**
 * The messages in a contact's conversations, for their Files section.
 *
 * Their conversations, both directions — the same resolution the contact page
 * and the brief use — so a file you sent them is there too.
 */
export async function conversationMessageIds(
  supabase: SupabaseClient,
  identityIds: string[],
): Promise<string[]> {
  if (identityIds.length === 0) return [];
  const { data: theirs } = await supabase
    .from('messages')
    .select('conversation_id')
    .in('sender_identity', identityIds)
    .not('conversation_id', 'is', null);
  const conversations = [
    ...new Set(((theirs ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id)),
  ];
  if (conversations.length === 0) return [];

  const { data } = await supabase
    .from('messages')
    .select('id')
    .in('conversation_id', conversations.slice(0, 200))
    .limit(500);
  return ((data ?? []) as { id: string }[]).map((m) => m.id);
}

/** "240 KB" — a size as people say it. */
export function formatSize(bytes: number | null): string {
  if (bytes === null || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Opened in the browser rather than downloaded: things a browser can show. */
export function opensInline(mimeType: string | null): boolean {
  const type = (mimeType ?? '').toLowerCase();
  return type === 'application/pdf' || type.startsWith('image/') || type === 'text/plain';
}

import { describe, expect, it } from 'vitest';

import {
  buildFolders,
  formatSize,
  itemsIn,
  opensInline,
  type FileItem,
  type LibraryItem,
} from '../src/lib/files';

/**
 * The Files folders — Ms. Maria's research task 5.
 *
 * Folders are derived on read, so these are the rules that decide where a
 * document is filed. The one that matters most: a file YOU sent is never
 * filed under somebody else, because the store records no recipients.
 */

function file(overrides: Partial<FileItem> & { id: string }): FileItem {
  return {
    kind: 'file',
    filename: 'a.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    messageId: `m-${overrides.id}`,
    sentAt: '2026-09-20T00:00:00Z',
    subject: null,
    direction: 'inbound',
    contactId: null,
    contactName: null,
    organisation: null,
    ...overrides,
  };
}

const ITEMS: LibraryItem[] = [
  file({ id: '1', contactId: 'maria', contactName: 'Maria', organisation: 'Acme' }),
  file({ id: '2', contactId: 'maria', contactName: 'Maria', organisation: 'Acme' }),
  file({ id: '3', contactId: 'jose', contactName: 'Jose', organisation: 'Acme' }),
  file({ id: '4', direction: 'outbound', contactId: 'me', contactName: 'Yuri', organisation: null }),
  { kind: 'transcript', messageId: 't1', title: 'Sync', sentAt: '2026-09-21T00:00:00Z' },
];

describe('buildFolders', () => {
  it('files by person and by company, busiest first', () => {
    const groups = buildFolders(ITEMS);
    expect(groups.people.map((f) => [f.label, f.count])).toEqual([
      ['Maria', 2],
      ['Jose', 1],
    ]);
    expect(groups.organisations.map((f) => [f.label, f.count])).toEqual([['Acme', 3]]);
  });

  it('keeps files you sent out of every person and company folder', () => {
    const groups = buildFolders(ITEMS);
    expect(groups.people.some((f) => f.label === 'Yuri')).toBe(false);
    expect(groups.top.find((f) => f.key === 'sent')?.count).toBe(1);
  });

  it('counts meeting transcripts in All and in Meetings', () => {
    const groups = buildFolders(ITEMS);
    expect(groups.top.find((f) => f.key === 'all')?.count).toBe(5);
    expect(groups.top.find((f) => f.key === 'meetings')?.count).toBe(1);
  });
});

describe('itemsIn', () => {
  it('selects exactly what each folder says', () => {
    expect(itemsIn(ITEMS, 'person:maria')).toHaveLength(2);
    expect(itemsIn(ITEMS, 'org:Acme')).toHaveLength(3);
    expect(itemsIn(ITEMS, 'sent')).toHaveLength(1);
    expect(itemsIn(ITEMS, 'meetings')).toHaveLength(1);
    expect(itemsIn(ITEMS, 'all')).toHaveLength(5);
  });

  it('shows nothing for a folder that does not exist, rather than everything', () => {
    expect(itemsIn(ITEMS, 'person:nobody')).toEqual([]);
    expect(itemsIn(ITEMS, 'made-up')).toEqual([]);
  });
});

describe('formatSize and opensInline', () => {
  it('says sizes the way people do', () => {
    expect(formatSize(900)).toBe('900 B');
    expect(formatSize(48_200)).toBe('47 KB');
    expect(formatSize(2_400_000)).toBe('2.3 MB');
    expect(formatSize(null)).toBe('');
  });

  it('opens PDFs and images in the tab, downloads the rest', () => {
    expect(opensInline('application/pdf')).toBe(true);
    expect(opensInline('image/jpeg')).toBe(true);
    expect(opensInline('application/vnd.ms-excel')).toBe(false);
    expect(opensInline(null)).toBe(false);
  });
});

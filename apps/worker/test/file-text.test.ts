import type { ContainerClient } from '@azure/storage-blob';
import type { Database } from '@switchboard/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_PDF_BYTES,
  MAX_TEXT_CHARS,
  PREVIEW_CHARS,
  readFileTexts,
  readPlanFor,
  tidyText,
  type PdfReader,
} from '../src/file-text';

/*
 * The file reader (2026-10-06): a saved PDF's text and a saved recording's
 * transcript, kept on the file's row so the Files page and Uriel can use them.
 */

describe('readPlanFor', () => {
  it('reads PDFs and audio, by type or by extension', () => {
    expect(readPlanFor('application/pdf', 'Quote.pdf')).toBe('pdf');
    expect(readPlanFor('application/octet-stream', 'Quote.PDF')).toBe('pdf');
    expect(readPlanFor('audio/x-m4a', 'voice note.m4a')).toBe('audio');
    expect(readPlanFor(null, 'memo.ogg')).toBe('audio');
  });

  it('leaves pictures and everything else alone', () => {
    // Pictures need a vision model — a separate decision.
    expect(readPlanFor('image/png', 'scan.png')).toBeNull();
    expect(readPlanFor('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'brief.docx')).toBeNull();
    expect(readPlanFor(null, null)).toBeNull();
  });
});

describe('tidyText', () => {
  it('collapses whitespace and keeps paragraph breaks', () => {
    expect(tidyText('  Credit   Note \n\n\n\n Refunded\t₱1,100  ')?.content).toBe(
      'Credit Note\n\nRefunded ₱1,100',
    );
  });

  it('is null for a file with nothing in it — empty, not failed', () => {
    expect(tidyText(' \n\t ')).toBeNull();
  });

  it('caps the text, and cuts the preview on a word', () => {
    const long = 'word '.repeat(50_000);
    const text = tidyText(long)!;
    expect(text.content.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(text.preview.length).toBeLessThanOrEqual(PREVIEW_CHARS + 1);
    expect(text.preview.endsWith('word…')).toBe(true);
  });
});

/* ── One whole pass, with the database, Azure, unpdf and Groq faked ────────── */

function file(id: string, mime: string, filename: string, size = 40_000) {
  return { id, blob_url: `owner/m/${id}`, filename, mime_type: mime, size_bytes: size };
}

/** Answers the candidate query with `rows`; records every update. */
function stubDb(rows: unknown[]) {
  const updates: unknown[][] = [];
  let first = true;
  const execute = async (query: unknown) => {
    const chunks = (query as { queryChunks: unknown[] }).queryChunks;
    if (first) {
      first = false;
      return rows;
    }
    updates.push(chunks.filter((c) => !(typeof c === 'object' && c && 'value' in c)));
    return [];
  };
  return { db: { execute } as unknown as Database, updates };
}

function stubContainer(bytes = Buffer.from('%PDF-fake')) {
  const downloads: string[] = [];
  const container = {
    getBlockBlobClient: (name: string) => ({
      downloadToBuffer: async () => {
        downloads.push(name);
        return bytes;
      },
    }),
  } as unknown as ContainerClient;
  return { container, downloads };
}

const pdfReader = (text: string): (() => Promise<PdfReader>) => async () => ({
  readText: async () => text,
});

afterEach(() => vi.unstubAllGlobals());

describe('readFileTexts', () => {
  it('reads a PDF and keeps its text, preview and kind', async () => {
    const { db, updates } = stubDb([file('f1', 'application/pdf', 'CreditNote.pdf')]);
    const { container } = stubContainer();

    const result = await readFileTexts(db, container, {
      groqApiKey: '',
      batchSize: 3,
      loadPdfReader: pdfReader('₱1,100.00 refunded on August 21, 2026'),
    });

    expect(result).toMatchObject({ considered: 1, done: 1 });
    // status, kind, content, preview, model, id — in the order the update binds them.
    expect(updates[0]).toEqual([
      'done',
      'pdf_text',
      '₱1,100.00 refunded on August 21, 2026',
      '₱1,100.00 refunded on August 21, 2026',
      'unpdf',
      'f1',
    ]);
  });

  it('records a scanned PDF as empty, not failed', async () => {
    const { db, updates } = stubDb([file('f1', 'application/pdf', 'scan.pdf')]);
    const { container } = stubContainer();

    const result = await readFileTexts(db, container, {
      groqApiKey: '',
      batchSize: 3,
      loadPdfReader: pdfReader('   '),
    });

    expect(result.empty).toBe(1);
    expect(updates[0]?.[0]).toBe('empty');
  });

  it('does not download a PDF over the size limit', async () => {
    const { db, updates } = stubDb([file('f1', 'application/pdf', 'huge.pdf', MAX_PDF_BYTES + 1)]);
    const { container, downloads } = stubContainer();

    const result = await readFileTexts(db, container, {
      groqApiKey: '',
      batchSize: 3,
      loadPdfReader: pdfReader('x'),
    });

    expect(result.tooLarge).toBe(1);
    expect(downloads).toEqual([]);
    expect(updates[0]?.[0]).toBe('too_large');
  });

  it('transcribes audio with the language detected, not pinned to English', async () => {
    const sent: FormData[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: FormData }) => {
      sent.push(init.body);
      return new Response('Sige, call tayo after lunch.', { status: 200 });
    });
    const { db, updates } = stubDb([file('f2', 'audio/x-m4a', 'voice note.m4a')]);
    const { container } = stubContainer(Buffer.from('fake-audio'));

    const result = await readFileTexts(db, container, { groqApiKey: 'gsk', batchSize: 3 });

    expect(result.done).toBe(1);
    expect(sent[0]?.has('language')).toBe(false);
    expect(updates[0]?.slice(0, 3)).toEqual(['done', 'transcript', 'Sige, call tayo after lunch.']);
  });

  it('leaves audio for later — and writes nothing — when Groq rate-limits', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 429 }));
    const giveUp = new Set<string>();
    const { db, updates } = stubDb([
      file('f2', 'audio/x-m4a', 'a.m4a'),
      file('f3', 'audio/x-m4a', 'b.m4a'),
    ]);
    const { container } = stubContainer(Buffer.from('fake-audio'));

    const result = await readFileTexts(db, container, { groqApiKey: 'gsk', batchSize: 3, giveUp });

    // Stopped at the first 429: the second file would be told no as well.
    expect(result).toMatchObject({ considered: 2, deferred: 1 });
    expect(updates).toEqual([]);
    expect(giveUp.has('f2')).toBe(true);
  });

  it('leaves audio unread without a Groq key, and still reads PDFs', async () => {
    const { db, updates } = stubDb([
      file('f2', 'audio/x-m4a', 'a.m4a'),
      file('f1', 'application/pdf', 'q.pdf'),
    ]);
    const { container } = stubContainer();

    const result = await readFileTexts(db, container, {
      groqApiKey: '',
      batchSize: 3,
      loadPdfReader: pdfReader('Quotation total'),
    });

    expect(result).toMatchObject({ deferred: 1, done: 1 });
    expect(updates).toHaveLength(1);
  });

  it('leaves PDFs for later when unpdf is missing from the image', async () => {
    const { db, updates } = stubDb([file('f1', 'application/pdf', 'q.pdf')]);
    const { container } = stubContainer();

    const result = await readFileTexts(db, container, {
      groqApiKey: '',
      batchSize: 3,
      loadPdfReader: async () => null,
    });

    expect(result.deferred).toBe(1);
    expect(updates).toEqual([]);
  });
});

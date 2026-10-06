import type { ContainerClient } from '@azure/storage-blob';
import { MAX_AUDIO_BYTES, transcribeAudio } from '@switchboard/ai/transcribe';
import type { Database } from '@switchboard/db';
import { sql } from 'drizzle-orm';

/**
 * Read what a saved file SAYS — a PDF's text, a recording's transcript — and
 * keep it on the file's row (migration 0020).
 *
 * Yuri, 2026-10-06: Uriel could name a file but not open it ("he cant open
 * files though"), and asked that files arriving later be read too. They are:
 * this runs right after the file sweep (`file-sweep.ts`), every two minutes,
 * on every file whose `text_status` is still null. The same pass is the
 * backfill for the files saved before it existed.
 *
 * ── What is read, and by what ─────────────────────────────────────────────────
 *
 * - **PDFs** — their text layer, with `unpdf` (PDF.js, run on the worker; no
 *   outside service sees the file). A scanned PDF has no text layer and is
 *   recorded `empty`, not guessed at.
 * - **Audio** — transcribed by Groq Whisper (`@switchboard/ai/transcribe`, the
 *   model the voice lab uses), with the language DETECTED rather than pinned
 *   to English: a voice note is often Taglish.
 * - **Pictures are not read.** That needs a vision model — a separate decision
 *   with its own cost and quota.
 *
 * ── ⚠ Memory, after the 2026-09-27 OOM ──────────────────────────────────────
 *
 * One file at a time, a few per pass, and PDFs over 8 MB are not parsed:
 * PDF.js holds the whole document and its pages while it reads, and this
 * container has 1 GiB with a ~530 MiB working peak. Each PDF document is
 * destroyed as soon as its text is out.
 *
 * ── ⚠ `unpdf` is reached by dynamic import only ─────────────────────────────
 *
 * Like the Azure SDK it is external to the tsup bundle and installed beside it
 * in the image (Dockerfile). If it is ever missing, PDFs are left for a later
 * pass and everything else carries on — `test/import-boundary.test.ts` holds
 * the line.
 *
 * Logs carry file ids only — never a filename or a word of text.
 * `docs/02-ARCHITECTURE.md` §6.
 */

/** Past this, a PDF is not parsed. See "Memory" above. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024;

/** What is kept of a file's text. A 300-page report is not a voice answer. */
export const MAX_TEXT_CHARS = 100_000;

/** What the Files page shows under a file. */
export const PREVIEW_CHARS = 400;

/** Audio formats Groq Whisper takes (its docs, 2026-09-10; `docs/03-RESOURCES.md` §4d). */
const AUDIO_EXTENSIONS = /\.(m4a|mp3|mp4|mpeg|mpga|wav|ogg|oga|opus|flac|webm)$/i;

export type ReadPlan = 'pdf' | 'audio';

/** How a file is read, or null when it is not (pictures, documents, archives). */
export function readPlanFor(mimeType: string | null, filename: string | null): ReadPlan | null {
  const type = (mimeType ?? '').toLowerCase();
  const name = filename ?? '';
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (type.startsWith('audio/') || AUDIO_EXTENSIONS.test(name)) return 'audio';
  return null;
}

/**
 * Whitespace collapsed, length capped, and a preview cut on a word.
 * Null when nothing is left — which is `empty`, not `failed`.
 */
export function tidyText(raw: string): { content: string; preview: string } | null {
  const content = raw
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
  if (!content) return null;

  const flat = content.replace(/\s+/g, ' ');
  if (flat.length <= PREVIEW_CHARS) return { content, preview: flat };
  const cut = flat.slice(0, PREVIEW_CHARS);
  const space = cut.lastIndexOf(' ');
  return { content, preview: `${space > 0 ? cut.slice(0, space) : cut}…` };
}

/** The two calls this file needs from `unpdf`, so a test can stand in for it. */
export interface PdfReader {
  readText(bytes: Uint8Array): Promise<string>;
}

let unpdfReader: Promise<PdfReader | null> | null = null;

/** `unpdf`, loaded once, on first use. Null if the image is missing it. */
function loadUnpdf(): Promise<PdfReader | null> {
  unpdfReader ??= import('unpdf')
    .then(
      ({ extractText, getDocumentProxy }): PdfReader => ({
        async readText(bytes) {
          const pdf = await getDocumentProxy(bytes);
          try {
            const { text } = await extractText(pdf, { mergePages: true });
            return text;
          } finally {
            // Frees the parsed pages now, not whenever the GC gets to them.
            // PDF.js has `destroy()` on the document; unpdf's bundled typings
            // omit it, hence the cast — and the `?.` in case a version drops it.
            await (pdf as { destroy?: () => Promise<void> }).destroy?.();
          }
        },
      }),
    )
    .catch((error: unknown) => {
      console.error(
        '[file-text] PDF reading disabled: could not load unpdf:',
        error instanceof Error ? error.message : error,
      );
      return null;
    });
  return unpdfReader;
}

export interface FileTextOptions {
  /** Groq, for audio. Empty means recordings wait; PDFs are still read. */
  groqApiKey: string;
  batchSize: number;
  /** Files that failed transiently this process's life — retried after a restart. */
  giveUp?: Set<string>;
  /** For tests. Defaults to `unpdf`. */
  loadPdfReader?: () => Promise<PdfReader | null>;
}

export interface FileTextResult {
  considered: number;
  done: number;
  empty: number;
  failed: number;
  tooLarge: number;
  /** Left for a later pass: a rate limit, a network error, a missing reader. */
  deferred: number;
}

interface PendingFile extends Record<string, unknown> {
  id: string;
  blob_url: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | string | null;
}

type Outcome =
  | { status: 'done'; kind: 'pdf_text' | 'transcript'; content: string; preview: string; model: string }
  | { status: 'empty' | 'failed' | 'too_large'; kind: 'pdf_text' | 'transcript'; model: string | null }
  | { status: 'deferred'; stopPass?: boolean };

export async function readFileTexts(
  db: Database,
  container: ContainerClient,
  { groqApiKey, batchSize, giveUp = new Set(), loadPdfReader = loadUnpdf }: FileTextOptions,
): Promise<FileTextResult> {
  const result: FileTextResult = {
    considered: 0,
    done: 0,
    empty: 0,
    failed: 0,
    tooLarge: 0,
    deferred: 0,
  };

  /*
   * Newest first: a file that just arrived is the one somebody is about to
   * ask about. The type test is repeated in `readPlanFor`, which decides.
   */
  const rows = await db.execute<PendingFile>(sql`
    select a.id, a.blob_url, a.filename, a.mime_type, a.size_bytes
      from attachments a
      join messages m on m.id = a.message_id
     where a.text_status is null
       and (a.mime_type = 'application/pdf'
            or a.mime_type like 'audio/%'
            or a.filename ~* '\\.(pdf|m4a|mp3|mp4|mpeg|mpga|wav|ogg|oga|opus|flac|webm)$')
     order by m.sent_at desc
     limit ${batchSize + giveUp.size}
  `);

  const pending = rows
    .filter((row) => !giveUp.has(row.id) && readPlanFor(row.mime_type, row.filename))
    .slice(0, batchSize);
  result.considered = pending.length;

  for (const file of pending) {
    let outcome: Outcome;
    try {
      outcome = await readOne(container, file, groqApiKey, loadPdfReader);
    } catch (error) {
      // Message-free: the id, and the error's own text (never the file's).
      console.error(
        `[file-text] file=${file.id} failed:`,
        error instanceof Error ? error.message : 'unknown',
      );
      outcome = { status: 'deferred' };
    }

    if (outcome.status === 'deferred') {
      giveUp.add(file.id);
      result.deferred += 1;
      // A rate limit holds for every file behind it; stop rather than spend
      // the rest of the pass being told no.
      if (outcome.stopPass) break;
      continue;
    }

    await db.execute(sql`
      update attachments
         set text_status  = ${outcome.status},
             text_kind    = ${outcome.kind},
             text_content = ${outcome.status === 'done' ? outcome.content : null},
             text_preview = ${outcome.status === 'done' ? outcome.preview : null},
             text_model   = ${outcome.model},
             text_read_at = now()
       where id = ${file.id}
    `);

    if (outcome.status === 'done') result.done += 1;
    else if (outcome.status === 'empty') result.empty += 1;
    else if (outcome.status === 'too_large') result.tooLarge += 1;
    else result.failed += 1;
  }

  return result;
}

async function readOne(
  container: ContainerClient,
  file: PendingFile,
  groqApiKey: string,
  loadPdfReader: () => Promise<PdfReader | null>,
): Promise<Outcome> {
  const plan = readPlanFor(file.mime_type, file.filename)!;
  const kind = plan === 'pdf' ? 'pdf_text' : 'transcript';
  const limit = plan === 'pdf' ? MAX_PDF_BYTES : MAX_AUDIO_BYTES;

  // Decided before downloading anything: the size was recorded when it was saved.
  if (Number(file.size_bytes ?? 0) > limit) return { status: 'too_large', kind, model: null };

  if (plan === 'audio' && !groqApiKey) return { status: 'deferred' };
  const pdfReader = plan === 'pdf' ? await loadPdfReader() : null;
  if (plan === 'pdf' && !pdfReader) return { status: 'deferred' };

  const bytes = await container.getBlockBlobClient(file.blob_url).downloadToBuffer();
  if (bytes.length > limit) return { status: 'too_large', kind, model: null };

  if (plan === 'pdf') {
    let raw: string;
    try {
      raw = await pdfReader!.readText(new Uint8Array(bytes));
    } catch {
      // A broken or password-protected PDF fails the same way every time.
      return { status: 'failed', kind, model: 'unpdf' };
    }
    const text = tidyText(raw);
    return text
      ? { status: 'done', kind, ...text, model: 'unpdf' }
      : { status: 'empty', kind, model: 'unpdf' };
  }

  const transcript = await transcribeAudio(
    {
      apiKey: groqApiKey,
      audio: new Blob([new Uint8Array(bytes)], { type: file.mime_type ?? 'audio/mpeg' }),
      filename: file.filename ?? 'recording.m4a',
      // Detected, not pinned: a voice note is often Taglish. See transcribe.ts.
      language: null,
    },
    // A recording is minutes long, not the voice lab's 30-second clip.
    { timeoutMs: 120_000 },
  );

  if (transcript.ok) {
    const text = tidyText(transcript.text);
    return text
      ? { status: 'done', kind, ...text, model: transcript.model }
      : { status: 'empty', kind, model: transcript.model };
  }
  if (transcript.reason === 'no speech detected') {
    return { status: 'empty', kind, model: null };
  }
  if (transcript.retryable) {
    console.warn(`[file-text] file=${file.id} deferred: ${transcript.reason}`);
    return { status: 'deferred', stopPass: transcript.reason.includes('429') };
  }
  return { status: 'failed', kind, model: null };
}

import { tmpdir } from 'node:os';

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
 * - **Pictures — only their text, and only when it is readable** (Yuri,
 *   2026-10-06: "only when it is readable"). OCR with `tesseract.js`, on the
 *   worker; a picture counts as read only when OCR finds several confident
 *   words (`readableText`) — a screenshot, a receipt, a business card. A
 *   photo of a room is recorded `empty`. What a photo SHOWS is never
 *   described: that needs a vision model, still not chosen.
 *
 * ── ⚠ Memory, after the 2026-09-27 OOM ──────────────────────────────────────
 *
 * One file at a time, a few per pass, and PDFs over 8 MB are not parsed:
 * PDF.js holds the whole document and its pages while it reads, and this
 * container has 1 GiB with a ~530 MiB working peak. Each PDF document is
 * destroyed as soon as its text is out.
 *
 * The OCR engine (~150 MiB) is started on the first picture of a pass and
 * terminated when the pass ends, so it never sits in memory between passes.
 *
 * ── ⚠ `unpdf` and `tesseract.js` are reached by dynamic import only ─────────
 *
 * Like the Azure SDK they are external to the tsup bundle and installed beside
 * it in the image (Dockerfile). If one is ever missing, its files are left for
 * a later pass and everything else carries on — `test/import-boundary.test.ts`
 * holds the line. Tesseract fetches its English model once, into
 * `MODEL_CACHE_DIR`, the first time it runs.
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

/** Past this, a picture is not OCR'd — a phone photo is 2–5 MB. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Audio formats Groq Whisper takes (its docs, 2026-09-10; `docs/03-RESOURCES.md` §4d). */
const AUDIO_EXTENSIONS = /\.(m4a|mp3|mp4|mpeg|mpga|wav|ogg|oga|opus|flac|webm)$/i;

/** Picture formats tesseract.js reads. GIF and HEIC are not among them. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp']);
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|bmp)$/i;

export type ReadPlan = 'pdf' | 'audio' | 'image';

/** How a file is read, or null when it is not (documents, archives, GIFs). */
export function readPlanFor(mimeType: string | null, filename: string | null): ReadPlan | null {
  const type = (mimeType ?? '').toLowerCase();
  const name = filename ?? '';
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (type.startsWith('audio/') || AUDIO_EXTENSIONS.test(name)) return 'audio';
  if (IMAGE_TYPES.has(type) || (!type.startsWith('image/gif') && IMAGE_EXTENSIONS.test(name))) {
    return 'image';
  }
  return null;
}

/** OCR is trusted from this confidence (0–100) up, line by line. */
export const LINE_CONFIDENCE = 70;

/** And a picture is "readable" only with at least this many real words in those lines. */
export const MIN_READABLE_WORDS = 4;

/**
 * The text in a picture, or null when there is none worth keeping.
 *
 * "Only when it is readable" (Yuri). OCR on a photo of a room still returns
 * something — stray letters from a shelf, a pattern read as "Ill" — at low
 * confidence. So only lines OCR is confident about are kept, and the picture
 * counts as readable only if those lines hold several real words (two or more
 * letters). Measured on Yuri's saved pictures: a signature card and two bank
 * receipts kept 9 of 12 and 19 of 21 lines, 33–38 words each.
 */
export function readableText(lines: { text: string; confidence: number }[]): string | null {
  const kept = lines
    .filter((line) => line.confidence >= LINE_CONFIDENCE)
    .map((line) => line.text.trim())
    .filter(Boolean);
  const words = kept.flatMap((line) => line.split(/\s+/)).filter((word) => /\p{L}{2,}/u.test(word));
  return words.length >= MIN_READABLE_WORDS ? kept.join('\n') : null;
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

/** The OCR engine for one pass: read pictures, then close (frees ~150 MiB). */
export interface ImageReader {
  readLines(bytes: Buffer): Promise<{ text: string; confidence: number }[]>;
  close(): Promise<void>;
}

/** A fresh tesseract.js engine (English). Null if the image is missing it. */
async function startTesseract(): Promise<ImageReader | null> {
  try {
    const { createWorker } = await import('tesseract.js');
    const engine = await createWorker('eng', 1, {
      // The English model is fetched once and cached beside the embedding
      // model's weights (the Dockerfile makes this directory writable).
      cachePath: process.env.MODEL_CACHE_DIR ?? tmpdir(),
    });
    return {
      async readLines(bytes) {
        const { data } = await engine.recognize(bytes, {}, { text: true, blocks: true });
        return (data.blocks ?? []).flatMap((block) =>
          block.paragraphs.flatMap((paragraph) =>
            paragraph.lines.map((line) => ({ text: line.text, confidence: line.confidence })),
          ),
        );
      },
      close: async () => {
        await engine.terminate();
      },
    };
  } catch (error) {
    console.error(
      '[file-text] picture reading disabled this pass: could not start tesseract:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export interface FileTextOptions {
  /** Groq, for audio. Empty means recordings wait; PDFs are still read. */
  groqApiKey: string;
  batchSize: number;
  /** Files that failed transiently this process's life — retried after a restart. */
  giveUp?: Set<string>;
  /** For tests. Defaults to `unpdf`. */
  loadPdfReader?: () => Promise<PdfReader | null>;
  /** For tests. Defaults to a fresh tesseract.js engine, closed after the pass. */
  startImageReader?: () => Promise<ImageReader | null>;
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

type TextKind = 'pdf_text' | 'transcript' | 'image_text';

type Outcome =
  | { status: 'done'; kind: TextKind; content: string; preview: string; model: string }
  | { status: 'empty' | 'failed' | 'too_large'; kind: TextKind; model: string | null }
  | { status: 'deferred'; stopPass?: boolean };

/** What one pass needs to read a file, started lazily and shared across it. */
interface Readers {
  groqApiKey: string;
  pdf: () => Promise<PdfReader | null>;
  image: () => Promise<ImageReader | null>;
}

export async function readFileTexts(
  db: Database,
  container: ContainerClient,
  {
    groqApiKey,
    batchSize,
    giveUp = new Set(),
    loadPdfReader = loadUnpdf,
    startImageReader = startTesseract,
  }: FileTextOptions,
): Promise<FileTextResult> {
  // Started on the first picture of the pass, closed when the pass ends. A
  // holder object rather than a `let`, which TypeScript would narrow to null
  // in the `finally` (it cannot see the assignment inside the callback).
  const engine: { started: Promise<ImageReader | null> | null } = { started: null };
  const readers: Readers = {
    groqApiKey,
    pdf: loadPdfReader,
    image: () => (engine.started ??= startImageReader()),
  };

  try {
    return await readPass(db, container, batchSize, giveUp, readers);
  } finally {
    // ⚠ Always closed, even after a throw: an engine left running holds
    // ~150 MiB on a 1 GiB worker until the process dies.
    const started = await engine.started;
    await started?.close().catch(() => {});
  }
}

async function readPass(
  db: Database,
  container: ContainerClient,
  batchSize: number,
  giveUp: Set<string>,
  readers: Readers,
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
            or a.mime_type in ('image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp')
            or a.filename ~* '\\.(pdf|m4a|mp3|mp4|mpeg|mpga|wav|ogg|oga|opus|flac|webm|png|jpe?g|webp|bmp)$')
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
      outcome = await readOne(container, file, readers);
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

const KIND_OF: Record<ReadPlan, TextKind> = {
  pdf: 'pdf_text',
  audio: 'transcript',
  image: 'image_text',
};

const LIMIT_OF: Record<ReadPlan, number> = {
  pdf: MAX_PDF_BYTES,
  audio: MAX_AUDIO_BYTES,
  image: MAX_IMAGE_BYTES,
};

async function readOne(
  container: ContainerClient,
  file: PendingFile,
  readers: Readers,
): Promise<Outcome> {
  const plan = readPlanFor(file.mime_type, file.filename)!;
  const kind = KIND_OF[plan];
  const limit = LIMIT_OF[plan];

  // Decided before downloading anything: the size was recorded when it was saved.
  if (Number(file.size_bytes ?? 0) > limit) return { status: 'too_large', kind, model: null };

  if (plan === 'audio' && !readers.groqApiKey) return { status: 'deferred' };
  const pdfReader = plan === 'pdf' ? await readers.pdf() : null;
  if (plan === 'pdf' && !pdfReader) return { status: 'deferred' };
  const imageReader = plan === 'image' ? await readers.image() : null;
  if (plan === 'image' && !imageReader) return { status: 'deferred' };

  const bytes = await container.getBlockBlobClient(file.blob_url).downloadToBuffer();
  if (bytes.length > limit) return { status: 'too_large', kind, model: null };

  if (plan === 'image') {
    let lines: { text: string; confidence: number }[];
    try {
      lines = await imageReader!.readLines(bytes);
    } catch {
      // An image tesseract cannot decode fails the same way every time.
      return { status: 'failed', kind, model: 'tesseract' };
    }
    // "Only when it is readable": a photo with no confident words is empty.
    const readable = readableText(lines);
    const text = readable ? tidyText(readable) : null;
    return text
      ? { status: 'done', kind, ...text, model: 'tesseract' }
      : { status: 'empty', kind, model: 'tesseract' };
  }

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
      apiKey: readers.groqApiKey,
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

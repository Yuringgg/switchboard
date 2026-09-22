/**
 * Ask for a transcript of a finished recording, then write down what comes back
 * (Phase 7A).
 *
 * Run:
 *   node --env-file=apps/worker/.env \
 *     apps/worker/node_modules/tsx/dist/cli.mjs \
 *     apps/worker/scripts/fetch-transcript.ts --recording <uuid>
 *
 * Flags:
 *   --recording ID   the finished recording to transcribe      (required)
 *   --transcript ID  skip creation, just poll an existing one  (optional)
 *   --every MS       pause between polls                       (default 10000)
 *   --for MS         give up after this long                   (default 900000 — 15m)
 *   --out PATH       where to write the shapes                 (default D:/Claude Code/_scratch/recall)
 *
 * ── ⚠ WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * `probe-recall.ts` answered the first open question — a recording DOES carry
 * the bot id, so the tenant lookup in `lib/meetings/payload.ts` works. This
 * answers the second and last one before any mapping can be written:
 *
 *   **what does a transcript actually look like?**
 *
 * Nothing maps a transcript into `messages` until that has been READ. The Vapi
 * payload-shape guess cost most of a day (see the header of
 * `lib/meetings/payload.ts`) and this is the same class of unknown.
 *
 * ⚠ It writes NOTHING to the database, for the same reason the probe does not:
 * reading a shape and deciding what it means are two jobs, and doing both in
 * one pass is how a guess becomes a schema.
 *
 * ⚠ Output goes outside the repo. A transcript is a real conversation between
 * real people and has no business in git.
 *
 * ── The flow, read from Recall's post-meeting transcription guide, 2026-09-20 ─
 *
 *   1. POST /recording/{id}/create_transcript/   → a transcript artifact
 *   2. poll GET /transcript/{id}/                → until status.code is terminal
 *   3. GET data.download_url                     → the transcript itself
 *
 * Their guide drives steps 2 and 3 off `transcript.done` webhooks. We poll
 * instead, because webhooks cannot currently be created on this account at all
 * — their dashboard's Svix portal does nothing, and there is no webhook path in
 * the public API. A webhook is Recall telling us; polling is us asking. Same
 * answer, and the transcript endpoint reports its own status either way.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const RECORDING_ID = flag('recording');
const EXISTING_TRANSCRIPT_ID = flag('transcript');
const EVERY_MS = Number(flag('every') ?? 10_000);
const FOR_MS = Number(flag('for') ?? 15 * 60_000);
const OUT_DIR = flag('out') ?? 'D:/Claude Code/_scratch/recall';

const REGION = process.env.RECALL_REGION ?? 'ap-northeast-1';
const BASE = `https://${REGION}.recall.ai/api/v1`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Terminal states for a transcript artifact. Polling past these burns quota. */
const FINISHED = new Set(['done', 'failed', 'deleted']);

/** ⚠ No `Bearer`. Recall's own examples use the bare key; the prefix 401s. */
function headers(apiKey: string): Record<string, string> {
  return { authorization: apiKey, accept: 'application/json' };
}

async function get(apiKey: string, path: string): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, { headers: headers(apiKey) });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`GET ${path} → HTTP ${response.status}: ${detail}`);
  }
  return response.json();
}

/** Every key present, nested, so a shape can be read at a glance. */
function shapeOf(value: unknown, depth = 0): unknown {
  if (depth > 5) return '…';
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [shapeOf(value[0], depth + 1), `…${value.length} total`];
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, shapeOf(v, depth + 1)]),
    );
  }
  return value === null ? null : typeof value;
}

async function save(name: string, data: unknown): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  saved → ${path}`);
}

/**
 * Start a transcription job.
 *
 * ⚠ `recallai_async` — NOT `recallai_streaming`. The streaming providers belong
 * in `recording_config` on the bot and are configured before the meeting; this
 * one runs against the finished recording. Sending the async name to the bot
 * endpoint is a 400, and it is the mistake that cost a round trip in
 * `api/meetings/bot/route.ts` (see the note there).
 *
 * ⚠ A recording allows 10 successful transcripts and 100 attempts, ever. After
 * that the endpoint 400s until old ones are deleted. So this is deliberately
 * one call behind a flag rather than anything that could run in a loop.
 */
async function createTranscript(apiKey: string, recordingId: string): Promise<unknown> {
  const response = await fetch(`${BASE}/recording/${recordingId}/create_transcript/`, {
    method: 'POST',
    headers: { ...headers(apiKey), 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: { recallai_async: { language_code: 'auto' } },
      // "Perfect diarization" — attributes each utterance to a named
      // participant using their separate audio stream, rather than guessing
      // speaker turns from mixed audio. Speaker names are the whole point for a
      // brief: an utterance nobody is attached to cannot become a message.
      diarization: { use_separate_streams_when_available: true },
    }),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 400);
    throw new Error(`POST create_transcript → HTTP ${response.status}: ${detail}`);
  }

  return response.json();
}

function statusOf(artifact: Record<string, unknown>): string {
  const status = artifact.status;
  if (status && typeof status === 'object') {
    const code = (status as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'unknown';
}

async function main(): Promise<void> {
  const apiKey = process.env.RECALL_API_KEY;
  if (!apiKey) throw new Error('RECALL_API_KEY is not set');
  if (!RECORDING_ID && !EXISTING_TRANSCRIPT_ID) {
    throw new Error(
      '--recording <uuid> is required (or --transcript <uuid> to poll an existing one)',
    );
  }

  let transcriptId = EXISTING_TRANSCRIPT_ID;

  if (!transcriptId) {
    console.log(`[transcript] requesting async transcription of recording ${RECORDING_ID}`);
    const created = (await createTranscript(apiKey, RECORDING_ID!)) as Record<string, unknown>;
    await save('transcript-create.json', created);
    await save('transcript-create.shape.json', shapeOf(created));

    const id = created.id;
    if (typeof id !== 'string') {
      throw new Error('create_transcript returned no id — read transcript-create.json');
    }
    transcriptId = id;
    console.log(`[transcript] job started: ${transcriptId}`);
  }

  const startedAt = Date.now();
  let artifact: Record<string, unknown> | null = null;
  let code = 'unknown';

  while (Date.now() - startedAt < FOR_MS) {
    artifact = (await get(apiKey, `/transcript/${transcriptId}/`)) as Record<string, unknown>;
    code = statusOf(artifact);
    console.log(`[transcript] ${new Date().toISOString()}  ${code}`);
    if (FINISHED.has(code)) break;
    await sleep(EVERY_MS);
  }

  if (!artifact) throw new Error('never got a transcript artifact back');

  await save('transcript-artifact.json', artifact);
  await save('transcript-artifact.shape.json', shapeOf(artifact));

  if (code !== 'done') {
    console.error(`[transcript] finished as "${code}" — read transcript-artifact.json for sub_code`);
    return;
  }

  /*
   * ⚠⚠ THE THING THIS SCRIPT EXISTS FOR.
   *
   * The artifact is metadata. The transcript itself lives behind a signed S3
   * URL on `data.download_url`, and that URL is what the worker will eventually
   * fetch and map into `messages`. Nothing writes that mapping until the file
   * below has been read by a person.
   */
  const data = artifact.data;
  const downloadUrl =
    data && typeof data === 'object' ? (data as { download_url?: unknown }).download_url : undefined;

  if (typeof downloadUrl !== 'string') {
    console.error('[transcript] no data.download_url on a done artifact — read the artifact file');
    return;
  }

  // ⚠ No auth header. It is a pre-signed URL, and sending the API key to S3
  // would hand it to a third party for no benefit.
  const body = await fetch(downloadUrl);
  if (!body.ok) throw new Error(`GET download_url → HTTP ${body.status}`);

  const transcript = await body.json();
  await save('transcript.json', transcript);
  await save('transcript.shape.json', shapeOf(transcript));

  console.log('\n[transcript] done. Read transcript.shape.json before writing any mapping.');
}

main().catch((cause) => {
  console.error(`[transcript] ${cause instanceof Error ? cause.message : 'failed'}`);
  process.exit(1);
});

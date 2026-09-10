import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_AUDIO_BYTES,
  transcribeAudio,
  TRANSCRIPTION_LANGUAGE,
  TRANSCRIPTION_MODEL,
} from '../src/transcribe';

/**
 * Speech to text (voice V0).
 *
 * The thing worth testing here is not the happy path — it is that a failure is
 * REPORTED rather than thrown, on every branch. This is called from a route
 * handler, and a throw there surfaces to the user as a blank screen instead of
 * a message.
 */

function stub(body: string, init: ResponseInit = {}) {
  // The parameters are declared even though they are unused: without them
  // `vi.fn` infers a zero-argument tuple and `mock.calls[0][1]` does not
  // typecheck, which is how the request body gets asserted below.
  const fetchSpy = vi.fn(
    async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
      new Response(body, { status: 200, ...init }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

function clip(bytes = 2048, type = 'audio/webm'): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

async function run(audio: Blob = clip()) {
  return transcribeAudio({ apiKey: 'test-key', audio, filename: 'speech.webm' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transcribeAudio', () => {
  it('returns the transcript on success', async () => {
    stub('  Do I have any meetings today?  ');

    const result = await run();

    expect(result.ok).toBe(true);
    // Trimmed: `response_format: text` returns the body with surrounding
    // whitespace, and an untrimmed transcript becomes an untrimmed question.
    if (result.ok) {
      expect(result.text).toBe('Do I have any meetings today?');
      expect(result.model).toBe(TRANSCRIPTION_MODEL);
    }
  });

  it('sends the model and pins the language to English', async () => {
    const fetchSpy = stub('hello');

    await run();

    const body = fetchSpy.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get('model')).toBe(TRANSCRIPTION_MODEL);
    // Ms. Maria's V6. Whisper auto-detects when this is unset, and a short
    // English clip in a Filipino accent gets detected as Tagalog often enough
    // to matter.
    expect(body.get('language')).toBe(TRANSCRIPTION_LANGUAGE);
    expect(body.get('response_format')).toBe('text');
  });

  it('does not set content-type, so fetch can add the multipart boundary', async () => {
    const fetchSpy = stub('hello');

    await run();

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    // Setting it by hand omits the boundary, and the request fails with a 400
    // that does not say why.
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('content-type');
    expect(headers.authorization).toBe('Bearer test-key');
  });

  it('reports an empty recording without calling the provider', async () => {
    const fetchSpy = stub('unused');

    const result = await transcribeAudio({
      apiKey: 'test-key',
      audio: new Blob([], { type: 'audio/webm' }),
      filename: 'speech.webm',
    });

    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an oversized clip without spending the upload', async () => {
    const fetchSpy = stub('unused');

    const result = await run(clip(MAX_AUDIO_BYTES + 1));

    // Not retryable — the same oversized file fails the same way every time.
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats silence as a reported failure, not an empty transcript', async () => {
    stub('   ');

    const result = await run();

    /*
     * An empty 200 is what silence returns, and tapping the mic by accident is
     * the common way to get there. It must not become an empty question: the
     * assistant's budget is roughly thirty completions a day and spending one
     * to answer nothing is the waste this branch prevents.
     */
    expect(result).toMatchObject({ ok: false, retryable: false });
    if (!result.ok) expect(result.reason).toBe('no speech detected');
  });

  it('marks a 429 retryable and reads retry-after', async () => {
    stub('rate limited', { status: 429, headers: { 'retry-after': '2.5' } });

    const result = await run();

    expect(result).toMatchObject({ ok: false, retryable: true });
    // parseFloat, not parseInt — 2.5s truncated to 2s gets rejected again
    // immediately.
    if (!result.ok) expect(result.retryAfterMs).toBe(2500);
  });

  it('marks a 5xx retryable', async () => {
    stub('upstream error', { status: 503 });

    expect(await run()).toMatchObject({ ok: false, retryable: true });
  });

  it('marks a bad key NOT retryable', async () => {
    stub('invalid api key', { status: 401 });

    // Re-sending an identical bad request burns the allowance to fail the same
    // way. The caller uses this to decide whether to stop or back off.
    expect(await run()).toMatchObject({ ok: false, retryable: false });
  });

  it('never returns the provider error body', async () => {
    stub('{"error":{"message":"something that could echo input"}}', { status: 400 });

    const result = await run();

    // Status and headers only. The body is not read on any status here — see
    // the note in transcribe.ts for why the 429 exception in groq.ts does not
    // extend to this file.
    if (!result.ok) {
      expect(result.reason).toBe('groq transcription http 400');
      expect(result.reason).not.toContain('echo input');
    }
  });

  it('reports a network failure instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('econnreset');
      }),
    );

    // The property this whole file is really about.
    await expect(run()).resolves.toMatchObject({ ok: false, retryable: true });
  });

  it('reports a timeout as retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }),
    );

    const result = await transcribeAudio(
      { apiKey: 'test-key', audio: clip(), filename: 'speech.webm' },
      { timeoutMs: 50 },
    );

    expect(result).toMatchObject({ ok: false, retryable: true });
    if (!result.ok) expect(result.reason).toContain('timed out');
  });
});

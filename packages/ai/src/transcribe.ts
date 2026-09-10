/**
 * Speech to text, through Groq's Whisper (voice V0).
 *
 * ── Why Groq and not Gemini ─────────────────────────────────────────────────
 *
 * The meeting note says Gemini does audio-to-text. Groq is the better fit here,
 * for four reasons, and the plan in
 * `correspondence/2026-09-10-voice-integration-plan.md` §4 has the full case:
 *
 *   1. The key already exists. `GROQ_API_KEY` is set in both apps.
 *   2. Groq publishes its free limits and they are large — 20 req/min,
 *      2,000 req/day, 28,800 audio-seconds/day. That is 8 hours of speech a
 *      day. Verified from Groq's docs 2026-09-10.
 *   3. Google no longer publishes free limits at all. The last time this
 *      project measured Gemini 2.5 Flash it was 20 requests per DAY
 *      (2026-08-02, read off the quota error). Twenty sentences would use it up.
 *   4. It is a different model bucket from the assistant's 70B. Groq's limits
 *      are per-model, so transcribing can never eat the assistant's budget.
 *      Same failure-isolation argument as ADR-003.
 *
 * ── Native fetch, no SDK ────────────────────────────────────────────────────
 *
 * Same reason `groq.ts` gives: the worker is bundled into one file by tsup and
 * this project has already lost a container to a dependency that could not
 * survive that. The API is one multipart POST. An SDK buys nothing.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * ⚠ `whisper-large-v3-turbo`, not `whisper-large-v3`.
 *
 * Both have the same free limits. Turbo runs at 216x realtime against the other
 * one's 189x, and the error rate difference is small: 12% against 10.3%.
 * Verified from Groq's docs 2026-09-10.
 *
 * Speed is the point. The whole feature is judged on a latency number, and a
 * 5-second clip is about 23ms of compute on this model.
 *
 * ⚠ Turbo transcribes only. It cannot translate. If Tagalog output ever needs
 * translating to English, that is `whisper-large-v3` on a different endpoint —
 * but Ms. Maria deferred Tagalog, so not now.
 */
export const TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';

/**
 * Groq's free-tier upload cap, in bytes.
 *
 * Checked here rather than at the call site so every caller gets it. Sending a
 * 30 MB file to be told no wastes the upload and the round trip.
 *
 * ⚠ This is the FREE tier number. The dev tier allows 100 MB. If this project
 * ever pays for Groq, raise it here.
 */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * How long a clip may be, in seconds.
 *
 * Not Groq's limit — ours. Three reasons, and the first two are the real ones:
 *
 *   · A recorder that never stops is a microphone left open in a room. The
 *     plan's §7 makes the cap a stated security control, not a nicety.
 *   · It keeps the upload small, which keeps the latency number honest.
 *   · Nobody asks a 30-second question.
 */
export const MAX_CLIP_SECONDS = 30;

/**
 * English only, on purpose (Ms. Maria's V6).
 *
 * Whisper auto-detects the language when this is not set. Pinning it is better
 * than letting it guess: a short English clip with a Filipino accent gets
 * detected as Tagalog often enough to matter, and the result is a transcript in
 * the wrong language that then goes to the assistant as a question.
 *
 * ⚠ Tagalog is deferred, not rejected. Ms. Maria's reason was to keep the scope
 * small for now. When it comes back, this is the line that changes.
 */
export const TRANSCRIPTION_LANGUAGE = 'en';

/**
 * The result, reported and never thrown.
 *
 * Same rule as `CompletionResult` and every adapter's `normalize`. A throw from
 * here would surface as an unhandled rejection inside a route handler, which
 * the user sees as a blank screen rather than a message.
 */
export type TranscriptionResult =
  | { ok: true; text: string; model: string }
  | {
      ok: false;
      reason: string;
      retryable: boolean;
      /** From the provider's `retry-after` header, when it sends one. */
      retryAfterMs?: number;
    };

export interface TranscribeOptions {
  /** Abort rather than hold the user's page open. */
  timeoutMs?: number;
}

export interface TranscribeInput {
  apiKey: string;
  /** The recorded clip. */
  audio: Blob;
  /** Filename sent to Groq. The extension is how it reads the format. */
  filename: string;
}

/**
 * Turn a clip into text.
 *
 * ⚠ Returns text and nothing else. It writes no row, touches no database, and
 * has no idea who is asking. That is deliberate — the narrow surface is the
 * same argument the worker's `/embed` endpoint makes.
 */
export async function transcribeAudio(
  { apiKey, audio, filename }: TranscribeInput,
  { timeoutMs = 20_000 }: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  if (audio.size === 0) {
    return { ok: false, reason: 'the recording is empty', retryable: false };
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    // Not retryable: sending the same oversized file again fails the same way.
    return {
      ok: false,
      reason: `the recording is ${Math.round(audio.size / 1024 / 1024)} MB, over the ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB limit`,
      retryable: false,
    };
  }

  const form = new FormData();
  form.append('file', audio, filename);
  form.append('model', TRANSCRIPTION_MODEL);
  form.append('language', TRANSCRIPTION_LANGUAGE);
  /*
   * `text` rather than `json` or `verbose_json`.
   *
   * We want the words. `verbose_json` adds per-segment timings and confidence
   * scores that nothing here reads, and it makes the response several times
   * bigger for no gain.
   */
  form.append('response_format', 'text');

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      // ⚠ No content-type header. `fetch` sets it from the FormData, including
      // the multipart boundary. Setting it by hand omits the boundary and the
      // request fails with a 400 that does not say why.
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: abort.signal,
    });

    if (!response.ok) {
      /*
       * Same split as `groq.ts`. 429 is quota and 5xx is Groq being unwell —
       * both worth retrying. 400/401/403 mean the request or the key is wrong,
       * and re-sending it burns the allowance to fail the same way.
       */
      const retryable = response.status === 429 || response.status >= 500;

      // Groq may send a fractional value ("11.75"). parseFloat, not parseInt,
      // or an 11.75s wait becomes 11s and gets rejected again straight away.
      const retryAfter = Number.parseFloat(response.headers.get('retry-after') ?? '');
      const retryAfterMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.ceil(retryAfter * 1000)
          : undefined;

      /*
       * ⚠ The body is NOT read, on any status.
       *
       * `groq.ts` reads it on a 429 to learn which limit was hit, and that is a
       * documented exception. It does not extend here for two reasons:
       *
       *   · Whisper's limits include audio-seconds-per-hour and per-day (ASH,
       *     ASD), which no code in this repo has ever seen a real 429 for. A
       *     parser written against a message shape nobody has observed would be
       *     a guess, and this project's rule is not to guess at provider
       *     behaviour.
       *   · The daily allowance is 2,000 requests. It is not the limit that will
       *     bite, so the minute-versus-day distinction earns much less here than
       *     it does for the assistant.
       *
       * Status and headers only, which is the default rule.
       */
      return {
        ok: false,
        reason: `groq transcription http ${response.status}`,
        retryable,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      };
    }

    // `response_format: text` returns the transcript as a bare string, not JSON.
    const text = (await response.text()).trim();

    /*
     * An empty 200 is normal, not broken. It is what silence returns, and
     * someone tapping the mic by accident is the common way to get here.
     *
     * Reported as a failure so the caller can say "I didn't catch that" rather
     * than sending an empty question to the assistant — which would spend a
     * completion from a budget of about thirty a day to answer nothing.
     */
    if (!text) {
      return { ok: false, reason: 'no speech detected', retryable: false };
    }

    return { ok: true, text, model: TRANSCRIPTION_MODEL };
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    return {
      ok: false,
      reason: aborted ? `transcription timed out after ${timeoutMs}ms` : 'transcription request failed',
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

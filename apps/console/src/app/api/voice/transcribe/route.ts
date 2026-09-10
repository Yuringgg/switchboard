import { MAX_AUDIO_BYTES, transcribeAudio } from '@switchboard/ai';
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Turn a recorded clip into text (voice V0).
 *
 * ── Why this is a server route and not a browser call ───────────────────────
 *
 * Two reasons, and the first is the one that matters:
 *
 * 1. **The Groq key never reaches the browser.** The client posts audio and
 *    gets back words. Same rule ADR-013 sets for `service_role`, applied to a
 *    different secret. A key in a browser bundle is a key anyone can read.
 * 2. It keeps the browser out of the business of knowing which model, which
 *    language and which endpoint. Change those in one place.
 *
 * ── Why not the Web Speech API instead ──────────────────────────────────────
 *
 * Chrome's `SpeechRecognition` would do this with no server at all — and it
 * sends the raw microphone audio to a Google service to do it. MDN says so
 * plainly, and it is why that API does not work offline. There is no agreement
 * between that service and this deployment about what happens to the audio, and
 * a spoken question here routinely contains a client's name.
 *
 * So: record locally, send to a vendor already inside the trust boundary. It is
 * also the portable choice — MDN lists that API as limited availability, which
 * in practice means Chrome only.
 *
 * ── What this route does NOT do ─────────────────────────────────────────────
 *
 * ⚠ It stores nothing. The audio goes to Groq and out of scope. No table, no
 * blob container, no retention question, and nothing new under RA 10173.
 *
 * ⚠ It is not call recording. This is a person dictating a query, which is on
 * the right side of ADR-008 and RA 4200. The 30-second cap in the recorder and
 * the fact that nothing is kept are what hold that line, so neither is
 * decoration.
 */
export async function POST(request: Request) {
  /*
   * ⚠ This route authenticates itself.
   *
   * `/api` sits in `PUBLIC_PATHS` in `src/proxy.ts` — deliberately, because
   * Google's and Meta's webhooks arrive with no cookie and gating them on a
   * session would redirect every delivery to /login. The note there is
   * explicit: anything added under /api must do its own auth. This is that.
   */
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // Named plainly. A missing key is a deployment problem, and "transcription
    // failed" would send someone looking at the microphone instead.
    return NextResponse.json(
      { error: 'Transcription is not configured on this deployment (GROQ_API_KEY is not set).' },
      { status: 503 },
    );
  }

  let audio: File | null = null;
  try {
    const form = await request.formData();
    const field = form.get('audio');
    audio = field instanceof File ? field : null;
  } catch {
    return NextResponse.json({ error: 'Could not read the upload.' }, { status: 400 });
  }

  if (!audio) {
    return NextResponse.json({ error: 'No audio in the request.' }, { status: 400 });
  }

  /*
   * Checked here as well as in the provider, because this is the edge. A body
   * that is over the limit should be refused at the door rather than after it
   * has been parsed and handed on.
   */
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'That recording is too long.' }, { status: 413 });
  }

  const startedAt = Date.now();

  const result = await transcribeAudio({
    apiKey,
    audio,
    /*
     * The extension is how Groq reads the format, so it has to match what the
     * browser actually recorded. Chrome gives `audio/webm;codecs=opus` and
     * Safari gives `audio/mp4` — both are on Groq's accepted list, but only if
     * the filename agrees with the bytes.
     */
    filename: filenameFor(audio.type),
  });

  const elapsedMs = Date.now() - startedAt;

  if (!result.ok) {
    /*
     * ⚠ `result.reason` is a developer string and is logged, not returned. It
     * names the provider and the status code, which a user cannot act on.
     *
     * No transcript is logged, here or anywhere. It is the user's own speech.
     */
    console.error(`[voice] transcription failed: ${result.reason}`);

    return NextResponse.json(
      {
        error: result.retryable
          ? 'Transcription is busy right now. Try again in a moment.'
          : "Could not make out any speech in that. Try again, a bit closer to the mic.",
      },
      { status: result.retryable ? 503 : 422 },
    );
  }

  /*
   * `elapsedMs` is returned on purpose, and only from this route.
   *
   * V2 of the plan turns "7/10 responsiveness" into a measured number rather
   * than a claim, and this is one stage of it. Measuring from inside the server
   * separates the provider's time from the upload's.
   */
  return NextResponse.json({
    text: result.text,
    model: result.model,
    elapsedMs,
    bytes: audio.size,
    mimeType: audio.type || 'unknown',
  });
}

/**
 * A filename whose extension matches the recorded bytes.
 *
 * Groq reads the format from the extension, so this is not cosmetic. The
 * browser decides the container, not us: Chrome and Firefox produce webm/opus,
 * Safari produces mp4. Both are supported — sending Safari's mp4 bytes under a
 * `.webm` name is what breaks.
 */
function filenameFor(mimeType: string): string {
  // `audio/webm;codecs=opus` — the parameters are not part of the type.
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';

  const extension =
    {
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/mp4': 'mp4',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/flac': 'flac',
    }[base] ??
    // An unknown type is more likely a browser we have not seen than a bad
    // file. webm is the common default, so try it rather than refusing.
    'webm';

  return `speech.${extension}`;
}

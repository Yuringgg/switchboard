/**
 * Reading an answer out loud (voice V1).
 *
 * Browser `speechSynthesis`, not a TTS API. It costs nothing, has no quota,
 * needs no key, and starts in about 50ms because it never leaves the machine.
 * The plan's §5 has the full case, and the short version is that a network
 * voice adds 300–800ms to a latency number Ms. Maria stated as a requirement,
 * while voice timbre is not one.
 *
 * If she says it sounds cheap, replace the body of `speak()` — the rest of the
 * app only knows this interface — and re-measure §2.
 */

/**
 * Strip the citation markers before speaking.
 *
 * ── ⚠ Why the markers exist in the text at all ──────────────────────────────
 *
 * "[1]" read aloud is "bracket one". But the markers cannot simply be prompted
 * away: `parseAnswer` decides a refusal by counting citations, so a model told
 * not to cite produces an answer that parses as refused every single time.
 *
 * So the model still cites, the screen still shows the chips, and the words are
 * cleaned up here at the last possible moment. Voice does not skip the
 * evidence — it just does not read it out.
 */
export function forSpeech(answer: string): string {
  return (
    answer
      /*
       * "[1]" and "[1][4]" — including any space that ran up to them, so
       * "meetings [1]." does not become "meetings ." when spoken.
       *
       * ⚠ One or two digits, NOT `\d+`. A citation index can never exceed
       * `MAX_CONTEXT_MESSAGES`, which is 8 — but a message body routinely
       * contains a bracketed year, and `\d+` silently ate "[2026]" out of a
       * sentence about an invoice. Caught by a test, which is the only way that
       * class of bug gets found: the answer still sounded like a fluent
       * sentence, just with a fact missing from it.
       */
      .replace(/\s*\[\d{1,2}\]/g, '')
      // Markdown the model sometimes reaches for. Asterisks are read aloud as
      // "star" by some voices, which is worse than the emphasis is worth.
      .replace(/[*_`]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Pick a voice, rather than taking the default.
 *
 * The default is often the worst one installed — on Windows it is frequently a
 * low-quality legacy voice while a much better one sits second in the list.
 * Preference order: a local English voice (no network hop, so no delay), then
 * any English voice, then whatever exists.
 *
 * ⚠ Returns null on the first call in Chrome. `getVoices()` populates
 * asynchronously and is empty until `voiceschanged` fires. Null is a fine
 * answer — the browser falls back to its default, which is better than not
 * speaking. `primeVoices()` below is what makes the second call useful.
 */
export function pickVoice(): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null;

  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'));

  return (
    english.find((voice) => voice.localService) ?? english[0] ?? voices[0] ?? null
  );
}

/**
 * Ask the browser to load its voice list early.
 *
 * Called on mount so the list is ready by the time there is something to say.
 * Without it the first spoken answer of a session uses the default voice and
 * every later one uses the chosen voice, which sounds like a bug.
 */
export function primeVoices(): () => void {
  if (!speechSupported()) return () => {};

  // Triggers the async load in Chrome. The return value is deliberately unused.
  window.speechSynthesis.getVoices();

  const onChange = () => window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', onChange);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', onChange);
}

export interface SpeakHandlers {
  /** Fires as each word begins. Drives the orb's pulse. */
  onBoundary?: () => void;
  /** Fires when the utterance finishes, is cancelled, or fails. */
  onEnd?: () => void;
}

/**
 * Say something.
 *
 * ⚠ Must be reached from a user gesture. Chrome and Safari refuse to speak
 * otherwise, and they refuse **silently** — no error, no event, nothing in the
 * console. The tap that starts a recording is that gesture, so the voice loop
 * is fine; anything that speaks without one is not, and will look broken
 * without saying why.
 */
export function speak(text: string, handlers: SpeakHandlers = {}): void {
  if (!speechSupported()) {
    handlers.onEnd?.();
    return;
  }

  const spoken = forSpeech(text);
  if (!spoken) {
    handlers.onEnd?.();
    return;
  }

  // Whatever is still being said is now stale. Cancel before queueing, or the
  // new answer waits behind the old one.
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(spoken);
  const voice = pickVoice();
  if (voice) {
    utterance.voice = voice;
    // Setting lang as well as voice: some engines ignore the voice and read
    // `lang`, and a mismatch produces English words in a Spanish accent.
    utterance.lang = voice.lang;
  }

  /*
   * A touch faster than default. Measured against nothing — it is a taste
   * call, and 1.0 sounds sluggish for a one-sentence status answer. Slow it
   * down if anyone finds it hard to follow.
   */
  utterance.rate = 1.05;

  utterance.addEventListener('boundary', () => handlers.onBoundary?.());
  utterance.addEventListener('end', () => handlers.onEnd?.());
  // `error` fires on cancel too. Treated the same: either way it stopped, and
  // the caller's job is to put the orb back to rest.
  utterance.addEventListener('error', () => handlers.onEnd?.());

  window.speechSynthesis.speak(utterance);
}

/** Stop talking. Safe to call when nothing is being said. */
export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}

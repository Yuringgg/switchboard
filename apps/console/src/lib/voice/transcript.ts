/**
 * Folding live transcript messages into readable turns.
 *
 * ⚠ Pure, and in `lib/` rather than beside the component, for the reason the
 * signature check and the payload parser are: it has to be testable without a
 * live call. Vitest on this project has no JSX transform — no console `.tsx`
 * has ever been imported by a test — so logic that needs pinning cannot live in
 * a component file.
 */

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
  /**
   * False while the transcriber is still revising this utterance.
   *
   * ⚠ Partials arrive many times a second and REPLACE each other — they are not
   * additive. Appending them produces "what what's what's in my" and reads as a
   * stutter in the product rather than in the transcriber.
   */
  final: boolean;
}

/**
 * Fold one transcript message into the turns so far.
 *
 * ⚠ Returns a new array. It feeds a `setState` updater, where mutating the
 * previous value skips the re-render and the transcript silently stops moving.
 */
export function foldTranscript(
  turns: TranscriptTurn[],
  incoming: { role: 'user' | 'assistant'; text: string; final: boolean },
): TranscriptTurn[] {
  const text = incoming.text.trim();
  // The transcriber emits these between utterances. A blank bubble is worse
  // than nothing.
  if (!text) return turns;

  const last = turns[turns.length - 1];

  /*
   * A partial or final from the SAME speaker replaces their turn in progress.
   * Anything else starts a new one — which is what makes barge-in read
   * correctly: she is mid-sentence, you cut in, and your words open a turn of
   * their own rather than overwriting hers.
   */
  if (last && last.role === incoming.role && !last.final) {
    const updated = [...turns];
    updated[updated.length - 1] = { role: incoming.role, text, final: incoming.final };
    return updated;
  }

  return [...turns, { role: incoming.role, text, final: incoming.final }];
}

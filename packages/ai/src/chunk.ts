/**
 * Splitting a message body into embeddable chunks (Phase 4B).
 *
 * Pure, and separated from the model for the same reason every adapter's
 * `normalize` is pure: this is the piece most likely to be subtly wrong, and it
 * can be tested exhaustively without loading 129 MB of weights.
 *
 * ── Why chunking exists at all ───────────────────────────────────────────────
 *
 * `multilingual-e5-small` caps at **512 tokens**. Chat messages fit whole;
 * emails routinely do not. Feed it a long body and it does not error — it
 * **silently truncates**, so the tail of every long email becomes unsearchable
 * while looking perfectly indexed. `docs/02-ARCHITECTURE.md` §5 lists that as a
 * known trap, and it is the kind that surfaces months later as "search is bad".
 */

/**
 * Target chunk size, in characters.
 *
 * ⚠ Sized for **Taglish**, not English. Tokenizers split code-switched text
 * more aggressively than they split English — Tagalog words are largely absent
 * from the vocabulary and fragment into pieces — so the usual "4 characters per
 * token" rule overstates capacity here. At roughly 3 characters per token,
 * 1,000 characters is about 330 tokens, comfortably inside 512 with room for
 * the `passage: ` prefix and the tokenizer's special tokens.
 *
 * Using the English rule of thumb would put a 2,000-character chunk at ~500
 * tokens in English and ~660 in Taglish — over the cap, truncated, and silent.
 */
export const CHUNK_SIZE = 1000;

/**
 * How much each chunk repeats of the one before it.
 *
 * Without overlap a sentence that straddles a boundary is embedded as two
 * half-sentences and matches neither half of its own meaning. 150 characters is
 * roughly a sentence and a half — enough that any single sentence survives
 * intact in at least one chunk.
 */
export const CHUNK_OVERLAP = 150;

/** Below this, a trailing fragment is folded into the previous chunk instead. */
const MIN_TAIL = 120;

export interface Chunk {
  index: number;
  content: string;
}

/**
 * Split a body into overlapping chunks, preferring natural boundaries.
 *
 * The boundary search walks outward from the target size: paragraph break
 * first, then sentence end, then any whitespace, then a hard cut. A hard cut is
 * the last resort rather than the default because a chunk that begins
 * mid-word embeds that fragment as though it were a word.
 */
export function chunkText(
  bodyText: string,
  { size = CHUNK_SIZE, overlap = CHUNK_OVERLAP } = {},
): Chunk[] {
  const text = normaliseWhitespace(bodyText);
  if (!text) return [];

  /*
   * ⚠ Clamp the overlap to half the chunk, and this is a real guard, not a
   * formality.
   *
   * An earlier version only stopped the cursor from standing still
   * (`step = max(1, size - overlap)`). With `size: 200, overlap: 500` that
   * yields a step of **one character**, so the text is re-chunked at every
   * offset — a 3,600-character body produced 3,690 chunks. It terminates, which
   * is why it passed a naive termination test, and then embeds thousands of
   * near-identical vectors: minutes of CPU and a corpus where every query
   * matches everything.
   *
   * Half is the useful ceiling anyway. Past it, consecutive chunks share more
   * text than they contribute.
   */
  const effectiveOverlap = Math.min(Math.max(overlap, 0), Math.floor(size / 2));
  const step = Math.max(1, size - effectiveOverlap);

  if (text.length <= size) return [{ index: 0, content: text }];

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < text.length) {
    const hardEnd = Math.min(start + size, text.length);

    // The final piece: take it whole rather than looking for a boundary.
    if (hardEnd === text.length) {
      const tail = text.slice(start).trim();

      /*
       * A very short tail is folded into the previous chunk instead of becoming
       * a chunk of its own. A 20-character chunk — "Thanks!\n\nMaria" — embeds
       * to a vector that is close to every other pleasantry in the corpus, so
       * it surfaces as a false match for almost any query while carrying no
       * information. Merging costs a slightly oversized final chunk; leaving it
       * costs retrieval quality on every search.
       */
      if (tail.length < MIN_TAIL && chunks.length > 0) {
        const last = chunks[chunks.length - 1]!;
        const merged = `${last.content} ${tail}`.trim();
        chunks[chunks.length - 1] = { index: last.index, content: merged };
      } else if (tail) {
        chunks.push({ index: chunks.length, content: tail });
      }
      break;
    }

    const end = findBoundary(text, start, hardEnd);
    const content = text.slice(start, end).trim();
    if (content) chunks.push({ index: chunks.length, content });

    /*
     * Advance from the boundary actually used, not from the nominal step, or a
     * paragraph break found early would be re-consumed on the next pass.
     *
     * ⚠ Then snap FORWARD to a word boundary. Stepping back by a fixed number
     * of characters lands wherever it lands, which is usually mid-word: a real
     * chunk began `"ng mga files na pinadala…"`, having sliced the Tagalog
     * "yung" in half. That fragment is then embedded as though it were a word,
     * and the damage is invisible — nothing errors, the chunk simply carries a
     * token that means nothing and dilutes the vector it belongs to. Taglish
     * makes it more likely, not less: the tokenizer already fragments these
     * words, so a bad split compounds.
     */
    const next = snapToWordStart(text, Math.max(start + step, end - effectiveOverlap));
    if (next <= start) break;
    start = next;
  }

  return chunks;
}

/**
 * Move an index forward to the start of the next word.
 *
 * Only ever forward, and never past the end — moving backwards could re-enter
 * text the previous chunk already ended with, and the loop's termination
 * depends on the cursor advancing.
 */
function snapToWordStart(text: string, index: number): number {
  if (index <= 0 || index >= text.length) return index;
  // Already at a boundary: the character before is whitespace.
  if (/\s/.test(text[index - 1]!)) return index;

  const whitespace = text.slice(index).search(/\s/);
  if (whitespace === -1) return text.length;

  let next = index + whitespace;
  while (next < text.length && /\s/.test(text[next]!)) next += 1;
  return next;
}

/**
 * Where to cut, searching backwards from the nominal end.
 *
 * Only the last quarter of the window is considered: a paragraph break 900
 * characters before the target would produce a 100-character chunk, which is
 * worse than cutting mid-sentence at 1,000.
 */
function findBoundary(text: string, start: number, hardEnd: number): number {
  const window = text.slice(start, hardEnd);
  const floor = Math.floor(window.length * 0.75);

  const paragraph = window.lastIndexOf('\n\n');
  if (paragraph >= floor) return start + paragraph + 2;

  const sentence = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('? '),
    window.lastIndexOf('! '),
    window.lastIndexOf('\n'),
  );
  if (sentence >= floor) return start + sentence + 1;

  const space = window.lastIndexOf(' ');
  if (space >= floor) return start + space + 1;

  return hardEnd;
}

/**
 * Collapse runs of blank lines and trailing spaces.
 *
 * Real mail is full of them — quoted replies, signature padding, HTML converted
 * to text. They consume tokens inside a 512-token window and contribute nothing
 * to meaning, so removing them is free capacity. Paragraph structure is kept,
 * because `findBoundary` cuts on it.
 */
function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

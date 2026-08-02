import type { SupabaseClient } from '@supabase/supabase-js';

import type { TimelineMessage } from '@/lib/timeline';

/**
 * Cross-channel search (US-4).
 *
 * Everything here is pure except `searchMessages`, which is one RPC call. The
 * query grammar, the highlight parser and the date maths are separated out
 * precisely so they can be tested without a database — the same reason
 * `normalize` is pure in every adapter.
 *
 * The SQL side is `packages/db/migrations/0007_message_search.sql`, and its
 * header carries the reasoning for the two decisions that shape this file:
 * why the text-search config is 'simple' (the corpus is Taglish), and why the
 * function takes two query modes instead of one.
 */

/** A result row: a timeline message plus why it matched. */
export interface SearchResult extends TimelineMessage {
  /** Matched fragments, delimited. Null when browsing with no query. */
  snippet: string | null;
  rank: number;
}

export interface SearchParams {
  /** Exactly what the person typed. */
  query: string;
  channelIds?: string[];
  contactIds?: string[];
  /** `YYYY-MM-DD`, read as a Manila calendar day. */
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * How a typed string becomes a tsquery.
 *
 * ── Two modes, and why ───────────────────────────────────────────────────────
 *
 * `to_tsquery` RAISES on malformed input — `'meeting &'` is a syntax error —
 * and this string comes from a text box. `websearch_to_tsquery` never raises
 * and understands `"quoted phrases"`, `or`, and `-exclusions`, but it cannot
 * express a prefix match. Under the 'simple' config there is no stemming, so
 * without prefix matching "deadlin" finds nothing and, worse, "deadline" does
 * not find "deadlines" — which is what someone typing into a search box
 * expects to work.
 *
 * So: anything using the advanced grammar goes to `websearch_to_tsquery`
 * verbatim. Everything else — the overwhelming majority — is stripped down to
 * word characters and rebuilt as `a & b & c:*`, giving typeahead behaviour on
 * the final term.
 *
 * ⚠ The strip is what makes `prefix` mode safe. After it, the string contains
 * only letters, digits and the separators this function inserted, so there is
 * nothing left that `to_tsquery` could read as an operator. **Never pass raw
 * user input with `prefix: true`.**
 *
 * `\p{L}` rather than `[a-z]`: the corpus is Taglish and Filipino text carries
 * ñ and accented vowels routinely. `[a-z0-9]` would split "señora" into two
 * tokens and quietly fail to match the word that is actually in the message.
 */
export function buildQuery(input: string): { q: string; prefix: boolean } | null {
  const raw = input.trim();
  if (!raw) return null;

  if (isAdvancedQuery(raw)) return { q: raw, prefix: false };

  const terms = raw
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  /*
   * Nothing survived the strip — "???" or "---". Handing this to the prefix
   * builder would produce an empty tsquery, and an empty tsquery matches
   * nothing but also carries no `q.ts is null`, so the function would silently
   * fall through to browsing and show every message as though it were a hit.
   * Sending it to websearch instead returns an honest zero results.
   */
  if (terms.length === 0) return { q: raw, prefix: false };

  const last = terms.length - 1;
  const q = terms.map((term, i) => (i === last ? `${term}:*` : term)).join(' & ');

  return { q, prefix: true };
}

/**
 * Does this query use the advanced grammar?
 *
 * Three triggers, each of which `websearch_to_tsquery` handles and the prefix
 * builder would destroy:
 *
 *   "quoted phrase"   the strip removes the quotes, turning a phrase search
 *                     into an AND of its words — a different question
 *   a or b            the strip leaves `or` as a literal lexeme to match
 *   -excluded         the strip removes the minus, turning an exclusion into
 *                     a requirement, which is the exact opposite
 *
 * `or` is matched as a standalone word, so "Doctor Or" is not read as an
 * operator, and case-insensitively because nobody types it upper-case.
 */
function isAdvancedQuery(raw: string): boolean {
  return raw.includes('"') || /(^|\s)-\S/.test(raw) || /(^|\s)or(\s|$)/i.test(raw);
}

/**
 * The sentinels `ts_headline` wraps matches in — STX and ETX.
 *
 * ⚠ Written as `\u` escapes deliberately. As literal control characters they are
 * invisible in every editor, so a stray edit could delete one and leave `''`
 * behind — and `indexOf('')` returns 0 for any string, which would make every
 * snippet parse as one empty match forever. They must stay identical to the
 * `chr(2)` / `chr(3)` in migration 0007.
 */
const HIGHLIGHT_START = '\u0002';
const HIGHLIGHT_END = '\u0003';

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split a snippet into plain and matched runs, for rendering as elements.
 *
 * ⚠ This is a security boundary, not a formatting convenience. `ts_headline`
 * defaults to wrapping matches in `<b>`, and rendering that means putting
 * message bodies — written by other people, never by us — through
 * `dangerouslySetInnerHTML`. Returning segments instead means the console
 * renders `<mark>{text}</mark>` as React elements, and React escapes the text.
 * There is no path from a message body to executable markup.
 *
 * Tolerates a malformed snippet rather than throwing: an unterminated run is
 * emitted as plain text. The delimiters are control characters that cannot
 * occur in real message text, but "cannot occur" is a claim about the corpus
 * and this function should not be the thing that breaks if it is ever wrong.
 */
export function highlightSegments(snippet: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  const push = (text: string, match: boolean) => {
    if (text) segments.push({ text, match });
  };

  let cursor = 0;

  while (cursor < snippet.length) {
    const start = snippet.indexOf(HIGHLIGHT_START, cursor);

    if (start === -1) {
      push(snippet.slice(cursor), false);
      break;
    }

    push(snippet.slice(cursor, start), false);

    const end = snippet.indexOf(HIGHLIGHT_END, start + 1);
    if (end === -1) {
      // Unterminated. Show the rest as text rather than losing it.
      push(snippet.slice(start + 1), false);
      break;
    }

    push(snippet.slice(start + 1, end), true);
    cursor = end + 1;
  }

  return segments;
}

/** The snippet's words with the highlight markers removed. */
export function segmentsText(segments: HighlightSegment[]): string {
  return segments.map((segment) => segment.text).join('');
}

/**
 * Is this snippet just repeating the row's headline?
 *
 * ── The row it was written for ───────────────────────────────────────────────
 *
 * A message with no subject takes its headline from its opening line
 * (`message-row.tsx` explains why at length: half this timeline is chat, and
 * rendering "No subject" there would make chat read as degraded email). A
 * short chat message therefore has a headline that *is* its whole body — and
 * `ts_headline` fragments that same body, so the row printed the identical
 * sentence twice, once large and once grey.
 *
 * Measured in the preview harness rather than guessed: of three fixture
 * results, the WhatsApp one had `headline === snippet` exactly.
 *
 * Whitespace is normalised before comparing because `ts_headline` collapses
 * newlines while `preview()` takes the first line — the same sentence arrives
 * spaced differently from the two paths.
 */
export function snippetRepeatsHeadline(
  headline: string | null,
  segments: HighlightSegment[] | null,
): boolean {
  if (!headline || !segments || segments.length === 0) return false;

  const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();
  const snippet = normalise(segmentsText(segments));

  return snippet.length > 0 && normalise(headline).includes(snippet);
}

/**
 * A `YYYY-MM-DD` calendar day in Manila, as the UTC instant it begins.
 *
 * The console groups the timeline by Manila day (lib/timeline.ts) and the date
 * filter has to agree with it, or "1 August" would exclude everything sent
 * after 4pm on the 1st — the timeline would disagree with its own filter for a
 * third of every day. PH is UTC+8 with no DST, so a fixed offset is correct
 * here rather than a shortcut.
 */
export function manilaDayStart(isoDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const date = new Date(`${isoDate}T00:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The same day's last instant, so `to` is inclusive of the day named. */
export function manilaDayEnd(isoDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const date = new Date(`${isoDate}T23:59:59.999+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** True when any filter is set — i.e. this is not the plain timeline. */
export function hasFilters(params: {
  channelIds?: string[];
  contactIds?: string[];
  from?: string | null;
  to?: string | null;
}): boolean {
  return Boolean(
    params.channelIds?.length ||
      params.contactIds?.length ||
      params.from ||
      params.to,
  );
}

interface SearchRow {
  id: string;
  direction: string;
  subject: string | null;
  body_text: string;
  sent_at: string;
  channel_id: string;
  sender_external_id: string | null;
  sender_display_name: string | null;
  snippet: string | null;
  rank: number;
}

/**
 * Run a search.
 *
 * Returns rather than throws, matching `fetchTimeline` — this result is handed
 * around as an unawaited promise so the shell can stream ahead of it, and a
 * rejection with no handler attached yet takes down the whole request.
 *
 * ⚠ No `owner_id` argument, and there is none in the function signature
 * either. RLS scopes the RPC to the caller because it is SECURITY INVOKER; a
 * tenant key passed from the client is the one thing this system never does.
 */
export async function searchMessages(
  supabase: SupabaseClient,
  params: SearchParams,
): Promise<{ results: SearchResult[]; truncated: boolean; error: string | null }> {
  const limit = params.limit ?? 50;
  const built = buildQuery(params.query);

  try {
    const { data, error } = await supabase.rpc('search_messages', {
      q: built?.q ?? null,
      prefix: built?.prefix ?? false,
      channel_ids: params.channelIds?.length ? params.channelIds : null,
      contact_ids: params.contactIds?.length ? params.contactIds : null,
      sent_from: params.from ? manilaDayStart(params.from) : null,
      sent_to: params.to ? manilaDayEnd(params.to) : null,
      // One more than we show, purely to learn whether more exist — the same
      // trick fetchTimeline uses, and for the same reason: an exact count
      // costs a scan to render one sentence.
      max_rows: limit + 1,
      skip: params.offset ?? 0,
    });

    if (error) return { results: [], truncated: false, error: error.message };

    const rows = (data ?? []) as SearchRow[];
    const truncated = rows.length > limit;

    const results = rows.slice(0, limit).map(
      (row): SearchResult => ({
        id: row.id,
        direction: row.direction,
        subject: row.subject,
        body_text: row.body_text,
        sent_at: row.sent_at,
        channel_id: row.channel_id,
        // Flattened by the function's RETURNS TABLE; re-nested here so a result
        // row is structurally a TimelineMessage and `MessageRow` renders it
        // with no second code path.
        sender: row.sender_external_id
          ? {
              external_id: row.sender_external_id,
              display_name: row.sender_display_name,
            }
          : null,
        snippet: row.snippet,
        rank: row.rank,
      }),
    );

    return { results, truncated, error: null };
  } catch (cause) {
    return {
      results: [],
      truncated: false,
      // Never include the payload: this call returns real message bodies.
      // docs/02-ARCHITECTURE.md §6.
      error: cause instanceof Error ? cause.message : 'Search is unavailable.',
    };
  }
}

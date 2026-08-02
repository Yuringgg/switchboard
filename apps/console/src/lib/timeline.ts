import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The timeline query.
 *
 * ⚠ NO DIRECTION FILTER. Phase 1's done-condition is "send yourself an email
 * and it appears", and a self-sent message is `outbound` — direction comes from
 * the From address, and you are the sender.
 *
 * R12 frames the product around messages received from other people, which
 * makes `.eq('direction', 'inbound')` look obviously correct. It would hide the
 * one message the demo depends on, and the pipeline would read as broken while
 * working perfectly. Distinguish the two visually; never filter.
 */

export interface TimelineMessage {
  id: string;
  direction: string;
  subject: string | null;
  body_text: string;
  sent_at: string;
  channel_id: string;
  sender: { external_id: string; display_name: string | null } | null;
  /**
   * The AI summary, when one exists (Phase 4A, ADR-015).
   *
   * Null is the ordinary case, not a failure: short messages are deliberately
   * not summarised, and a Groq outage degrades to null rather than to no mail.
   * `model` travels with the text so the console can say which model wrote it —
   * ADR-006's reason for recording it per row.
   */
  summary?: { text: string; model: string } | null;
}

export interface TimelineDay {
  /** ISO date, `YYYY-MM-DD`, in Asia/Manila. */
  date: string;
  messages: TimelineMessage[];
}

/** PH is UTC+8 with no DST, so a fixed zone is correct rather than a shortcut. */
const TIMEZONE = 'Asia/Manila';

/**
 * Group by local day.
 *
 * Grouping on the UTC date would put anything sent after 4pm Manila under
 * "tomorrow" — the timeline would silently disagree with the clock on the
 * user's wall for a third of every day.
 */
export function groupByDay(messages: TimelineMessage[]): TimelineDay[] {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const days = new Map<string, TimelineMessage[]>();

  for (const message of messages) {
    const date = formatter.format(new Date(message.sent_at));
    const bucket = days.get(date);
    if (bucket) bucket.push(message);
    else days.set(date, [message]);
  }

  return [...days.entries()].map(([date, msgs]) => ({ date, messages: msgs }));
}

/**
 * Returns rather than throws, and never rejects — the page starts this without
 * awaiting it, so a rejection with no handler attached yet would take down the
 * whole request rather than showing an error in the message column.
 */
export async function fetchTimeline(
  supabase: SupabaseClient,
  limit = 50,
): Promise<{ messages: TimelineMessage[]; truncated: boolean; error: string | null }> {
  try {
    // RLS scopes this to the signed-in user, so there is no owner_id filter —
    // adding one would imply the policy might not be doing its job.
    //
    // The join to contact_identities is what turns a sender_identity uuid into a
    // name to show. It is a left join: sender_identity is nullable, and a message
    // whose sender row was removed should still appear.
    const { data, error } = await supabase
      .from('messages')
      .select(
        'id, direction, subject, body_text, sent_at, channel_id, ' +
          'sender:contact_identities!messages_sender_identity_fkey(external_id, display_name), ' +
          // Phase 4A. One row at most — migration 0008's partial unique index
          // guarantees it — but PostgREST types every embed as an array.
          'summary:extractions(payload, model, kind)',
      )
      /*
       * ⚠ Filters the EMBEDDED rows, not the parent rows.
       *
       * That distinction is the whole risk here: PostgREST turns an embedded
       * filter into an INNER join when written `extractions!inner(...)`, and
       * under an inner join every message *without* a summary would vanish from
       * the timeline — which is most of them, since short messages are
       * deliberately never summarised. The console would look like it had lost
       * mail. Verified against the live database before this shipped: six rows
       * requested, six returned, three with a summary and three without.
       *
       * The filter is needed at all because Phase 5 writes other `kind`s to the
       * same table (ADR-006), and a meeting extraction must not render where a
       * summary belongs.
       */
      .eq('summary.kind', 'summary')
      .order('sent_at', { ascending: false })
      /*
       * One more than we intend to show, purely to learn whether more exist.
       *
       * The list was capped at 50 with nothing on screen saying so, which on a
       * console whose promise is "every message, every channel, in order" is
       * the one kind of wrong it must not be — a message you have received and
       * cannot see, with no indication it is being withheld. Asking for 51 and
       * discarding the extra costs one row and no second query; an exact
       * `count` would cost a full scan on every load to render one sentence.
       */
      .limit(limit + 1);

    if (error) return { messages: [], truncated: false, error: error.message };

    const rows = data ?? [];
    const truncated = rows.length > limit;

    // PostgREST returns an embedded one-to-one as an object, but types it loosely.
    const messages = rows.slice(0, limit).map((row) => {
      const raw = row as unknown as Omit<TimelineMessage, 'sender' | 'summary'> & {
        sender: TimelineMessage['sender'] | TimelineMessage['sender'][] | null;
        summary:
          | { payload: { text?: string } | null; model: string | null }[]
          | { payload: { text?: string } | null; model: string | null }
          | null;
      };

      // `extractions` is a one-to-MANY relationship in the schema, so this
      // arrives as an array however many rows are in it. At most one survives
      // the kind filter; taking [0] is not a guess.
      const summaryRow = Array.isArray(raw.summary) ? raw.summary[0] : raw.summary;
      const summaryText = summaryRow?.payload?.text;

      return {
        ...raw,
        sender: Array.isArray(raw.sender) ? (raw.sender[0] ?? null) : raw.sender,
        summary: summaryText
          ? { text: summaryText, model: summaryRow?.model ?? 'unknown' }
          : null,
      } satisfies TimelineMessage;
    });

    return { messages, truncated, error: null };
  } catch (cause) {
    return {
      messages: [],
      truncated: false,
      // Never include the payload in an error string: this query returns real
      // message bodies. docs/02-ARCHITECTURE.md §6.
      error: cause instanceof Error ? cause.message : 'Messages are unavailable.',
    };
  }
}

/**
 * One message, in full, by id — the citation target (US-6) and the record view.
 *
 * ── Why this exists as its own query ────────────────────────────────────────
 *
 * `fetchTimeline` caps the list at 50 and every body at `BODY_LIMIT`, because a
 * list serialises every row into the page whether or not it is opened. Neither
 * cap is right for a single message someone asked to see: this reads the whole
 * body, as the note on `BODY_LIMIT` anticipated — **it bounds the list, not the
 * record.**
 *
 * ⚠ A message that is not yours and a message that does not exist return the
 * SAME result: null. That is RLS doing its job, and it is the correct behaviour
 * rather than a limitation — distinguishing them would confirm to a stranger
 * that a given id exists in someone else's mailbox. The caller renders
 * `notFound()` for both.
 *
 * There is no `owner_id` filter here for the same reason there is none anywhere
 * else: adding one would imply the policy might not be doing its job.
 */
export async function fetchMessage(
  supabase: SupabaseClient,
  id: string,
): Promise<{ message: TimelineMessage | null; error: string | null }> {
  // Reject anything that is not a uuid before it reaches Postgres: PostgREST
  // answers a malformed uuid with a 400 whose message names the column and the
  // type, which is a worse thing to render than "not found".
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { message: null, error: null };
  }

  try {
    const { data, error } = await supabase
      .from('messages')
      .select(
        'id, direction, subject, body_text, sent_at, channel_id, ' +
          'sender:contact_identities!messages_sender_identity_fkey(external_id, display_name), ' +
          'summary:extractions(payload, model, kind)',
      )
      .eq('id', id)
      // ⚠ Filters the EMBEDDED rows, not the parent — the same trap as
      // `fetchTimeline`. `extractions!inner` would 404 every message without a
      // summary, which is most of them.
      .eq('summary.kind', 'summary')
      // `maybeSingle`, not `single`: no row is an ordinary outcome here (a bad
      // id, or someone else's message), and `single` reports it as an error.
      .maybeSingle();

    if (error) return { message: null, error: error.message };
    if (!data) return { message: null, error: null };

    const raw = data as unknown as Omit<TimelineMessage, 'sender' | 'summary'> & {
      sender: TimelineMessage['sender'] | TimelineMessage['sender'][] | null;
      summary:
        | { payload: { text?: string } | null; model: string | null }[]
        | { payload: { text?: string } | null; model: string | null }
        | null;
    };

    const summaryRow = Array.isArray(raw.summary) ? raw.summary[0] : raw.summary;
    const summaryText = summaryRow?.payload?.text;

    return {
      message: {
        ...raw,
        sender: Array.isArray(raw.sender) ? (raw.sender[0] ?? null) : raw.sender,
        summary: summaryText
          ? { text: summaryText, model: summaryRow?.model ?? 'unknown' }
          : null,
      },
      error: null,
    };
  } catch (cause) {
    return {
      message: null,
      // Never include the payload in an error string: this query returns a real
      // message body. docs/02-ARCHITECTURE.md §6.
      error: cause instanceof Error ? cause.message : 'That message is unavailable.',
    };
  }
}

/**
 * Label for the "you have unseen mail" pill.
 *
 * Pure and separate from the component so the plural boundary is a test rather
 * than something noticed in a screenshot. "1 new messages" in front of a
 * mentor is a small thing that reads as an unfinished product.
 */
export function newMessagesLabel(count: number): string {
  return count === 1 ? '1 new message' : `${count} new messages`;
}

/** First line of the body, for a one-line preview. */
export function preview(bodyText: string, maxLength = 140): string {
  const firstLine = bodyText.split('\n').find((line) => line.trim().length > 0) ?? '';
  const trimmed = firstLine.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

/**
 * The one or two characters that stand for a sender.
 *
 * ── Why the fallbacks are not an afterthought ────────────────────────────────
 *
 * `display_name` is nullable and frequently null — Gmail gives a name only
 * when the sender set one, and WhatsApp identities are phone numbers. So the
 * interesting cases are the ones without a name, and each needs its own rule:
 *
 * **Email** uses the local part, because everything after the @ is shared by
 * everyone at that company — a column of "V" for vendor.example identifies
 * nobody.
 *
 * **Phone numbers use the LAST two digits**, which is the opposite of every
 * other branch and is the whole reason this function exists rather than a
 * `.slice(0, 2)` at the call site. The corpus is Philippine: every number
 * starts +63, and most mobiles continue 9xx — so leading characters make every
 * contact identical. The tail is the part that differs.
 *
 * A name of two or more words takes the first and *last* word, so "Maria
 * Santos" and "Maria dela Cruz" do not both read "MD".
 */
export function initials(
  displayName: string | null,
  externalId: string | null,
): string {
  const name = displayName?.trim();

  if (name) {
    const words = name.split(/\s+/).filter(Boolean);

    if (words.length >= 2) {
      return (words[0]![0]! + words.at(-1)![0]!).toUpperCase();
    }
    return words[0]!.slice(0, 2).toUpperCase();
  }

  const id = externalId?.trim();
  if (!id) return '?';

  // An address: everything before the @ is the part that identifies a person.
  const local = id.includes('@') ? id.split('@')[0]! : id;

  const letters = local.replace(/[^a-z0-9]/gi, '');
  if (!letters) return '?';

  // No letters at all means a phone number. Take the tail, not the head.
  return /[a-z]/i.test(letters)
    ? letters.slice(0, 2).toUpperCase()
    : letters.slice(-2);
}

/**
 * How a message's age is phrased.
 *
 * ── Why not just the clock time ──────────────────────────────────────────────
 *
 * This is a live board. For something that arrived in the last hour the useful
 * question is "how long ago", and "14m ago" answers it at a glance where 18:31
 * makes you do arithmetic against a clock you have to go and find. Past an
 * hour the reverse is true — "4h ago" is vaguer than 14:12, and by tomorrow it
 * is useless — so the clock takes back over, and the day heading above the row
 * already carries the date.
 *
 * `now === 0` is the not-yet-mounted sentinel from `lib/now.ts`; the absolute
 * time is the correct thing to render on the server either way.
 *
 * A negative age falls into the first branch and reads "just now", which is
 * deliberate: clock skew between the sender's machine and ours is ordinary,
 * and without that catch a message stamped 40 seconds ahead reads "-1m ago".
 */
export function formatAge(sentAt: string, now: number): string | null {
  if (now === 0) return null;

  const seconds = Math.round((now - new Date(sentAt).getTime()) / 1000);

  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1m ago';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;

  return null;
}

/**
 * How much of a body an opened row will render.
 *
 * A ceiling exists because the timeline is server-rendered: every body in the
 * page is serialized into the HTML whether or not its row is open. Fifty
 * ordinary emails is fine; fifty newsletters is a megabyte of markup for text
 * nobody asked to see. 4,000 characters is roughly 700 words — past the point
 * where anyone reads on without scrolling, and past the end of essentially
 * every real message in this corpus.
 *
 * When Phase 3 adds a message route, that route reads the whole body and this
 * ceiling stays where it is: it bounds the *list*, not the record.
 */
export const BODY_LIMIT = 4000;

/**
 * Returns the truncation as a flag rather than appending an ellipsis, so the
 * UI can say "showing the first 4,000 characters" outright. A trailing "…" is
 * the same claim made too quietly to act on — the reader cannot tell it from
 * an ellipsis the sender typed.
 */
export function bodyForDisplay(bodyText: string): {
  text: string;
  truncated: boolean;
  limit: number;
} {
  const text = bodyText.trim();

  return text.length > BODY_LIMIT
    ? { text: text.slice(0, BODY_LIMIT), truncated: true, limit: BODY_LIMIT }
    : { text, truncated: false, limit: BODY_LIMIT };
}

/**
 * Which messages should name their channel in words.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Channel identity used to be carried by a 7px coloured dot and nothing else,
 * and the two colours are Gmail red against WhatsApp green — the single worst
 * pair for red/green colour blindness, which is roughly 8% of men. "Which line
 * did this come in on" is the one question a cross-channel console exists to
 * answer, so answering it in a way ~1 reader in 12 cannot read is not a
 * detail. WCAG 1.4.1: colour must never be the only visual means of conveying
 * information.
 *
 * ── Why on CHANGE rather than on every row ───────────────────────────────────
 *
 * A badge on all fifty rows is noise when forty-nine of them say the same
 * thing, and noise is what gets skimmed past — so it would fail in practice
 * even where it passes on paper. A ledger prints a column value only when it
 * changes, and the same rule is *more* informative here: in a merged timeline
 * the moment the line switches is itself the news. One connected channel
 * yields exactly one label, at the top, meaning "everything below is Gmail".
 * Two interleaved channels yield a label on almost every row, which is
 * precisely when you need one.
 *
 * Pure, and computed over the whole ordered list rather than per day — a day
 * boundary is not a channel change, and re-announcing at every midnight would
 * break the "it changed" contract the device depends on.
 */
export function channelChangePoints(
  messages: TimelineMessage[],
  channelTypeById: Map<string, string>,
): Set<string> {
  const marked = new Set<string>();
  let previous: string | undefined;

  for (const message of messages) {
    const type = channelTypeById.get(message.channel_id);
    if (type !== previous) {
      marked.add(message.id);
      previous = type;
    }
  }

  return marked;
}

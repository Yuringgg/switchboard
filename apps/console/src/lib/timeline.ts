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
): Promise<{ messages: TimelineMessage[]; error: string | null }> {
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
        'id, direction, subject, body_text, sent_at, channel_id, sender:contact_identities!messages_sender_identity_fkey(external_id, display_name)',
      )
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error) return { messages: [], error: error.message };

    // PostgREST returns an embedded one-to-one as an object, but types it loosely.
    const messages = (data ?? []).map((row) => {
      const raw = row as unknown as Omit<TimelineMessage, 'sender'> & {
        sender: TimelineMessage['sender'] | TimelineMessage['sender'][] | null;
      };
      return {
        ...raw,
        sender: Array.isArray(raw.sender) ? (raw.sender[0] ?? null) : raw.sender,
      } satisfies TimelineMessage;
    });

    return { messages, error: null };
  } catch (cause) {
    return {
      messages: [],
      // Never include the payload in an error string: this query returns real
      // message bodies. docs/02-ARCHITECTURE.md §6.
      error: cause instanceof Error ? cause.message : 'Messages are unavailable.',
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

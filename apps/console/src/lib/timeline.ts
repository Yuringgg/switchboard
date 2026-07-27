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

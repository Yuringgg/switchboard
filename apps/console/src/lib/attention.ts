import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * "Needs attention" (US-9) — the extraction queue, read for a human.
 *
 * ── ⚠ Why this reads `extractions` and not the assistant ─────────────────────
 *
 * *"Summarise what needs my attention"* was a known gap of the assistant for a
 * reason ADR-017 measured rather than guessed: the eight messages semantic
 * search returned for it were a Deepgram welcome, a Coursera announcement, a
 * Huawei promotion, two ScreenPal mails, a Nike drop and a job alert. **None of
 * the real problems was in context at all**, because *importance is not a
 * direction in embedding space* — the nearest neighbours to "needs my
 * attention" are prose that sounds urgent.
 *
 * No prompt wording reaches that. This screen is the fix: the worker has
 * already decided, one message at a time, what is a commitment, a meeting, an
 * action item or a question, and this reads those rows directly. Structure,
 * not similarity.
 *
 * ⚠ Every row here is a **proposal**, never a fact the system has acted on
 * (ADR-010). Nothing on this screen has touched a calendar.
 */

export const ATTENTION_KINDS = ['commitment', 'meeting', 'action_item', 'question'] as const;

export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/**
 * The board's three columns (Ms. Maria, 2026-08-05 — *"not started, in
 * progress, done… similar to Trello"*).
 *
 * ⚠ Ordered, and the order is the contract. `moveTo` derives the neighbouring
 * columns from this array's indices, so reordering it silently changes which
 * way the arrows on every card point. Migration 0012's CHECK constraint holds
 * the same three values; the two must be changed together or an update fails at
 * the database with an error nobody expected.
 */
export const ATTENTION_STATUSES = ['not_started', 'in_progress', 'done'] as const;

export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];

/** How a column is named on screen. */
export const STATUS_LABEL: Record<AttentionStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
};

export function isAttentionStatus(value: unknown): value is AttentionStatus {
  return (
    typeof value === 'string' &&
    (ATTENTION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * What moving a card reports back.
 *
 * ⚠ Lives here rather than beside the action that returns it, because
 * `lib/attention-actions.ts` is a `'use server'` module and those may export
 * only async functions — a plain `const` in one is a build error.
 * `lib/auth-constants.ts` exists for the same reason and carries the same note.
 */
export interface MoveResult {
  ok: boolean;
  /**
   * Null on success. The board re-renders and the card is visibly somewhere
   * else, which is the feedback — only a failure needs words, and it needs them
   * badly: a card that silently fails to move is indistinguishable from one
   * that had nowhere to go.
   */
  error: string | null;
}

/** A card's controls before anything has been tried. */
export const NO_MOVE_YET: MoveResult = { ok: true, error: null };

/** The `extractions.payload` shape the worker writes. See packages/ai/src/extract.ts. */
export interface AttentionPayload {
  title?: string;
  quote?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  due_at?: string | null;
  owed_by?: 'me' | 'them' | null;
  participants?: string[];
  location?: string | null;
}

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  /**
   * Which column this card sits in. Migration 0012.
   *
   * ⚠ Set only by a person. The worker writes proposals and stops — the same
   * rule ADR-010 fixes for calendar events, applied to the board: nothing in
   * the pipeline may decide on somebody's behalf that a commitment is handled.
   */
  status: AttentionStatus;
  /** When a person last moved it. Null means never — see migration 0012. */
  statusChangedAt: string | null;
  title: string;
  /** The verbatim sentence it came from. Shown, never hidden — see below. */
  quote: string;
  startsAt: string | null;
  dueAt: string | null;
  location: string | null;
  participants: string[];
  confidence: number | null;
  model: string;
  /** Set once the user has confirmed a meeting onto their calendar (ADR-010). */
  calendarEventId: string | null;
  confirmedAt: string | null;
  message: {
    id: string;
    subject: string | null;
    sentAt: string;
    channelId: string;
    senderName: string | null;
    senderRef: string | null;
  };
}

/**
 * The instant an item is "about", for ordering and for display.
 *
 * A meeting is about when it starts; a commitment or an action item is about
 * when it is due. Null for anything with no stated time, which is common and is
 * not a defect — the message simply did not say.
 */
export function itemWhen(item: AttentionItem): string | null {
  return item.startsAt ?? item.dueAt;
}

/**
 * Sort for a person deciding what to do next.
 *
 * ── Why not just newest first ────────────────────────────────────────────────
 *
 * A queue ordered by when the *message arrived* buries a meeting that starts in
 * an hour under six newsletters that arrived since. What a person needs is
 * ordering by **when the thing happens**, and there are three groups:
 *
 *   1. **Overdue / already passed**, soonest-missed first. These are the ones
 *      with a real cost, and they must not be below tomorrow's lunch.
 *   2. **Upcoming**, soonest first. The obvious case.
 *   3. **No stated time** — most action items and questions. Newest message
 *      first, because with no deadline the only useful signal is recency.
 *
 * ⚠ Confidence is a tiebreak and nothing more. It is the model's self-report,
 * not a calibrated probability, and sorting primarily by it would put a
 * confidently-extracted newsletter above a hedged real meeting. Filtering by it
 * would be ADR-016's mistake in a new costume — a threshold on a number that
 * does not separate the classes.
 */
export function sortForAttention(items: AttentionItem[], now: Date): AttentionItem[] {
  const nowMs = now.getTime();

  const rank = (item: AttentionItem): number => {
    const when = itemWhen(item);
    if (when === null) return 3;
    return new Date(when).getTime() < nowMs ? 1 : 2;
  };

  return [...items].sort((a, b) => {
    const groupA = rank(a);
    const groupB = rank(b);
    if (groupA !== groupB) return groupA - groupB;

    const whenA = itemWhen(a);
    const whenB = itemWhen(b);

    if (whenA !== null && whenB !== null) {
      const diff = new Date(whenA).getTime() - new Date(whenB).getTime();
      if (diff !== 0) return diff;
    }

    // Untimed, or the same instant: newest message first.
    const byMessage =
      new Date(b.message.sentAt).getTime() - new Date(a.message.sentAt).getTime();
    if (byMessage !== 0) return byMessage;

    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}

interface ExtractionRow {
  id: string;
  kind: string;
  status: string;
  status_changed_at: string | null;
  payload: AttentionPayload | null;
  confidence: number | null;
  model: string;
  calendar_event_id: string | null;
  confirmed_at: string | null;
  message:
    | {
        id: string;
        subject: string | null;
        sent_at: string;
        channel_id: string;
        sender:
          | { display_name: string | null; external_id: string }
          | { display_name: string | null; external_id: string }[]
          | null;
      }
    | {
        id: string;
        subject: string | null;
        sent_at: string;
        channel_id: string;
        sender:
          | { display_name: string | null; external_id: string }
          | { display_name: string | null; external_id: string }[]
          | null;
      }[]
    | null;
}

/**
 * Read the queue.
 *
 * ⚠ RLS scopes this to the signed-in user, so there is no `owner_id` filter —
 * adding one would imply the policy might not be doing its job. No RPC and no
 * `service_role`: this is an ordinary table read through the user's session,
 * which is the narrowest thing that works (ADR-013).
 *
 * Returns rather than throws, like every other fetcher here, because the result
 * is handed around as an unawaited promise and a rejection with no handler yet
 * attached takes down the whole request.
 */
export async function fetchAttention(
  supabase: SupabaseClient,
  { limit = 100, messageId }: { limit?: number; messageId?: string } = {},
): Promise<{ items: AttentionItem[]; error: string | null }> {
  try {
    let query = supabase
      .from('extractions')
      .select(
        'id, kind, status, status_changed_at, payload, confidence, model, ' +
          'calendar_event_id, confirmed_at, ' +
          'message:messages!extractions_message_id_fkey(' +
          'id, subject, sent_at, channel_id, ' +
          'sender:contact_identities!messages_sender_identity_fkey(display_name, external_id))',
      )
      /*
       * ⚠ `in`, not `neq('kind', 'summary')`.
       *
       * They are equivalent today and they stop being equivalent the moment
       * migration 0008's CHECK is widened again — at which point `neq` silently
       * starts rendering a new kind on this screen, in a layout that was never
       * designed for it. Naming what belongs here is the version that fails
       * loudly, by showing nothing, rather than quietly, by showing the wrong
       * thing.
       */
      .in('kind', [...ATTENTION_KINDS])
      // Newest extraction first as the base order; `sortForAttention` does the
      // real work in TypeScript, where "overdue" can be expressed against the
      // reader's own clock rather than the database's.
      .order('created_at', { ascending: false })
      .limit(limit);

    // ⚠ Filters the PARENT rows, not the embed — `message_id` is a column on
    // `extractions`, so this is an ordinary predicate and not the embedded-filter
    // trap `fetchTimeline` documents.
    if (messageId) query = query.eq('message_id', messageId);

    const { data, error } = await query;

    if (error) return { items: [], error: error.message };

    const items: AttentionItem[] = [];

    for (const row of (data ?? []) as unknown as ExtractionRow[]) {
      // PostgREST types a to-one embed loosely; it can arrive either shape.
      const message = Array.isArray(row.message) ? row.message[0] : row.message;
      // A row whose message is gone is not renderable, and `on delete cascade`
      // means it should not exist. Skipped rather than rendered half-empty.
      if (!message) continue;

      const sender = Array.isArray(message.sender) ? message.sender[0] : message.sender;
      const payload = row.payload ?? {};

      /*
       * ⚠ A row with no title or no quote is DROPPED, not rendered.
       *
       * `validateExtractions` guarantees both, so this cannot happen from the
       * current writer — but this table is the one place in the system holding
       * model output, and the quote is what lets a reader check the claim. An
       * item with nothing to check against is exactly the "trust me" card
       * ADR-010 exists to prevent, so it does not get to appear.
       */
      if (!payload.title || !payload.quote) continue;

      items.push({
        id: row.id,
        kind: row.kind as AttentionKind,
        /*
         * ⚠ Defaulted rather than cast. The column is `not null` with a CHECK,
         * so an unrecognised value should be impossible — but this is the field
         * that decides which column a card renders in, and a value outside the
         * three would put the card in NO column, i.e. drop a real commitment
         * off the board with nothing logged. Falling back to "not started" is
         * the failure that keeps the work visible.
         */
        status: isAttentionStatus(row.status) ? row.status : 'not_started',
        statusChangedAt: row.status_changed_at,
        title: payload.title,
        quote: payload.quote,
        startsAt: payload.starts_at ?? null,
        dueAt: payload.due_at ?? null,
        location: payload.location ?? null,
        participants: payload.participants ?? [],
        confidence: row.confidence,
        model: row.model,
        calendarEventId: row.calendar_event_id,
        confirmedAt: row.confirmed_at,
        message: {
          id: message.id,
          subject: message.subject,
          sentAt: message.sent_at,
          channelId: message.channel_id,
          senderName: sender?.display_name ?? null,
          senderRef: sender?.external_id ?? null,
        },
      });
    }

    return { items, error: null };
  } catch (cause) {
    return {
      items: [],
      // ⚠ Never include the payload in an error string: these rows quote real
      // message bodies. docs/02-ARCHITECTURE.md §6.
      error: cause instanceof Error ? cause.message : 'The attention queue is unavailable.',
    };
  }
}

/**
 * Extractions for one message, for the detail route.
 *
 * Same query, narrowed. Kept beside `fetchAttention` so the payload-to-item
 * mapping — including the drop rules above — has exactly one implementation.
 */
export async function fetchMessageExtractions(
  supabase: SupabaseClient,
  messageId: string,
): Promise<{ items: AttentionItem[]; error: string | null }> {
  // ⚠ Bounded by `MAX_EXTRACTIONS_PER_MESSAGE`, so a limit of 20 cannot hide a
  // proposal — and if it ever could, hiding one on the screen where a person
  // confirms them is the wrong failure. The bound is stated in
  // `packages/ai/src/extract.ts`.
  return fetchAttention(supabase, { limit: 20, messageId });
}

/** How a kind is named on screen. */
export const KIND_LABEL: Record<AttentionKind, string> = {
  meeting: 'Meeting',
  commitment: 'Commitment',
  action_item: 'Action',
  question: 'Question',
};

/**
 * The board, as three ordered columns.
 *
 * ── ⚠ Two different sorts, on purpose ────────────────────────────────────────
 *
 * `sortForAttention` answers *"what should I do next?"* — overdue first,
 * soonest-missed at the top, then upcoming, then undated by recency. That is
 * exactly right for **Not started** and **In progress**, which are both queues
 * of outstanding work, and it is the ordering this screen was built on.
 *
 * It is wrong for **Done**. A finished card has no useful deadline any more:
 * everything in that column is "overdue" the moment its date passes, so
 * `sortForAttention` fills it with a stack of red-flagged items sorted by how
 * badly they were missed — for work that was, in fact, completed. What a person
 * wants from a Done column is *what did I just clear*, so it sorts by when the
 * card was moved, newest first. `status_changed_at` exists for this and nothing
 * else (migration 0012).
 *
 * ⚠ A null `statusChangedAt` in Done should not be possible — nothing reaches
 * that column without being moved — but it sorts LAST rather than first if it
 * ever happens, because an unknown completion time is not evidence of a recent
 * one.
 */
export function groupForBoard(
  items: AttentionItem[],
  now: Date,
): { status: AttentionStatus; label: string; items: AttentionItem[] }[] {
  return ATTENTION_STATUSES.map((status) => {
    const inColumn = items.filter((item) => item.status === status);

    return {
      status,
      label: STATUS_LABEL[status],
      items:
        status === 'done'
          ? [...inColumn].sort(
              (a, b) =>
                (b.statusChangedAt ? new Date(b.statusChangedAt).getTime() : 0) -
                (a.statusChangedAt ? new Date(a.statusChangedAt).getTime() : 0),
            )
          : sortForAttention(inColumn, now),
    };
  });
}

/**
 * Where a card can move to from where it is.
 *
 * Derived from `ATTENTION_STATUSES`' order rather than hard-coded, so the two
 * cannot drift. Returns null at each end, which is what disables the arrow —
 * a control that is present and does nothing is worse than one that is
 * visibly unavailable.
 *
 * Deliberately one step at a time, in both directions. A jump straight from
 * Not started to Done is one click away from marking something finished that
 * was never looked at, and "back" has to exist because the commonest reason to
 * move a card is realising you moved the wrong one.
 */
export function neighbourStatus(
  status: AttentionStatus,
  direction: -1 | 1,
): AttentionStatus | null {
  const index = ATTENTION_STATUSES.indexOf(status) + direction;
  return ATTENTION_STATUSES[index] ?? null;
}

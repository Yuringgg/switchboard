import type { SupabaseClient } from '@supabase/supabase-js';

import { ATTENTION_KINDS, type AttentionKind, type AttentionStatus } from './attention';

/**
 * The per-person brief on `/contacts/[id]` — who somebody is, what is open
 * with them, and where they talk to you.
 *
 * Ms. Maria's "Meeting Brief Protocols" research task asks for **company names,
 * relationship categories (client / partner / investor / broker) and
 * decision-maker roles**. Phase 7B extracts those as `affiliation` rows
 * (migration 0017); this is the roll-up `docs/04-ROADMAP.md` names as the next
 * build, and the one piece of Phase 7 that needs no Recall, no Azure and no key.
 *
 * ── ⚠ The rule this file is built around: a fact carries its sentence ───────
 *
 * Migration 0017 chose extractions over a `contacts.relationship` column
 * precisely so that "client" can always say WHY. A roll-up that printed
 * "Client" with no evidence would throw that away at the last step. So every
 * fact here keeps the extraction it came from — its verbatim quote and its
 * message — and the screen shows both.
 *
 * ── ⚠ And a fact only lands on a person if the extraction NAMES them ────────
 *
 * The first design attributed affiliation rows to whoever SENT the message.
 * Checked against the live database before building it (2026-09-24): the one
 * affiliation row in production came from a message the reader SENT, and its
 * title names somebody else. Attributed by sender, that person's company would
 * have been pinned on the reader's own contact — a confident, wrong fact about
 * a real person, which is exactly what the `relationship` enum's own note says
 * is worse than a null.
 *
 * So the brief reads every conversation the contact takes part in (both
 * directions, as `fetchContactDetail` does), and rolls a row up into their facts
 * only when its title contains one of their names. Rows that do not are still
 * shown — as "also mentioned in these conversations" — so nothing the model
 * found is hidden, and nothing is attributed on a guess.
 */

export const AFFILIATION_KIND = 'affiliation';

export type Relationship = 'client' | 'partner' | 'investor' | 'broker';

export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  client: 'Client',
  partner: 'Partner',
  investor: 'Investor',
  broker: 'Broker',
};

/** One extraction row as the brief needs it. No message body, ever. */
export interface BriefRow {
  id: string;
  kind: string;
  status: AttentionStatus | null;
  model: string;
  messageId: string;
  sentAt: string;
  channelId: string;
  payload: {
    title?: string;
    quote?: string;
    starts_at?: string | null;
    due_at?: string | null;
    owed_by?: 'me' | 'them' | null;
    company?: string | null;
    relationship?: Relationship | null;
    role?: string | null;
    decision_maker?: boolean | null;
  };
}

/** Where a fact came from — enough to show the sentence and link the message. */
export interface FactSource {
  extractionId: string;
  messageId: string;
  sentAt: string;
  quote: string;
  title: string;
}

export interface Fact<T> {
  value: T;
  source: FactSource;
}

export interface Affiliation {
  source: FactSource;
  company: string | null;
  role: string | null;
  relationship: Relationship | null;
  decisionMaker: boolean | null;
}

export interface OpenItem {
  id: string;
  kind: AttentionKind;
  status: AttentionStatus;
  title: string;
  quote: string;
  /** starts_at for a meeting, due_at for anything else. */
  when: string | null;
  owedBy: 'me' | 'them' | null;
  messageId: string;
  channelId: string;
}

export interface ChannelLine {
  channelId: string;
  count: number;
  lastAt: string;
}

export interface ContactBrief {
  facts: {
    company: Fact<string> | null;
    role: Fact<string> | null;
    relationship: Fact<Relationship> | null;
    decisionMaker: Fact<boolean> | null;
  };
  /** Rows about this person, newest first — the evidence behind `facts`. */
  about: Affiliation[];
  /** Rows in their conversations that name somebody else. Shown, not rolled up. */
  others: Affiliation[];
  open: OpenItem[];
  lines: ChannelLine[];
  /** Messages in their conversations the extraction pass has not read yet. */
  unread: number;
  /** Messages in their conversations, read or not. */
  total: number;
  /** Distinct models that wrote the rows shown — named on screen, never "AI". */
  models: string[];
}

/**
 * The words that identify this person in an extraction's title.
 *
 * Every word of three letters or more from their display name and the display
 * names of their handles, lower-cased. A handle that is an address or a number
 * contributes nothing — `+63 917…` names nobody — which is correct: a contact
 * known only by a number gets no facts rolled up, and every row is shown as
 * "also mentioned" instead.
 *
 * ⚠ Three letters, not two, so "Ma" and "Jo" do not match half the corpus.
 */
export function nameTokens(names: (string | null | undefined)[]): string[] {
  const tokens = new Set<string>();
  for (const name of names) {
    for (const word of (name ?? '').toLowerCase().split(/[^\p{L}]+/u)) {
      if (word.length >= 3) tokens.add(word);
    }
  }
  return [...tokens];
}

/** Does this title name the person? Whole words only — "Ana" is not in "Banana". */
export function titleNames(title: string, tokens: string[]): boolean {
  const words = new Set(title.toLowerCase().split(/[^\p{L}]+/u));
  return tokens.some((token) => words.has(token));
}

function toAffiliation(row: BriefRow): Affiliation | null {
  const title = row.payload.title?.trim();
  const quote = row.payload.quote?.trim();
  // `validateExtractions` guarantees both. A row without them cannot show its
  // evidence, so it cannot be shown at all — the same rule `fetchAttention` has.
  if (!title || !quote) return null;

  return {
    source: {
      extractionId: row.id,
      messageId: row.messageId,
      sentAt: row.sentAt,
      quote,
      title,
    },
    company: row.payload.company?.trim() || null,
    role: row.payload.role?.trim() || null,
    relationship: row.payload.relationship ?? null,
    decisionMaker:
      typeof row.payload.decision_maker === 'boolean' ? row.payload.decision_maker : null,
  };
}

/**
 * Roll affiliation rows up into one set of facts.
 *
 * For each fact, the **most recent** row that states it wins — people change
 * jobs, and migration 0017 kept every row dated precisely so the newest can be
 * preferred while the older ones stay visible underneath. A null never
 * overwrites a value: a later message that mentions somebody's role without
 * their company says nothing about the company.
 */
export function rollUpAffiliations(
  rows: BriefRow[],
  tokens: string[],
): Pick<ContactBrief, 'facts' | 'about' | 'others'> {
  const about: Affiliation[] = [];
  const others: Affiliation[] = [];

  for (const row of rows) {
    if (row.kind !== AFFILIATION_KIND) continue;
    const affiliation = toAffiliation(row);
    if (!affiliation) continue;
    (titleNames(affiliation.source.title, tokens) ? about : others).push(affiliation);
  }

  const newestFirst = (a: Affiliation, b: Affiliation) =>
    b.source.sentAt.localeCompare(a.source.sentAt);
  about.sort(newestFirst);
  others.sort(newestFirst);

  const first = <K extends 'company' | 'role' | 'relationship' | 'decisionMaker'>(key: K) => {
    const hit = about.find((a) => a[key] !== null);
    return hit ? { value: hit[key] as NonNullable<Affiliation[K]>, source: hit.source } : null;
  };

  return {
    facts: {
      company: first('company'),
      role: first('role'),
      relationship: first('relationship'),
      decisionMaker: first('decisionMaker'),
    },
    about,
    others,
  };
}

/**
 * What is still open in their conversations — not Done, not archived.
 *
 * Ordered the way `/attention` orders its first two columns, and for the same
 * reason: by when it is ABOUT, soonest (or most overdue) first, then undated
 * items by newest message. Ordered by arrival, a meeting tomorrow sits under a
 * month of chatter.
 */
export function openItems(rows: BriefRow[]): OpenItem[] {
  const items: OpenItem[] = [];

  for (const row of rows) {
    if (!(ATTENTION_KINDS as readonly string[]).includes(row.kind)) continue;
    if (row.status === 'done') continue;
    const title = row.payload.title?.trim();
    const quote = row.payload.quote?.trim();
    if (!title || !quote) continue;

    items.push({
      id: row.id,
      kind: row.kind as AttentionKind,
      status: row.status ?? 'not_started',
      title,
      quote,
      when: row.kind === 'meeting' ? (row.payload.starts_at ?? null) : (row.payload.due_at ?? null),
      owedBy: row.payload.owed_by ?? null,
      messageId: row.messageId,
      channelId: row.channelId,
    });
  }

  const sentAt = new Map(rows.map((row) => [row.id, row.sentAt]));
  return items.sort((a, b) => {
    if (a.when && b.when) return a.when.localeCompare(b.when);
    if (a.when) return -1;
    if (b.when) return 1;
    return (sentAt.get(b.id) ?? '').localeCompare(sentAt.get(a.id) ?? '');
  });
}

/** How many messages they sent on each line, and when last. Busiest line first. */
export function channelLines(
  messages: { channelId: string; sentAt: string; fromThem: boolean }[],
): ChannelLine[] {
  const lines = new Map<string, ChannelLine>();
  for (const message of messages) {
    if (!message.fromThem) continue;
    const line = lines.get(message.channelId) ?? {
      channelId: message.channelId,
      count: 0,
      lastAt: message.sentAt,
    };
    line.count += 1;
    if (message.sentAt > line.lastAt) line.lastAt = message.sentAt;
    lines.set(message.channelId, line);
  }
  return [...lines.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

/** `in()` goes into the URL; chunked so a busy contact cannot overflow it. */
const IN_CHUNK = 100;

/**
 * Read everything the brief needs for one contact.
 *
 * ⚠ **No message body is selected anywhere in here.** The brief shows quotes —
 * one verified sentence per extraction, the third place message content renders
 * (`docs/02-ARCHITECTURE.md` §6) — and never a body. Ids, times and channels
 * are all it needs from `messages`.
 *
 * ⚠ RLS scopes every query, so there is no `owner_id` filter; adding one would
 * imply the policy might not be doing its job. Same note as `fetchContacts`.
 */
export async function fetchContactBrief(
  supabase: SupabaseClient,
  contact: { displayName: string; identities: { id: string; displayName: string | null }[] },
): Promise<{ brief: ContactBrief | null; error: string | null }> {
  const identityIds = contact.identities.map((i) => i.id);
  if (identityIds.length === 0) return { brief: null, error: null };

  try {
    // Which conversations do they take part in? The same resolution
    // `fetchContactDetail` uses, so the brief and the history below it agree.
    const { data: theirs, error: theirsError } = await supabase
      .from('messages')
      .select('conversation_id')
      .in('sender_identity', identityIds)
      .not('conversation_id', 'is', null);
    if (theirsError) return { brief: null, error: theirsError.message };

    const conversationIds = [
      ...new Set(((theirs ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id)),
    ];
    if (conversationIds.length === 0) return { brief: null, error: null };

    /*
     * Every message in those conversations: ids, times, channels, who sent it,
     * and whether the extraction pass has read it — the embed on
     * `message_extraction_runs` (migration 0011) answers that without a second
     * query. Bounded, newest first; 300 conversations' worth of history is far
     * more than a brief needs to be current.
     */
    const messages: {
      id: string;
      sent_at: string;
      channel_id: string;
      sender_identity: string | null;
      message_extraction_runs: { message_id: string } | { message_id: string }[] | null;
    }[] = [];
    for (let i = 0; i < conversationIds.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from('messages')
        .select('id, sent_at, channel_id, sender_identity, message_extraction_runs(message_id)')
        .in('conversation_id', conversationIds.slice(i, i + IN_CHUNK))
        .order('sent_at', { ascending: false })
        .limit(300);
      if (error) return { brief: null, error: error.message };
      messages.push(...((data ?? []) as unknown as typeof messages));
    }

    const identitySet = new Set(identityIds);
    const messageById = new Map(messages.map((m) => [m.id, m]));
    const hasRun = (m: (typeof messages)[number]) =>
      Array.isArray(m.message_extraction_runs)
        ? m.message_extraction_runs.length > 0
        : m.message_extraction_runs !== null;

    const rows: BriefRow[] = [];
    const ids = [...messageById.keys()];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from('extractions')
        .select('id, kind, status, model, message_id, payload')
        .in('message_id', ids.slice(i, i + IN_CHUNK))
        .in('kind', [AFFILIATION_KIND, ...ATTENTION_KINDS])
        // ⚠ `is`, never `eq(…, null)` — PostgREST turns `eq` into `= null`,
        // which matches nothing, and the brief would render empty with no
        // error. The same trap ADR-021 records for the board.
        .is('archived_at', null);
      if (error) return { brief: null, error: error.message };

      for (const row of (data ?? []) as {
        id: string;
        kind: string;
        status: AttentionStatus | null;
        model: string;
        message_id: string;
        payload: BriefRow['payload'] | null;
      }[]) {
        const message = messageById.get(row.message_id);
        if (!message) continue;
        rows.push({
          id: row.id,
          kind: row.kind,
          status: row.status,
          model: row.model,
          messageId: row.message_id,
          sentAt: message.sent_at,
          channelId: message.channel_id,
          payload: row.payload ?? {},
        });
      }
    }

    const tokens = nameTokens([
      contact.displayName,
      ...contact.identities.map((i) => i.displayName),
    ]);
    const rolled = rollUpAffiliations(rows, tokens);
    const open = openItems(rows);

    return {
      brief: {
        ...rolled,
        open,
        lines: channelLines(
          messages.map((m) => ({
            channelId: m.channel_id,
            sentAt: m.sent_at,
            fromThem: m.sender_identity !== null && identitySet.has(m.sender_identity),
          })),
        ),
        unread: messages.filter((m) => !hasRun(m)).length,
        total: messages.length,
        models: [
          ...new Set(
            rows
              .filter(
                (r) =>
                  rolled.about.some((a) => a.source.extractionId === r.id) ||
                  rolled.others.some((a) => a.source.extractionId === r.id) ||
                  open.some((o) => o.id === r.id),
              )
              .map((r) => r.model),
          ),
        ],
      },
      error: null,
    };
  } catch (cause) {
    return {
      brief: null,
      // Never the payload: extraction rows carry quotes from real messages. §6.
      error: cause instanceof Error ? cause.message : 'The brief is unavailable.',
    };
  }
}

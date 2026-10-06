import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelType } from '@switchboard/core';

import {
  ATTENTION_KINDS,
  KIND_LABEL,
  STATUS_LABEL,
  type AttentionKind,
  type AttentionStatus,
} from '../attention';
import {
  AFFILIATION_KIND,
  RELATIONSHIP_LABEL,
  nameTokens,
  openItems,
  rollUpAffiliations,
  type BriefRow,
} from '../brief';
import {
  assembleClues,
  hintWords,
  narrowByHint,
  phraseClue,
  tellApart,
  type PersonClues,
} from '../tell-apart';

/**
 * The nine tools the Vapi agent can call (`get_files`, `read_message`,
 * `get_overview` and `read_file` added 2026-10-06, when Yuri asked for Uriel
 * to reach everything in Switchboard, then to open files).
 *
 * ── ⚠⚠ EVERY QUERY IN THIS FILE FILTERS ON `owner_id` BY HAND ───────────────
 *
 * That is not belt-and-braces. It is the only thing standing between tenants
 * on this path.
 *
 * The rest of the console reads through `lib/supabase/server`, where RLS scopes
 * every query to the signed-in user — which is why `fetchAttention`,
 * `searchMessages` and `fetchContactDetail` take no owner argument, and why
 * each of them carries a comment saying an owner filter would *imply the policy
 * might not be doing its job*.
 *
 * **None of that is true here.** A Vapi tool webhook arrives with no cookie and
 * no user, so it runs as `service_role`, and `service_role` bypasses every
 * policy in migration 0002. Calling the existing fetchers with that client
 * would return **every tenant's rows** and read them down a phone line. So
 * these are separate functions rather than a reused one, and the duplication is
 * deliberate: the two paths have opposite security models and sharing code
 * between them is how one quietly inherits the other's assumptions.
 *
 * The `ownerId` they receive comes from `voice_call_sessions`, looked up by the
 * Vapi call id. Never from the request body. See migration 0014.
 *
 * ── Why the results are shaped for speech here ──────────────────────────────
 *
 * Each tool returns a `summary` string that is already a sentence, plus a short
 * structured list. The agent's prompt says *"NEVER calculate totals, counts, or
 * durations yourself"* — a rule the model can only follow if the count is
 * handed to it already computed. Returning raw rows and hoping it counts them
 * correctly is how a voice agent confidently says "four" about three things.
 */

/**
 * Everything a channel needs to be SAID OUT LOUD, in one place.
 *
 * ⚠ Spoken, so these are the words a person says — "Gmail", not "gmail", and
 * "a meeting", not "meeting", because the article is what makes "seen on Gmail
 * and a meeting" scan as a sentence.
 *
 * ⚠⚠ Typed `Record<ChannelType, …>` so adding a fourth channel to the canonical
 * union makes this file fail to typecheck until somebody decides how it is
 * pronounced. Phase 7 added `meeting` and found THREE separate places that had
 * quietly assumed two — a `resolve_person` ternary that would have said
 * "WhatsApp" about a meeting out loud, the spoken-word filter below, and the
 * unit noun under it. One record, checked by the compiler, is what stops a
 * fourth.
 *
 * `missing` is a whole sentence rather than a noun because the three are not
 * parallel: Gmail and WhatsApp are accounts somebody connects, and a meeting is
 * something that either happened or did not.
 */
interface SpokenChannel {
  /** Mid-sentence: "seen on Gmail and a meeting". */
  label: string;
  /** Counted: "three Gmail messages". */
  unit: string;
  /** Said when the filter matched no channel at all. */
  missing: string;
  /** Words a caller might actually use for it, lowercase. */
  heard: readonly string[];
}

const CHANNEL_SPEECH: Record<ChannelType, SpokenChannel> = {
  gmail: {
    label: 'Gmail',
    unit: 'Gmail message',
    missing: 'No Gmail account is connected.',
    heard: ['gmail', 'email', 'emails', 'mail', 'e-mail'],
  },
  whatsapp: {
    label: 'WhatsApp',
    unit: 'WhatsApp message',
    missing: 'No WhatsApp account is connected.',
    heard: ['whatsapp', 'whats app'],
  },
  meeting: {
    label: 'a meeting',
    unit: 'meeting',
    missing: 'No meetings have been recorded yet.',
    heard: ['meeting', 'meetings', 'zoom', 'meet', 'teams', 'google meet'],
  },
};

/**
 * A spoken word to a channel type.
 *
 * ⚠ Built FROM `CHANNEL_SPEECH` rather than written out again. A second list
 * is a second thing to forget.
 *
 * ⚠ `inbox` is deliberately absent. "What's in my inbox" means the whole
 * unified record, which is the entire point of this product — mapping it to
 * Gmail would answer a different question than the one asked.
 */
const HEARD_AS = new Map<string, ChannelType>(
  (Object.entries(CHANNEL_SPEECH) as [ChannelType, SpokenChannel][]).flatMap(
    ([type, spoken]) => spoken.heard.map((word) => [word, type] as const),
  ),
);

/** Ready to speak, with the numbers already worked out. */
export interface ToolResult {
  summary: string;
  [key: string]: unknown;
}

/**
 * Manila wall-clock, phrased the way a person says it.
 *
 * ⚠ The corpus is Philippine and the console renders Asia/Manila everywhere
 * else. A voice agent that says "fourteen hundred UTC" is wrong in a way that
 * sounds authoritative.
 */
function spokenWhen(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'no time given';

  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'no time given';

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(at);

  // "Today" and "tomorrow" are what a person would say, and they are the two
  // that matter most for anything on the attention board.
  const dayOf = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(date);

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(at);

  if (dayOf(at) === dayOf(now)) return `today at ${time}`;
  if (dayOf(at) === dayOf(tomorrow)) return `tomorrow at ${time}`;
  return parts;
}

/** "three" — spelled out, because a numeral gets read inconsistently. */
function spell(n: number): string {
  const words = [
    'no',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
  ];
  return n < words.length ? words[n]! : String(n);
}

/** "three things". */
function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${spell(n)} ${n === 1 ? singular : plural}`;
}

/**
 * Trim a quote to something speakable.
 *
 * ⚠ Cut on a word boundary. A quote severed mid-word is read aloud as a
 * mispronunciation, which sounds like the assistant misreading the message
 * rather than like a truncation.
 */
function speakable(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** A uuid's shape. A malformed one makes PostgREST answer 400 naming the column. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ─── Files on a message ──────────────────────────────────────────────────── */

/**
 * The files attached to a message, as Uriel says them.
 *
 * ⚠ Yuri, 2026-10-06: Uriel could not see a single picture or PDF that the
 * Files page showed. Every tool read `messages` and nothing read `attachments`,
 * so an email with an invoice attached was read aloud as if it had none. Every
 * message a tool returns now carries its files, and `get_files` asks for them
 * directly.
 *
 * Embedded in each message query (`attachments(filename, mime_type)`) rather
 * than a second round trip, with `attachments.owner_id` filtered by hand like
 * every other read in this file.
 *
 * ⚠ Names and kinds only. Nothing reads what is INSIDE a file, and the prompt
 * tells Uriel so — a PDF it describes from its name alone would be invented.
 */
const ATTACHMENTS = 'attachments(id, filename, mime_type, text_status)';

type AttachmentRow = {
  id?: string;
  filename: string | null;
  mime_type: string | null;
  text_status?: string | null;
};

/** "a PDF", "a picture" — what a person calls it, not a MIME type. */
export function spokenFileKind(mimeType: string | null, filename: string | null): string {
  const type = (mimeType ?? '').toLowerCase();
  const extension = (filename ?? '').toLowerCase().split('.').pop() ?? '';

  if (type === 'application/pdf' || extension === 'pdf') return 'a PDF';
  if (type.startsWith('image/')) return 'a picture';
  if (type.startsWith('video/')) return 'a video';
  if (type.startsWith('audio/')) return 'an audio recording';
  if (/word|msword/.test(type) || ['doc', 'docx'].includes(extension)) return 'a Word document';
  if (/sheet|excel|csv/.test(type) || ['xls', 'xlsx', 'csv'].includes(extension)) {
    return 'a spreadsheet';
  }
  if (/presentation|powerpoint/.test(type) || ['ppt', 'pptx'].includes(extension)) {
    return 'a slide deck';
  }
  if (/zip|compressed/.test(type) || ['zip', 'rar', '7z'].includes(extension)) return 'a zip file';
  return 'a file';
}

/**
 * `{ files }` when the message has any, nothing when it has none — an empty
 * list on every message is noise the model reads past the useful fields for.
 */
function withFiles(rows: AttachmentRow[] | null | undefined): {
  files?: { name: string; kind: string; fileId?: string; readable?: true }[];
} {
  const files = (rows ?? []).map((row) => ({
    name: row.filename ?? 'unnamed file',
    kind: spokenFileKind(row.mime_type, row.filename),
    // For `read_file`. `readable` only when the worker has its text (0020),
    // so the model is not tempted to open a picture.
    ...(row.id ? { fileId: row.id } : {}),
    ...(row.text_status === 'done' ? { readable: true as const } : {}),
  }));
  return files.length > 0 ? { files } : {};
}

/* ─── The model's summary of a message ────────────────────────────────────── */

/**
 * The summary the console shows above a long message, embedded beside it.
 *
 * ⚠ Uriel used to read a long email as its first 200 characters — usually a
 * greeting and a logo's alt text — while the screen showed a two-line summary
 * of the whole thing. `aiSummary` carries that summary, so the gist of a
 * newsletter or a long thread is what gets said.
 *
 * Aliased `gist` (a message has several kinds of extraction; only `summary`
 * is wanted), and filtered by kind AND `owner_id` like every embed here.
 */
const AI_SUMMARY = 'gist:extractions!extractions_message_id_fkey(kind, payload)';

type GistRow = { kind?: string; payload: { text?: string } | null };

function withSummary(rows: GistRow[] | null | undefined): { aiSummary?: string } {
  const text = (rows ?? []).find((row) => row.payload?.text)?.payload?.text;
  return text ? { aiSummary: speakable(text, 400) } : {};
}

/* ─── resolve_person ──────────────────────────────────────────────────────── */

export interface ResolvedPerson {
  personId: string;
  name: string;
  /**
   * What tells this one apart from the others with the name — "at Acme",
   * "emails from mapua.edu.ph", "last wrote about “Q3 budget”". Empty when the
   * full name already does it; null when nothing does.
   */
  tellApart: string | null;
  /** "Gmail and WhatsApp". */
  seenOn: string;
  lastHeardFrom: string;
}

/** Past this many, reading the list aloud loses the caller; ask for a hint. */
const READ_OUT_MAX = 3;

/** The most contacts one name can resolve to before the answer says "at least". */
const MATCH_LIMIT = 10;

/**
 * Turn a spoken name into a specific person — and when several share it, say
 * what tells each one apart (Ms. Maria's research task 4).
 *
 * ⚠ Returning MORE THAN ONE is a correct and expected outcome, not a failure.
 * The agent's prompt says never to pick one silently. What changed is what it
 * can ASK: it used to have only "Gmail" and a date for each, so two Marias on
 * Gmail were "the one from Tuesday or the one from last month". Now each carries
 * the one clue nobody else in the group has — see `lib/tell-apart.ts`.
 *
 * `hint` is whatever the caller said back ("the one from Acme", "about the
 * website"). It narrows the group on what is known about each person AND on
 * words in their conversations, so project context works even when no company
 * was ever extracted.
 *
 * ── ⚠ Every query below filters on owner_id — see the top of this file ──────
 *
 * Six reads at most, none of them per person. The version this replaced ran two
 * queries per match, sequentially; ten Marias was twenty-one round trips while
 * a caller waited in silence.
 */
export async function resolvePerson(
  supabase: SupabaseClient,
  ownerId: string,
  name: string,
  { hint }: { hint?: string } = {},
): Promise<ToolResult> {
  const needle = name.trim();
  if (!needle) return { summary: 'No name was given.', matches: [] };

  /*
   * ⚠ The name goes into a `like` pattern, so its wildcards are escaped first.
   * A spoken name will not contain `%` — but this is untrusted input reaching a
   * query, and "the input can't contain that" is the assumption every injection
   * bug is built on.
   */
  const escaped = needle.replace(/[\\%_]/g, (char) => `\\${char}`);

  const { data, error } = await supabase
    .from('contacts')
    .select('id, display_name, notes')
    // ⚠ THE TENANT FILTER. Without it this returns every user's contacts.
    .eq('owner_id', ownerId)
    .ilike('display_name', `%${escaped}%`)
    .limit(MATCH_LIMIT);

  if (error) {
    return { summary: 'TOOL_ERROR: could not look that person up.', matches: [] };
  }

  const contacts = ((data ?? []) as { id: string; display_name: string; notes?: string | null }[])
    .filter((row) => row?.id)
    .map((row) => ({ id: row.id, displayName: row.display_name, notes: row.notes ?? null }));
  if (contacts.length === 0) {
    return { summary: `No one called ${needle} is in the messages.`, matches: [] };
  }

  /*
   * The clues. Each side query failing costs a clue, never the answer: the
   * name was found, and "I found three Marias but can't say more" is better
   * than a TOOL_ERROR about somebody the caller can hear exists.
   */
  const contactIds = contacts.map((c) => c.id);
  const { data: identityRows } = await supabase
    .from('contact_identities')
    .select('id, contact_id, channel_type, external_id, display_name')
    .eq('owner_id', ownerId)
    .in('contact_id', contactIds);

  const identities = ((identityRows ?? []) as {
    id: string;
    contact_id: string | null;
    channel_type: string;
    external_id: string;
    display_name: string | null;
  }[]).map((row) => ({
    id: row.id,
    contactId: row.contact_id,
    channelType: row.channel_type,
    externalId: row.external_id,
    displayName: row.display_name,
  }));
  const identityIds = identities.map((i) => i.id).filter(Boolean);

  // ⚠ No body — a subject and a time are all a clue needs.
  const { data: sentRows } = identityIds.length
    ? await supabase
        .from('messages')
        .select('sender_identity, subject, sent_at, conversation_id')
        .eq('owner_id', ownerId)
        .in('sender_identity', identityIds)
        .order('sent_at', { ascending: false })
        .limit(500)
    : { data: [] };

  const sent = ((sentRows ?? []) as {
    sender_identity: string | null;
    subject: string | null;
    sent_at: string;
    conversation_id: string | null;
  }[]).map((row) => ({
    senderIdentity: row.sender_identity,
    subject: row.subject,
    sentAt: row.sent_at,
    conversationId: row.conversation_id,
  }));

  const affiliations = await affiliationsForVoice(supabase, ownerId);
  const everyone = assembleClues({ contacts, identities, sent, affiliations });

  /* ── Narrow by what the caller said, if they said anything ── */

  const words = hintWords(hint);
  let group = everyone;
  if (words.length > 0 && everyone.length > 1) {
    const conversationsOf = new Map<string, Set<string>>();
    for (const message of sent) {
      const contactId = identities.find((i) => i.id === message.senderIdentity)?.contactId;
      if (!contactId || !message.conversationId) continue;
      conversationsOf.set(contactId, (conversationsOf.get(contactId) ?? new Set()).add(message.conversationId));
    }
    const conversationIds = [...new Set([...conversationsOf.values()].flatMap((s) => [...s]))];

    const inMessages = new Map<string, Set<string>>();
    for (const word of words) {
      const matched = new Set<string | null>();
      // Bounded at five slices (500 conversations) per word: a hint is a
      // follow-up question, and a caller is waiting on it.
      for (const slice of slices(conversationIds)) {
        // ⚠ `word` is letters and digits only (`hintWords`), so it cannot close
        // the `or()` group or add a filter of its own.
        const { data: hitRows } = await supabase
          .from('messages')
          .select('conversation_id')
          .eq('owner_id', ownerId)
          .in('conversation_id', slice)
          .or(`subject.ilike.%${word}%,body_text.ilike.%${word}%`)
          .limit(200);
        for (const row of (hitRows ?? []) as { conversation_id: string | null }[]) {
          matched.add(row.conversation_id);
        }
      }
      const hits = new Set<string>();
      for (const [contactId, theirs] of conversationsOf) {
        if ([...theirs].some((id) => matched.has(id))) hits.add(contactId);
      }
      inMessages.set(word, hits);
    }

    const narrowed = narrowByHint(everyone, words, inMessages);
    if (narrowed.length === 0) {
      return {
        summary:
          `None of the ${spell(everyone.length)} people called ${needle} match ` +
          `"${hint!.trim()}". ` +
          describeGroup(everyone) +
          ' Ask for something else that tells them apart.',
        matches: toMatches(everyone, identities),
      };
    }
    group = narrowed;
  }

  const matches = toMatches(group, identities);
  const atLeast = contacts.length === MATCH_LIMIT ? 'At least ' : '';

  if (matches.length === 1) {
    const [only] = matches as [ResolvedPerson];
    return {
      summary: `One match: ${only.name}${only.tellApart ? `, ${only.tellApart}` : ''}.`,
      matches,
    };
  }

  if (matches.length > READ_OUT_MAX) {
    return {
      summary:
        `${atLeast}${count(matches.length, 'person', 'people')} match that name — too many to read out. ` +
        'Ask for something that tells them apart: a company, what it was about, or when they ' +
        'last wrote. Then call resolve_person again with that as the hint.',
      matches,
    };
  }

  return {
    summary:
      `${atLeast}${count(matches.length, 'person', 'people')} match that name: ` +
      `${describeGroup(group)} Ask which one before going further.`,
    matches,
  };
}

/** "Maria Santos, at Acme; Maria Santos, emails from mapua.edu.ph." */
function describeGroup(people: PersonClues[]): string {
  const clues = tellApart(people);
  const parts = people.map((person) => {
    const clue = clues.get(person.id);
    const phrase = clue ? phraseClue(clue, SPOKEN_CLUE) : null;
    if (phrase === '') return person.name;
    return phrase ? `${person.name}, ${phrase}` : `${person.name}, who the messages cannot tell apart`;
  });
  const unclear = people.filter((p) => clues.get(p.id) === null).length;
  return (
    `${parts.join('; ')}.` +
    (unclear > 1
      ? ` ${capitalise(spell(unclear))} of them look the same in the messages — a note on ` +
        'their contact in Switchboard would fix that.'
      : '')
  );
}

function toMatches(
  people: PersonClues[],
  identities: { contactId: string | null; channelType: string }[],
): ResolvedPerson[] {
  const clues = tellApart(people);
  return people.map((person) => {
    const clue = clues.get(person.id);
    /*
     * ⚠ A LOOKUP, not a ternary. This was `type === 'gmail' ? 'Gmail' :
     * 'WhatsApp'`, which became a lie the moment `meeting` was added in Phase 7
     * — it would have said "WhatsApp" about a meeting, out loud. A map falls
     * back to the raw value, so the next channel reads as unpolished rather
     * than as wrong.
     */
    const channels = [
      ...new Set(
        identities
          .filter((i) => i.contactId === person.id)
          .map((i) => CHANNEL_SPEECH[i.channelType as ChannelType]?.label ?? i.channelType),
      ),
    ];
    return {
      personId: person.id,
      name: person.name,
      tellApart: clue ? phraseClue(clue, SPOKEN_CLUE) : null,
      seenOn: channels.join(' and ') || 'no channel',
      lastHeardFrom: person.lastAt ? spokenWhen(person.lastAt) : 'never',
    };
  });
}

const capitalise = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/**
 * A day, said the way a person says it: "today", "yesterday", "on 3 September".
 *
 * ⚠ Not a weekday. The clue compares calendar days, and "on Tuesday" said
 * about a message from June names a day that is not the one it means.
 */
function spokenDay(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'at an unknown time';
  const day = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(date);
  if (day(at) === day(now)) return 'today';
  if (day(at) === day(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return 'yesterday';
  return `on ${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    day: 'numeric',
    month: 'long',
  }).format(at)}`;
}

/** How a clue is said: channels by their spoken label, days as a person says them. */
const SPOKEN_CLUE = {
  channelLabel: (type: string) => CHANNEL_SPEECH[type as ChannelType]?.label ?? type,
  day: (iso: string) => spokenDay(iso),
};

/** `in()` goes into the URL, so long id lists are read in slices. */
function slices<T>(items: T[], size = 100, max = 5): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length && out.length < max; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Affiliation rows with the conversation each one's message belongs to.
 *
 * ⚠ Owner-filtered by hand, both reads — the RLS-scoped version in `brief.ts`
 * must never be called with this client. Bounded by how many affiliation rows
 * exist (two, on 2026-09-28), not by the size of the corpus.
 */
async function affiliationsForVoice(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<{ row: BriefRow; conversationId: string | null }[]> {
  const { data: rows } = await supabase
    .from('extractions')
    .select('id, kind, model, message_id, payload')
    .eq('owner_id', ownerId)
    .eq('kind', AFFILIATION_KIND)
    .is('archived_at', null)
    .limit(500);

  const extractions = ((rows ?? []) as {
    id: string;
    kind: string;
    model: string;
    message_id: string;
    payload: BriefRow['payload'] | null;
  }[]).filter((row) => row?.kind === AFFILIATION_KIND && row.message_id);
  if (extractions.length === 0) return [];

  type MessageRow = { id: string; sent_at: string; channel_id: string; conversation_id: string | null };
  const messages = new Map<string, MessageRow>();
  for (const slice of slices([...new Set(extractions.map((e) => e.message_id))])) {
    const { data: messageRows } = await supabase
      .from('messages')
      .select('id, sent_at, channel_id, conversation_id')
      .eq('owner_id', ownerId)
      .in('id', slice);
    for (const m of (messageRows ?? []) as MessageRow[]) messages.set(m.id, m);
  }

  return extractions.flatMap((row) => {
    const message = messages.get(row.message_id);
    if (!message) return [];
    return [
      {
        row: {
          id: row.id,
          kind: row.kind,
          status: null,
          model: row.model,
          messageId: row.message_id,
          sentAt: message.sent_at,
          channelId: message.channel_id,
          payload: row.payload ?? {},
        },
        conversationId: message.conversation_id,
      },
    ];
  });
}

/* ─── get_attention_items ─────────────────────────────────────────────────── */

/**
 * What needs this person's attention.
 *
 * ⚠ By default reads only cards still ON the board — not archived, not done.
 * Somebody who archived a card has said they are finished with it, and reading
 * it back to them down the phone would undo the one gesture the board exists to
 * support.
 *
 * `status: "done"` (2026-10-06) is the one way to hear finished work — "what
 * did I finish this week?" — newest first, cleared cards included, since
 * clearing the Done column is how finished work leaves the board.
 *
 * Each card says which column it is in, whether it is on the calendar, who it
 * came from, and its `messageId` for `read_message` — what the board shows.
 */
export async function getAttentionItems(
  supabase: SupabaseClient,
  ownerId: string,
  { limit = 20, status }: { limit?: number; status?: string } = {},
): Promise<ToolResult> {
  const done = status?.toLowerCase().trim() === 'done';

  let query = supabase
    .from('extractions')
    .select(
      'kind, status, payload, message_id, calendar_event_id, ' +
        'message:messages!extractions_message_id_fkey(sent_at, ' +
        'sender:contact_identities!messages_sender_identity_fkey(display_name, external_id))',
    )
    // ⚠ THE TENANT FILTER.
    .eq('owner_id', ownerId)
    .in('kind', [...ATTENTION_KINDS]);

  query = done
    ? query.eq('status', 'done').order('status_changed_at', { ascending: false })
    : query
        // ⚠ `is`, not `eq(..., null)` — PostgREST turns `eq` into `= null`,
        // which matches nothing and would silently report an empty board.
        // Same trap `fetchAttention` documents.
        .is('archived_at', null)
        .neq('status', 'done')
        .order('created_at', { ascending: false });

  const { data, error } = await query.limit(limit);

  if (error) {
    return { summary: 'TOOL_ERROR: could not read the attention board.', items: [] };
  }

  type Row = {
    kind: string;
    status: AttentionStatus | null;
    message_id: string;
    calendar_event_id: string | null;
    payload: { title?: string; quote?: string; starts_at?: string | null; due_at?: string | null };
    message: {
      sender: { display_name: string | null; external_id: string } | null;
    } | null;
  };

  const items = ((data ?? []) as unknown as Row[]).map((row) => ({
    kind: KIND_LABEL[row.kind as AttentionKind]?.toLowerCase() ?? row.kind.replace(/_/g, ' '),
    title: row.payload?.title ?? 'untitled',
    when: spokenWhen(row.payload?.starts_at ?? row.payload?.due_at ?? null),
    quote: speakable(row.payload?.quote ?? ''),
    column: STATUS_LABEL[row.status ?? 'not_started'].toLowerCase(),
    onCalendar: row.calendar_event_id !== null,
    from:
      row.message?.sender?.display_name ?? row.message?.sender?.external_id ?? 'unknown sender',
    messageId: row.message_id,
  }));

  if (items.length === 0) {
    return {
      summary: done
        ? 'Nothing has been marked done yet.'
        : 'Nothing is on the attention board right now.',
      items: [],
    };
  }

  return {
    // The count is computed HERE so the agent never has to. See the note at the
    // top of this file.
    summary: done
      ? `${count(items.length, 'item')} marked done, newest first.`
      : `${count(items.length, 'item')} need attention.`,
    items,
  };
}

/* ─── search_messages ─────────────────────────────────────────────────────── */

/** Words a spoken search carries that no message is being searched FOR. */
const SEARCH_FILLER = new Set([
  'the', 'a', 'an', 'of', 'for', 'to', 'from', 'in', 'on', 'at', 'and', 'or',
  'about', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'any', 'some', 'all',
  'my', 'me', 'you', 'your', 'there', 'that', 'this', 'these', 'those', 'it', 'its',
  'them', 'if', 'do', 'did', 'does', 'have', 'has', 'had', 'can', 'could', 'would',
  'please', 'what', 'which', 'when', 'where', 'tell', 'get', 'got', 'reach', 'see',
  'find', 'check', 'show', 'look', 'now', 'just', 'still', 'yet', 'also', 'sent',
  'received', 'folder', 'file', 'files',
  'email', 'emails', 'mail', 'message', 'messages',
]);

/**
 * The words of a search worth matching, at most four. EACH must appear.
 *
 * ⚠ Not the phrase. Yuri, 2026-10-06, asked Uriel for "OpenAI's about a
 * refund" and heard "I don't have anything about that" — while the inbox held
 * "Your OpenAI OpCo, LLC refund" and a credit note PDF. The search was one
 * `ilike '%OpenAI refund%'`, and those two words never sit side by side.
 *
 * ⚠ Letters and digits only, like `hintWords`: they go into a PostgREST
 * `or()` filter, where a comma or a parenthesis is syntax, and with no `%` or
 * `_` left there is nothing to escape. "INV-2207.pdf" becomes inv, 2207, pdf —
 * all three still in the file's name.
 */
export function searchWords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2 && !SEARCH_FILLER.has(word));
  return [...new Set(words)].slice(0, 4);
}

/**
 * Find messages across the connected channels.
 *
 * ⚠ Searches whatever is in `messages`, which since Phase 7 includes the
 * `meeting` channel. This said "Gmail and WhatsApp only. There are no
 * transcripts in this system", and pointed at the agent's prompt saying the
 * same. The two have to stay true together, so BOTH were changed — see
 * `correspondence/2026-09-10-vapi-agent-prompt.md`.
 *
 * ⚠ What is still true: there is no `get_meeting_brief` tool. A meeting is
 * found the way every other message is found, by keyword. An agent told it can
 * "pull up a meeting" says "let me pull that up" and then has to climb back
 * down, which is the exact failure that prompt was rewritten to avoid.
 */
export async function searchMessagesForVoice(
  supabase: SupabaseClient,
  ownerId: string,
  query: string,
  { limit = 5 }: { limit?: number } = {},
): Promise<ToolResult> {
  const needle = query.trim();
  const words = searchWords(needle);
  if (words.length === 0) return { summary: 'No search term was given.', results: [] };

  const columns =
    'id, subject, body_text, sent_at, ' +
    'sender:contact_identities!messages_sender_identity_fkey(display_name, external_id), ' +
    AI_SUMMARY +
    ', ';

  /*
   * ⚠ Plain `ilike`, NOT the `search_messages` RPC the console uses.
   *
   * That function is `SECURITY INVOKER` and takes no owner argument — it relies
   * entirely on RLS, which is inert for this client. Calling it here would
   * search every tenant's mail. An owner-filtered `ilike` is less clever and it
   * is correct; the ranked full-text path can come back the day the RPC learns
   * to take an explicit owner.
   *
   * EACH WORD must appear, anywhere (`searchWords`) — not the phrase.
   *
   * Two queries, because PostgREST cannot OR a message's own columns with its
   * files' columns: the words of the message, and the NAMES of its files — so
   * "the invoice" finds an email whose only mention of it is `Invoice.pdf`.
   */
  let inTextQuery = supabase
    .from('messages')
    .select(columns + ATTACHMENTS)
    // ⚠ THE TENANT FILTER — on the message, its files and its summary.
    .eq('owner_id', ownerId)
    .eq('attachments.owner_id', ownerId)
    .eq('gist.owner_id', ownerId)
    .eq('gist.kind', 'summary');
  // One `or()` per word; PostgREST ANDs them.
  for (const word of words) {
    inTextQuery = inTextQuery.or(`subject.ilike.%${word}%,body_text.ilike.%${word}%`);
  }

  let inFileNameQuery = supabase
    .from('messages')
    // `!inner`: only messages with a file of that name.
    .select(columns + 'attachments!inner(id, filename, mime_type, text_status)')
    // ⚠ THE TENANT FILTER — on the message, its files and its summary.
    .eq('owner_id', ownerId)
    .eq('attachments.owner_id', ownerId)
    .eq('gist.owner_id', ownerId)
    .eq('gist.kind', 'summary');
  for (const word of words) {
    inFileNameQuery = inFileNameQuery.ilike('attachments.filename', `%${word}%`);
  }

  const [inText, inFileName] = await Promise.all([
    inTextQuery.order('sent_at', { ascending: false }).limit(limit),
    inFileNameQuery.order('sent_at', { ascending: false }).limit(limit),
  ]);

  if (inText.error || inFileName.error) {
    return { summary: 'TOOL_ERROR: could not search the messages.', results: [] };
  }

  type Row = {
    id: string;
    subject: string | null;
    body_text: string;
    sent_at: string;
    sender: { display_name: string | null; external_id: string } | null;
    attachments?: AttachmentRow[] | null;
    gist?: GistRow[] | null;
  };

  // Through `unknown`: the embedded `sender` select makes PostgREST's generated
  // type an error union that does not overlap with the row shape, so a direct
  // cast is rejected.
  const byId = new Map<string, Row>();
  // Text matches first: their file list is complete, where a file-name match
  // only carries the files that matched.
  for (const row of [
    ...((inText.data ?? []) as unknown as Row[]),
    ...((inFileName.data ?? []) as unknown as Row[]),
  ]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }

  const results = [...byId.values()]
    .sort((a, b) => b.sent_at.localeCompare(a.sent_at))
    .slice(0, limit)
    .map((row) => ({
      messageId: row.id,
      from: row.sender?.display_name ?? row.sender?.external_id ?? 'unknown sender',
      subject: row.subject ?? null,
      when: spokenWhen(row.sent_at),
      ...withSummary(row.gist),
      excerpt: speakable(row.body_text),
      ...withFiles(row.attachments),
    }));

  // The words searched, not the sentence they came in: the model sometimes
  // passes the caller's whole question, and reading it back sounds broken.
  const searched = words.join(' ');
  if (results.length === 0) {
    return { summary: `Nothing mentions ${searched}.`, results: [] };
  }

  return {
    summary: `${count(results.length, 'message')} ${results.length === 1 ? 'mentions' : 'mention'} ${searched}.`,
    results,
  };
}

/* ─── get_person_activity ─────────────────────────────────────────────────── */

/**
 * Who this person is and what is open with them — the contact page's brief.
 *
 * Added 2026-10-06 ("make Uriel reach everything in Switchboard"): the screen
 * showed a person's company, role, relationship and open items, and Uriel
 * could only read their last five messages.
 *
 * The roll-ups are the brief's own pure functions (`rollUpAffiliations`,
 * `openItems`, `nameTokens` in `lib/brief.ts`), so Uriel and the screen name
 * the same company and the same open items. Only the READS are this file's:
 * `fetchContactBrief` relies on RLS, which is inert here — every query below
 * filters `owner_id` by hand. Bounded tighter than the screen (100
 * conversations, 100 messages), because a caller is waiting.
 *
 * ⚠ Extra, never essential: any failure returns nothing rather than failing
 * the activity it is attached to.
 */
async function personBrief(
  supabase: SupabaseClient,
  ownerId: string,
  personId: string,
  name: string,
): Promise<Record<string, unknown>> {
  try {
    const { data: identityRows } = await supabase
      .from('contact_identities')
      .select('id, display_name')
      // ⚠ THE TENANT FILTER.
      .eq('owner_id', ownerId)
      .eq('contact_id', personId);
    const identities = (identityRows ?? []) as { id: string; display_name: string | null }[];
    if (identities.length === 0) return {};

    // Their conversations, both directions — the brief's own resolution.
    const { data: theirs } = await supabase
      .from('messages')
      .select('conversation_id')
      // ⚠ THE TENANT FILTER.
      .eq('owner_id', ownerId)
      .in('sender_identity', identities.map((identity) => identity.id))
      .not('conversation_id', 'is', null)
      .limit(300);
    const conversationIds = [
      ...new Set(
        ((theirs ?? []) as { conversation_id: string | null }[])
          .map((row) => row.conversation_id)
          .filter((id): id is string => !!id),
      ),
    ].slice(0, 100);
    if (conversationIds.length === 0) return {};

    const { data: messageRows } = await supabase
      .from('messages')
      .select('id, sent_at, channel_id')
      // ⚠ THE TENANT FILTER.
      .eq('owner_id', ownerId)
      .in('conversation_id', conversationIds)
      .order('sent_at', { ascending: false })
      .limit(100);
    const messageById = new Map(
      ((messageRows ?? []) as { id: string; sent_at: string; channel_id: string }[]).map(
        (row) => [row.id, row],
      ),
    );
    if (messageById.size === 0) return {};

    const { data: extractionRows } = await supabase
      .from('extractions')
      .select('id, kind, status, model, message_id, payload')
      // ⚠ THE TENANT FILTER.
      .eq('owner_id', ownerId)
      .in('message_id', [...messageById.keys()])
      .in('kind', [AFFILIATION_KIND, ...ATTENTION_KINDS])
      .is('archived_at', null);

    const rows: BriefRow[] = [];
    for (const row of (extractionRows ?? []) as {
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

    const { facts } = rollUpAffiliations(
      rows,
      nameTokens([name, ...identities.map((identity) => identity.display_name)]),
    );
    const about = {
      ...(facts.company ? { company: facts.company.value } : {}),
      ...(facts.role ? { role: facts.role.value } : {}),
      ...(facts.relationship
        ? { relationship: RELATIONSHIP_LABEL[facts.relationship.value].toLowerCase() }
        : {}),
      ...(facts.decisionMaker ? { decisionMaker: facts.decisionMaker.value } : {}),
    };

    const open = openItems(rows)
      .slice(0, 5)
      .map((item) => ({
        kind: KIND_LABEL[item.kind].toLowerCase(),
        title: item.title,
        when: spokenWhen(item.when),
        column: STATUS_LABEL[item.status].toLowerCase(),
        // Who owes it: "you" said you would, or they did.
        owedBy: item.owedBy === 'me' ? 'you' : item.owedBy === 'them' ? name : null,
      }));

    return {
      ...(Object.keys(about).length > 0 ? { about } : {}),
      ...(open.length > 0 ? { openWithThem: open } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * What one person has been in touch about — and, since 2026-10-06, who they
 * are and what is open with them (`personBrief`).
 *
 * Takes a `personId` from `resolve_person` rather than a name, on purpose: a
 * name is ambiguous and this is the tool that would otherwise silently pick the
 * wrong Maria.
 */
export async function getPersonActivity(
  supabase: SupabaseClient,
  ownerId: string,
  personId: string,
  { limit = 5 }: { limit?: number } = {},
): Promise<ToolResult> {
  if (!UUID_SHAPE.test(personId)) {
    // A malformed uuid makes PostgREST answer 400 naming the column and type,
    // which is a worse thing to say aloud than "I don't know who that is".
    return { summary: 'TOOL_ERROR: that is not a person I can look up.', messages: [] };
  }

  const { data: contactRow } = await supabase
    .from('contacts')
    .select('display_name')
    // ⚠ THE TENANT FILTER — and it is what stops a guessed uuid from another
    // tenant resolving to a real person here.
    .eq('owner_id', ownerId)
    .eq('id', personId)
    .maybeSingle();

  if (!contactRow) {
    return { summary: 'No one by that id is in the messages.', messages: [] };
  }

  const name = (contactRow as { display_name: string }).display_name;

  // In parallel: the brief is a chain of four reads, and it should not wait
  // behind the messages it sits beside.
  const [{ data, error }, brief] = await Promise.all([
    supabase
      .from('messages')
      .select(
        'id, subject, body_text, sent_at, sender_identity!inner(contact_id), ' +
          ATTACHMENTS +
          ', ' +
          AI_SUMMARY,
      )
      // ⚠ THE TENANT FILTER — on the messages, their files and their summaries.
      .eq('owner_id', ownerId)
      .eq('attachments.owner_id', ownerId)
      .eq('gist.owner_id', ownerId)
      .eq('gist.kind', 'summary')
      .eq('sender_identity.contact_id', personId)
      .order('sent_at', { ascending: false })
      .limit(limit),
    personBrief(supabase, ownerId, personId, name),
  ]);

  if (error) {
    return { summary: `TOOL_ERROR: could not read messages from ${name}.`, messages: [] };
  }

  type Row = {
    id: string;
    subject: string | null;
    body_text: string;
    sent_at: string;
    attachments?: AttachmentRow[] | null;
    gist?: GistRow[] | null;
  };

  // Through `unknown`: the `!inner` embed makes PostgREST's generated type an
  // error union that does not overlap with the row shape, so a direct cast is
  // rejected. Same shape the other fetchers use for embedded selects.
  const messages = ((data ?? []) as unknown as Row[]).map((row) => ({
    messageId: row.id,
    subject: row.subject ?? null,
    when: spokenWhen(row.sent_at),
    ...withSummary(row.gist),
    excerpt: speakable(row.body_text),
    ...withFiles(row.attachments),
  }));

  if (messages.length === 0) {
    return { summary: `Nothing from ${name} yet.`, person: name, ...brief, messages: [] };
  }

  return {
    summary: `${count(messages.length, 'message')} from ${name}.`,
    person: name,
    ...brief,
    messages,
  };
}


/* ─── get_recent_messages ─────────────────────────────────────────────────── */

/**
 * The latest messages, newest first.
 *
 * ── ⚠ Why this exists, added after the first real call ──────────────────────
 *
 * The first four tools were `resolve_person`, `get_attention_items`,
 * `search_messages` and `get_person_activity`. Between them they could not
 * answer **"what's in my inbox?"** — `search_messages` needs a keyword, and
 * "my emails" is not one.
 *
 * That is the single most natural question to ask a unified inbox, and the
 * agent had no way to serve it. It was found the only way it could be: by
 * somebody talking to the thing and asking.
 */
export async function getRecentMessages(
  supabase: SupabaseClient,
  ownerId: string,
  { channel, limit = 5 }: { channel?: string; limit?: number } = {},
): Promise<ToolResult> {
  /*
   * A word the caller said, to a channel.
   *
   * ⚠ This was a two-arm ternary covering "gmail"/"email" and "whatsapp", and
   * it did not fail loudly when meetings arrived — it fell through to `null`,
   * which means NO FILTER. So "what were my last meetings" quietly returned
   * Gmail, out loud, with no screen to catch it on. Silently ignoring a filter
   * is worse than refusing one.
   *
   * Anything still unrecognised is treated as no filter rather than as an
   * error, which was the original and correct call: the model heard a word out
   * loud, and refusing on "email" when it meant Gmail would be pedantry the
   * caller cannot see or correct.
   */
  const wanted = channel?.toLowerCase().trim();
  const type = wanted ? (HEARD_AS.get(wanted) ?? null) : null;

  let channelIds: string[] | null = null;
  if (type) {
    const { data: channelRows } = await supabase
      .from('channels')
      .select('id')
      // ⚠ THE TENANT FILTER — on the channel lookup too, not just the messages.
      .eq('owner_id', ownerId)
      .eq('type', type);

    channelIds = ((channelRows ?? []) as { id: string }[]).map((row) => row.id);

    // A filter that matched no channel must return nothing, NOT everything.
    // Falling through to an unfiltered query here would read WhatsApp messages
    // aloud to somebody who asked for Gmail.
    if (channelIds.length === 0) {
      /*
       * ⚠ A whole sentence per channel, not `No ${type} account is connected`.
       * That template produced "No meeting account is connected", which is not
       * a thing anybody says: a meeting is not an account you connect, it is
       * something that happened or did not.
       */
      return { summary: CHANNEL_SPEECH[type].missing, messages: [] };
    }
  }

  let query = supabase
    .from('messages')
    .select(
      'id, subject, body_text, sent_at, ' +
        'sender:contact_identities!messages_sender_identity_fkey(display_name, external_id), ' +
        // For `seenOn` below. Embedded rather than a second round trip.
        'channel:channels(type), ' +
        ATTACHMENTS +
        ', ' +
        AI_SUMMARY,
    )
    // ⚠ THE TENANT FILTER — on the messages, their files and their summaries.
    .eq('owner_id', ownerId)
    .eq('attachments.owner_id', ownerId)
    .eq('gist.owner_id', ownerId)
    .eq('gist.kind', 'summary')
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (channelIds) query = query.in('channel_id', channelIds);

  const { data, error } = await query;

  if (error) {
    return { summary: 'TOOL_ERROR: could not read the messages.', messages: [] };
  }

  type Row = {
    id: string;
    subject: string | null;
    body_text: string;
    sent_at: string;
    sender: { display_name: string | null; external_id: string } | null;
    channel: { type: string } | null;
    attachments?: AttachmentRow[] | null;
    gist?: GistRow[] | null;
  };

  const messages = ((data ?? []) as unknown as Row[]).map((row) => ({
    messageId: row.id,
    from: row.sender?.display_name ?? row.sender?.external_id ?? 'unknown sender',
    subject: row.subject ?? null,
    when: spokenWhen(row.sent_at),
    ...withSummary(row.gist),
    excerpt: speakable(row.body_text),
    /*
     * ⚠ Which line it came in on, spoken.
     *
     * Without this the agent reads an unfiltered list and every item sounds
     * like an email. That was survivable while two channels both delivered one
     * message from one person. It stops being survivable with meetings, where
     * "Maria said" means something different depending on whether she typed it
     * or said it in a room with other people listening.
     */
    seenOn: row.channel
      ? (CHANNEL_SPEECH[row.channel.type as ChannelType]?.label ?? null)
      : null,
    ...withFiles(row.attachments),
  }));

  if (messages.length === 0) {
    return { summary: 'There are no messages yet.', messages: [] };
  }

  // ⚠ Was a two-arm ternary ending in 'message', which would have called a
  // meeting a message. CHANNEL_SPEECH decides, once, for every channel.
  const unit = type ? CHANNEL_SPEECH[type].unit : 'message';
  return { summary: `The ${count(messages.length, unit)}, newest first.`, messages };
}

/* ─── get_files ───────────────────────────────────────────────────────────── */

/** Past this many, a spoken list loses the caller; the rest is on the Files page. */
const FILES_READ_MAX = 10;

/**
 * The files saved from mail — pictures, PDFs, documents — newest first.
 *
 * Added 2026-10-06 for "what did Bea send me?" and "my latest PDFs", which no
 * tool could answer: the Files page had them and Uriel did not (see
 * `withFiles` above).
 *
 * `personId` comes from `resolve_person`, as for `get_person_activity`, so a
 * shared name is never silently picked. `query` matches a file's NAME or its
 * email's subject.
 *
 * ⚠ Only Gmail attachments are saved (`apps/worker/src/file-sweep.ts`);
 * WhatsApp media is not, and a meeting transcript is a message, found by
 * search. ⚠ Names, kinds, who and when — never a file's contents.
 *
 * ── ⚠ Every query below filters on owner_id — see the top of this file ──────
 */
export async function getFiles(
  supabase: SupabaseClient,
  ownerId: string,
  { personId, query, limit = 6 }: { personId?: string; query?: string; limit?: number } = {},
): Promise<ToolResult> {
  const person = personId?.trim() || null;
  const needle = query?.trim() || null;

  let name: string | null = null;
  let senderIds: string[] | null = null;

  if (person) {
    if (!UUID_SHAPE.test(person)) {
      return { summary: 'TOOL_ERROR: that is not a person I can look up.', files: [] };
    }

    const { data: contactRow } = await supabase
      .from('contacts')
      .select('display_name')
      // ⚠ THE TENANT FILTER — what stops a guessed uuid resolving elsewhere.
      .eq('owner_id', ownerId)
      .eq('id', person)
      .maybeSingle();
    if (!contactRow) return { summary: 'No one by that id is in the messages.', files: [] };
    name = (contactRow as { display_name: string }).display_name;

    const { data: identityRows } = await supabase
      .from('contact_identities')
      .select('id')
      // ⚠ THE TENANT FILTER.
      .eq('owner_id', ownerId)
      .eq('contact_id', person);
    senderIds = ((identityRows ?? []) as { id: string }[]).map((row) => row.id);
    if (senderIds.length === 0) {
      return { summary: `No files from ${name}.`, person: name, files: [] };
    }
  }

  // Each word must appear (`searchWords`). Only filler — "any files?" — lists
  // the latest, rather than refusing.
  const words = needle ? searchWords(needle) : [];

  /*
   * Messages that carry a file (`!inner`), newest first. Two when searching,
   * because PostgREST cannot OR a file's columns with its email's — and the
   * email's words matter: the OpenAI credit note is `CreditNote-C9D3….pdf`,
   * and only the email around it says "refund".
   *
   * The FILE side matches a word in the file's name OR in what the file says
   * (`text_content`, 0020) — so "the quotation for three trucks" finds a PDF
   * whose name and email say neither.
   */
  const read = (match: 'file' | 'email' | null) => {
    let builder = supabase
      .from('messages')
      .select(
        'id, subject, sent_at, direction, ' +
          'sender:contact_identities!messages_sender_identity_fkey(display_name, external_id), ' +
          'attachments!inner(id, filename, mime_type, text_status)',
      )
      // ⚠ THE TENANT FILTER — on the messages and on their files.
      .eq('owner_id', ownerId)
      .eq('attachments.owner_id', ownerId);
    if (senderIds) builder = builder.in('sender_identity', senderIds);
    for (const word of match ? words : []) {
      builder =
        match === 'file'
          ? builder.or(`filename.ilike.%${word}%,text_content.ilike.%${word}%`, {
              referencedTable: 'attachments',
            })
          : builder.or(`subject.ilike.%${word}%,body_text.ilike.%${word}%`);
    }
    return builder.order('sent_at', { ascending: false }).limit(limit);
  };

  const responses = await Promise.all(
    words.length > 0 ? [read('file'), read('email')] : [read(null)],
  );
  if (responses.some((response) => response.error)) {
    return { summary: 'TOOL_ERROR: could not read the files.', files: [] };
  }

  type Row = {
    id: string;
    subject: string | null;
    sent_at: string;
    direction: 'inbound' | 'outbound';
    sender: { display_name: string | null; external_id: string } | null;
    attachments: AttachmentRow[] | null;
  };

  const byId = new Map<string, Row>();
  for (const response of responses) {
    for (const row of (response.data ?? []) as unknown as Row[]) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
  }

  const files = [...byId.values()]
    .sort((a, b) => b.sent_at.localeCompare(a.sent_at))
    .flatMap((row) =>
      (withFiles(row.attachments).files ?? []).map((file) => ({
        ...file,
        // "you" for a file you sent: `messages` records a sender, never a
        // recipient, so who it went to is not known (same as the Files page).
        from:
          row.direction === 'outbound'
            ? 'you'
            : (row.sender?.display_name ?? row.sender?.external_id ?? 'unknown sender'),
        when: spokenWhen(row.sent_at),
        subject: row.subject ?? null,
        // The email it came on, for `read_message`.
        messageId: row.id,
      })),
    )
    .slice(0, FILES_READ_MAX);

  // `words`, not `needle`: a query of only filler ("files") listed the latest,
  // and must not then be reported as "No files match files" — and a whole
  // spoken question read back as the search term sounds broken.
  const searched = words.length > 0;
  const terms = words.join(' ');
  const from = name ? ` from ${name}` : '';

  if (files.length === 0) {
    const summary = searched
      ? `No files${from} match ${terms}.`
      : name
        ? `No files from ${name}.`
        : 'No files have been saved yet.';
    return { summary, ...(name ? { person: name } : {}), files: [] };
  }

  // The count is computed HERE so the agent never has to.
  const order = files.length > 1 ? ', newest first' : '';
  const summary = searched
    ? `${count(files.length, 'file')}${from} ${files.length === 1 ? 'matches' : 'match'} ${terms}.`
    : name
      ? `${name} sent ${count(files.length, 'file')}${order}.`
      : files.length === 1
        ? 'One file has been saved.'
        : `The latest ${count(files.length, 'file')}, newest first.`;

  return { summary, ...(name ? { person: name } : {}), files };
}

/* ─── read_message ────────────────────────────────────────────────────────── */

/** Past this, a message is cut; the summary carries the rest. */
const READ_MAX_CHARS = 1500;

/**
 * One whole message: who, when, where, its summary, its text, its files, and
 * what was pulled onto the board from it.
 *
 * Added 2026-10-06. Every other tool returns a 200-character excerpt, so
 * "read me Bea's email" could only ever get its first line. `messageId` comes
 * from any other tool's results — never from the caller, who cannot see one.
 *
 * ⚠ The text is capped at 1,500 characters (`truncated: true` says so), and a
 * meeting transcript usually is. The prompt says to give the summary first and
 * offer the rest, rather than reading a newsletter aloud for three minutes.
 *
 * ── ⚠ Both reads filter on owner_id — see the top of this file ──────────────
 */
export async function readMessage(
  supabase: SupabaseClient,
  ownerId: string,
  messageId: string,
): Promise<ToolResult> {
  if (!UUID_SHAPE.test(messageId)) {
    return { summary: 'TOOL_ERROR: that is not a message I can open.' };
  }

  const [{ data, error }, { data: extractionRows }] = await Promise.all([
    supabase
      .from('messages')
      .select(
        'id, subject, body_text, sent_at, direction, ' +
          'sender:contact_identities!messages_sender_identity_fkey(display_name, external_id), ' +
          'channel:channels(type), ' +
          ATTACHMENTS,
      )
      // ⚠ THE TENANT FILTER — what stops a guessed id opening another
      // tenant's message.
      .eq('owner_id', ownerId)
      .eq('attachments.owner_id', ownerId)
      .eq('id', messageId)
      .maybeSingle(),
    supabase
      .from('extractions')
      .select('kind, status, payload')
      // ⚠ THE TENANT FILTER.
      .eq('owner_id', ownerId)
      .eq('message_id', messageId)
      .in('kind', ['summary', ...ATTENTION_KINDS]),
  ]);

  if (error) return { summary: 'TOOL_ERROR: could not open that message.' };
  if (!data) return { summary: 'That message is not in your Switchboard.' };

  type Row = {
    id: string;
    subject: string | null;
    body_text: string;
    sent_at: string;
    direction: 'inbound' | 'outbound';
    sender: { display_name: string | null; external_id: string } | null;
    channel: { type: string } | null;
    attachments?: AttachmentRow[] | null;
  };
  const row = data as unknown as Row;

  const extractions = (extractionRows ?? []) as {
    kind: string;
    status: AttentionStatus | null;
    payload: { title?: string; text?: string; starts_at?: string | null; due_at?: string | null };
  }[];

  const from =
    row.direction === 'outbound'
      ? 'you'
      : (row.sender?.display_name ?? row.sender?.external_id ?? 'unknown sender');
  const channel = row.channel
    ? (CHANNEL_SPEECH[row.channel.type as ChannelType]?.label ?? null)
    : null;
  const text = row.body_text.replace(/\s+/g, ' ').trim();
  const onTheBoard = extractions
    .filter((e) => e.kind !== 'summary' && e.payload?.title)
    .map((e) => ({
      kind: KIND_LABEL[e.kind as AttentionKind]?.toLowerCase() ?? e.kind,
      title: e.payload.title!,
      when: spokenWhen(e.payload.starts_at ?? e.payload.due_at ?? null),
      column: STATUS_LABEL[e.status ?? 'not_started'].toLowerCase(),
    }));

  return {
    summary: `From ${from}${channel ? ` on ${channel}` : ''}, ${spokenWhen(row.sent_at)}.`,
    subject: row.subject ?? null,
    ...withSummary(extractions.filter((e) => e.kind === 'summary') as GistRow[]),
    text: speakable(text, READ_MAX_CHARS),
    truncated: text.length > READ_MAX_CHARS,
    ...withFiles(row.attachments),
    ...(onTheBoard.length > 0 ? { onTheBoard } : {}),
  };
}

/* ─── get_overview ────────────────────────────────────────────────────────── */

/**
 * Switchboard at a glance: which channels are connected, how much arrived
 * today and this week, the board's columns, and how many files and contacts.
 *
 * Added 2026-10-06 for the questions no other tool could answer: "is my Gmail
 * connected?", "how many emails today?", "how's everything looking?". The
 * Channels page and the sidebar lamps had these; Uriel did not.
 *
 * ⚠ A channel in trouble is said in plain words ("needs reconnecting"), never
 * its `last_error` — that text is technical, can be long, and is not something
 * to read aloud.
 *
 * ── ⚠ Every read filters on owner_id — see the top of this file ─────────────
 */
export async function getOverview(
  supabase: SupabaseClient,
  ownerId: string,
  now: Date = new Date(),
): Promise<ToolResult> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [channels, recent, board, files, contacts] = await Promise.all([
    supabase.from('channels').select('id, type, status').eq('owner_id', ownerId),
    supabase
      .from('messages')
      .select('channel_id, sent_at')
      // ⚠ THE TENANT FILTER.
      .eq('owner_id', ownerId)
      .gte('sent_at', weekAgo)
      .limit(2000),
    supabase
      .from('extractions')
      .select('status')
      // ⚠ THE TENANT FILTER.
      .eq('owner_id', ownerId)
      .in('kind', [...ATTENTION_KINDS])
      .is('archived_at', null)
      .neq('status', 'done')
      .limit(2000),
    supabase
      .from('attachments')
      .select('id', { count: 'exact', head: true })
      // ⚠ THE TENANT FILTER.
      .eq('owner_id', ownerId),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      // ⚠ THE TENANT FILTER.
      .eq('owner_id', ownerId),
  ]);

  if (channels.error || recent.error || board.error) {
    return { summary: 'TOOL_ERROR: could not read Switchboard just now.' };
  }

  const channelRows = (channels.data ?? []) as { id: string; type: string; status: string }[];
  if (channelRows.length === 0) {
    return { summary: 'No channels are connected yet.', channels: [] };
  }

  const typeOf = new Map(channelRows.map((row) => [row.id, row.type]));
  const dayOf = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(date);
  const today = dayOf(now);

  // Per channel TYPE: two Gmail accounts are one line to a listener.
  const tally = new Map<string, { today: number; week: number }>();
  for (const row of (recent.data ?? []) as { channel_id: string; sent_at: string }[]) {
    const type = typeOf.get(row.channel_id);
    if (!type) continue;
    const counts = tally.get(type) ?? { today: 0, week: 0 };
    counts.week += 1;
    if (dayOf(new Date(row.sent_at)) === today) counts.today += 1;
    tally.set(type, counts);
  }

  const label = (type: string) => {
    const spoken = CHANNEL_SPEECH[type as ChannelType]?.label ?? type;
    return spoken === 'a meeting' ? 'Meetings' : spoken;
  };

  const channelList = channelRows.map((row) => ({
    name: label(row.type),
    state:
      row.status === 'active'
        ? 'connected'
        : row.status === 'paused'
          ? 'paused'
          : 'needs reconnecting in Channels',
  }));
  const arrived = [...new Set(channelRows.map((row) => row.type))].map((type) => ({
    channel: label(type),
    today: tally.get(type)?.today ?? 0,
    thisWeek: tally.get(type)?.week ?? 0,
  }));

  const statuses = ((board.data ?? []) as { status: AttentionStatus | null }[]).map(
    (row) => row.status ?? 'not_started',
  );
  const notStarted = statuses.filter((status) => status === 'not_started').length;
  const inProgress = statuses.filter((status) => status === 'in_progress').length;

  const troubled = channelList.filter((channel) => channel.state !== 'connected');
  const todayTotal = arrived.reduce((sum, line) => sum + line.today, 0);

  return {
    // Every number is worked out here — the agent never counts.
    summary:
      (troubled.length === 0
        ? 'Every channel is connected. '
        : `${troubled.map((c) => c.name).join(' and ')} ${troubled.length === 1 ? 'needs' : 'need'} attention. `) +
      `${count(todayTotal, 'message')} arrived today, and ${count(notStarted + inProgress, 'item')} ` +
      `${notStarted + inProgress === 1 ? 'is' : 'are'} open on the board.`,
    channels: channelList,
    arrived,
    board: { notStarted, inProgress },
    // A failed count costs the number, never the overview.
    ...(typeof files.count === 'number' ? { filesSaved: files.count } : {}),
    ...(typeof contacts.count === 'number' ? { contacts: contacts.count } : {}),
  };
}

/* ─── read_file ───────────────────────────────────────────────────────────── */

/**
 * What a saved file SAYS — a PDF's text, a recording's transcript.
 *
 * Yuri, 2026-10-06: "he cant open files though". The worker now reads every
 * saved PDF and recording, new ones within a couple of minutes of arriving
 * (`apps/worker/src/file-text.ts`, migration 0020), and this hands the result
 * to Uriel. `fileId` comes from a `files` entry in any other tool's results.
 *
 * Every state is said plainly rather than as an error: not read yet (a new
 * file, or the backlog), nothing in it (a scan, silence), too large, a picture.
 * ⚠ Pictures are NOT read — that needs a vision model, a separate decision.
 *
 * ── ⚠ The read filters on owner_id — see the top of this file ───────────────
 */
export async function readFile(
  supabase: SupabaseClient,
  ownerId: string,
  fileId: string,
): Promise<ToolResult> {
  if (!UUID_SHAPE.test(fileId)) {
    return { summary: 'TOOL_ERROR: that is not a file I can open.' };
  }

  const { data, error } = await supabase
    .from('attachments')
    .select(
      'filename, mime_type, text_status, text_kind, text_content, ' +
        'message:messages!inner(sent_at, direction, ' +
        'sender:contact_identities!messages_sender_identity_fkey(display_name, external_id))',
    )
    // ⚠ THE TENANT FILTER — what stops a guessed id reading another tenant's
    // file aloud.
    .eq('owner_id', ownerId)
    .eq('id', fileId)
    .maybeSingle();

  if (error) return { summary: 'TOOL_ERROR: could not open that file.' };
  if (!data) return { summary: 'That file is not in your Switchboard.' };

  type Row = {
    filename: string | null;
    mime_type: string | null;
    text_status: 'done' | 'empty' | 'failed' | 'too_large' | null;
    text_kind: 'pdf_text' | 'transcript' | null;
    text_content: string | null;
    message: {
      sent_at: string;
      direction: 'inbound' | 'outbound';
      sender: { display_name: string | null; external_id: string } | null;
    } | null;
  };
  const row = data as unknown as Row;

  const name = row.filename ?? 'unnamed file';
  const kind = spokenFileKind(row.mime_type, row.filename);
  const from =
    row.message?.direction === 'outbound'
      ? 'you'
      : (row.message?.sender?.display_name ?? row.message?.sender?.external_id ?? 'unknown sender');
  const about = { name, kind, from, when: spokenWhen(row.message?.sent_at ?? null) };

  if (row.text_status === 'done' && row.text_content) {
    const text = row.text_content.replace(/\s+/g, ' ').trim();
    return {
      summary:
        row.text_kind === 'transcript'
          ? `The recording, transcribed.`
          : `What the ${kind === 'a PDF' ? 'PDF' : 'file'} says.`,
      ...about,
      text: speakable(text, READ_MAX_CHARS),
      truncated: text.length > READ_MAX_CHARS,
    };
  }

  // Everything below is said, not an error: the file is there, its text is not.
  const unread =
    kind === 'a picture'
      ? 'Pictures cannot be read yet. It is on the Files page.'
      : row.text_status === 'empty'
        ? row.text_kind === 'transcript'
          ? 'There is no speech in that recording.'
          : 'There is no text in that file. It may be a scan, which cannot be read yet.'
        : row.text_status === 'too_large'
          ? 'That file is too large to read. It is on the Files page.'
          : row.text_status === 'failed'
            ? 'That file could not be read. It is on the Files page.'
            : kind === 'a PDF' || kind === 'an audio recording'
              ? 'That file has not been read yet. Try again in a few minutes.'
              : `${kind.charAt(0).toUpperCase()}${kind.slice(1)} cannot be read yet. It is on the Files page.`;

  return { summary: unread, ...about };
}

/** Exported for the route's dispatch table and for tests. */
export const VOICE_TOOLS = [
  'resolve_person',
  'get_attention_items',
  'get_recent_messages',
  'search_messages',
  'get_person_activity',
  'get_files',
  'read_message',
  'get_overview',
  'read_file',
] as const;

export type VoiceToolName = (typeof VOICE_TOOLS)[number];

export function isVoiceTool(name: unknown): name is VoiceToolName {
  return typeof name === 'string' && (VOICE_TOOLS as readonly string[]).includes(name);
}

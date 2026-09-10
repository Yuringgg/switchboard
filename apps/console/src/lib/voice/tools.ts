import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The five tools the Vapi agent can call.
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

/** "three things" — spelled out, because a numeral gets read inconsistently. */
function count(n: number, singular: string, plural = `${singular}s`): string {
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
  const word = n < words.length ? words[n] : String(n);
  return `${word} ${n === 1 ? singular : plural}`;
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

/* ─── resolve_person ──────────────────────────────────────────────────────── */

export interface ResolvedPerson {
  personId: string;
  name: string;
  /** "Gmail and WhatsApp" — what the agent can say to tell two people apart. */
  seenOn: string;
  lastHeardFrom: string;
}

/**
 * Turn a spoken name into a specific person.
 *
 * ⚠ Returning MORE THAN ONE is a correct and expected outcome, not a failure.
 * Ms. Maria's requirement is that two people with the same first name are told
 * apart, and the agent's prompt says never to pick one silently. This returns
 * every match and lets the agent ask.
 */
export async function resolvePerson(
  supabase: SupabaseClient,
  ownerId: string,
  name: string,
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
    .select('id, display_name')
    // ⚠ THE TENANT FILTER. Without it this returns every user's contacts.
    .eq('owner_id', ownerId)
    .ilike('display_name', `%${escaped}%`)
    .limit(10);

  if (error) {
    return { summary: 'TOOL_ERROR: could not look that person up.', matches: [] };
  }

  const contacts = (data ?? []) as { id: string; display_name: string }[];
  if (contacts.length === 0) {
    return { summary: `No one called ${needle} is in the messages.`, matches: [] };
  }

  const matches: ResolvedPerson[] = [];
  for (const contact of contacts) {
    const { data: identityRows } = await supabase
      .from('contact_identities')
      .select('channel_type')
      .eq('owner_id', ownerId)
      .eq('contact_id', contact.id);

    const channels = [
      ...new Set(
        ((identityRows ?? []) as { channel_type: string }[]).map((row) =>
          row.channel_type === 'gmail' ? 'Gmail' : 'WhatsApp',
        ),
      ),
    ];

    const { data: lastRows } = await supabase
      .from('messages')
      .select('sent_at, sender_identity!inner(contact_id)')
      .eq('owner_id', ownerId)
      .eq('sender_identity.contact_id', contact.id)
      .order('sent_at', { ascending: false })
      .limit(1);

    const last = (lastRows ?? [])[0] as { sent_at: string } | undefined;

    matches.push({
      personId: contact.id,
      name: contact.display_name,
      seenOn: channels.join(' and ') || 'no channel',
      lastHeardFrom: last ? spokenWhen(last.sent_at) : 'never',
    });
  }

  if (matches.length === 1) {
    return { summary: `One match: ${matches[0]!.name}.`, matches };
  }

  return {
    summary:
      `${count(matches.length, 'person', 'people')} match that name. ` +
      'Ask which one before going further.',
    matches,
  };
}

/* ─── get_attention_items ─────────────────────────────────────────────────── */

/**
 * What needs this person's attention.
 *
 * ⚠ Reads only cards still ON the board — not archived, not done. Somebody who
 * archived a card has said they are finished with it, and reading it back to
 * them down the phone would undo the one gesture the board exists to support.
 */
export async function getAttentionItems(
  supabase: SupabaseClient,
  ownerId: string,
  { limit = 20 }: { limit?: number } = {},
): Promise<ToolResult> {
  const { data, error } = await supabase
    .from('extractions')
    .select('kind, status, payload, message:messages!extractions_message_id_fkey(sent_at)')
    // ⚠ THE TENANT FILTER.
    .eq('owner_id', ownerId)
    .in('kind', ['meeting', 'commitment', 'action_item', 'question'])
    // ⚠ `is`, not `eq(..., null)` — PostgREST turns `eq` into `= null`, which
    // matches nothing and would silently report an empty board. Same trap
    // `fetchAttention` documents.
    .is('archived_at', null)
    .neq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return { summary: 'TOOL_ERROR: could not read the attention board.', items: [] };
  }

  type Row = {
    kind: string;
    payload: { title?: string; quote?: string; starts_at?: string | null; due_at?: string | null };
  };

  const items = ((data ?? []) as Row[]).map((row) => ({
    kind: row.kind.replace(/_/g, ' '),
    title: row.payload?.title ?? 'untitled',
    when: spokenWhen(row.payload?.starts_at ?? row.payload?.due_at ?? null),
    quote: speakable(row.payload?.quote ?? ''),
  }));

  if (items.length === 0) {
    return { summary: 'Nothing is on the attention board right now.', items: [] };
  }

  return {
    // The count is computed HERE so the agent never has to. See the note at the
    // top of this file.
    summary: `${count(items.length, 'item')} need attention.`,
    items,
  };
}

/* ─── search_messages ─────────────────────────────────────────────────────── */

/**
 * Find messages across the connected channels.
 *
 * ⚠ Gmail and WhatsApp only. There are no transcripts in this system — the
 * agent's prompt says so too, and both have to stay true together.
 */
export async function searchMessagesForVoice(
  supabase: SupabaseClient,
  ownerId: string,
  query: string,
  { limit = 5 }: { limit?: number } = {},
): Promise<ToolResult> {
  const needle = query.trim();
  if (!needle) return { summary: 'No search term was given.', results: [] };

  const escaped = needle.replace(/[\\%_]/g, (char) => `\\${char}`);

  /*
   * ⚠ Plain `ilike`, NOT the `search_messages` RPC the console uses.
   *
   * That function is `SECURITY INVOKER` and takes no owner argument — it relies
   * entirely on RLS, which is inert for this client. Calling it here would
   * search every tenant's mail. An owner-filtered `ilike` is less clever and it
   * is correct; the ranked full-text path can come back the day the RPC learns
   * to take an explicit owner.
   */
  const { data, error } = await supabase
    .from('messages')
    .select(
      'subject, body_text, sent_at, ' +
        'sender:contact_identities!messages_sender_identity_fkey(display_name, external_id)',
    )
    // ⚠ THE TENANT FILTER.
    .eq('owner_id', ownerId)
    .or(`subject.ilike.%${escaped}%,body_text.ilike.%${escaped}%`)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) {
    return { summary: 'TOOL_ERROR: could not search the messages.', results: [] };
  }

  type Row = {
    subject: string | null;
    body_text: string;
    sent_at: string;
    sender: { display_name: string | null; external_id: string } | null;
  };

  // Through `unknown`: the embedded `sender` select makes PostgREST's generated
  // type an error union that does not overlap with the row shape, so a direct
  // cast is rejected.
  const results = ((data ?? []) as unknown as Row[]).map((row) => ({
    from: row.sender?.display_name ?? row.sender?.external_id ?? 'unknown sender',
    subject: row.subject ?? null,
    when: spokenWhen(row.sent_at),
    excerpt: speakable(row.body_text),
  }));

  if (results.length === 0) {
    return { summary: `Nothing mentions ${needle}.`, results: [] };
  }

  return { summary: `${count(results.length, 'message')} mention ${needle}.`, results };
}

/* ─── get_person_activity ─────────────────────────────────────────────────── */

/**
 * What one person has been in touch about.
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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personId)) {
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

  const { data, error } = await supabase
    .from('messages')
    .select(
      'subject, body_text, sent_at, sender_identity!inner(contact_id)',
    )
    .eq('owner_id', ownerId)
    .eq('sender_identity.contact_id', personId)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) {
    return { summary: `TOOL_ERROR: could not read messages from ${name}.`, messages: [] };
  }

  type Row = { subject: string | null; body_text: string; sent_at: string };

  // Through `unknown`: the `!inner` embed makes PostgREST's generated type an
  // error union that does not overlap with the row shape, so a direct cast is
  // rejected. Same shape the other fetchers use for embedded selects.
  const messages = ((data ?? []) as unknown as Row[]).map((row) => ({
    subject: row.subject ?? null,
    when: spokenWhen(row.sent_at),
    excerpt: speakable(row.body_text),
  }));

  if (messages.length === 0) {
    return { summary: `Nothing from ${name} yet.`, person: name, messages: [] };
  }

  return {
    summary: `${count(messages.length, 'message')} from ${name}.`,
    person: name,
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
   * "gmail" and "whatsapp" are the only channels that exist (CHANNEL_TYPES).
   * Anything else is treated as no filter rather than as an error — the model
   * heard a word out loud, and refusing on "email" when it meant Gmail would be
   * pedantry the caller cannot see or correct.
   */
  const wanted = channel?.toLowerCase().trim();
  const type = wanted === 'gmail' || wanted === 'email' ? 'gmail'
    : wanted === 'whatsapp' ? 'whatsapp'
    : null;

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
      return { summary: `No ${type} account is connected.`, messages: [] };
    }
  }

  let query = supabase
    .from('messages')
    .select(
      'subject, body_text, sent_at, ' +
        'sender:contact_identities!messages_sender_identity_fkey(display_name, external_id)',
    )
    // ⚠ THE TENANT FILTER.
    .eq('owner_id', ownerId)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (channelIds) query = query.in('channel_id', channelIds);

  const { data, error } = await query;

  if (error) {
    return { summary: 'TOOL_ERROR: could not read the messages.', messages: [] };
  }

  type Row = {
    subject: string | null;
    body_text: string;
    sent_at: string;
    sender: { display_name: string | null; external_id: string } | null;
  };

  const messages = ((data ?? []) as unknown as Row[]).map((row) => ({
    from: row.sender?.display_name ?? row.sender?.external_id ?? 'unknown sender',
    subject: row.subject ?? null,
    when: spokenWhen(row.sent_at),
    excerpt: speakable(row.body_text),
  }));

  if (messages.length === 0) {
    return { summary: 'There are no messages yet.', messages: [] };
  }

  const label = type === 'gmail' ? 'Gmail message' : type === 'whatsapp' ? 'WhatsApp message' : 'message';
  return { summary: `The ${count(messages.length, label)}, newest first.`, messages };
}

/** Exported for the route's dispatch table and for tests. */
export const VOICE_TOOLS = [
  'resolve_person',
  'get_attention_items',
  'get_recent_messages',
  'search_messages',
  'get_person_activity',
] as const;

export type VoiceToolName = (typeof VOICE_TOOLS)[number];

export function isVoiceTool(name: unknown): name is VoiceToolName {
  return typeof name === 'string' && (VOICE_TOOLS as readonly string[]).includes(name);
}

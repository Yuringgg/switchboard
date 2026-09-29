import type { SupabaseClient } from '@supabase/supabase-js';

import { AFFILIATION_KIND, type BriefRow } from './brief';
import { assembleClues, sameNameGroups, tellApart, type Clue } from './tell-apart';

/**
 * Contacts — one person, however many handles they have (US-5).
 *
 * ── What makes this worth a screen ───────────────────────────────────────────
 *
 * `docs/01-PRODUCT-SPEC.md` §1 names it as one of the three problems the
 * product exists for: *"There's no cross-channel picture of a person. The same
 * client is a phone number in one app and an email address in another, with no
 * link between them."* `contact_identities` is that link, and this is the view
 * that shows it.
 *
 * ⚠ Today the corpus is Gmail-only, so almost every contact has exactly one
 * identity and the merge is invisible. That is a state of the data, not of the
 * feature — the moment a WhatsApp number is provisioned, a contact with two
 * identities renders here as one person with two channels. **Do not "simplify"
 * this by collapsing identities into the contact row**; the plural is the point,
 * and it is what step 5 of the demo sequence turns on.
 */

export interface ContactIdentity {
  id: string;
  channelType: string;
  externalId: string;
  displayName: string | null;
}

export interface ContactSummary {
  id: string;
  displayName: string;
  identities: ContactIdentity[];
  messageCount: number;
  lastMessageAt: string | null;
  /**
   * Set only when another contact has the SAME name: how many share it, and
   * the one clue that tells this one apart (`lib/tell-apart.ts`). A null clue
   * means nothing in the messages does, and the screen says so.
   */
  sameName?: { count: number; clue: Clue | null };
}

interface IdentityRow {
  id: string;
  contact_id: string | null;
  channel_type: string;
  external_id: string;
  display_name: string | null;
}

/**
 * The contact list.
 *
 * ── Why this is two queries and not one ──────────────────────────────────────
 *
 * A single query with a nested embed would give contacts → identities →
 * messages, and PostgREST would happily return every message body in the
 * corpus to render a count. These are **other people's private messages**
 * (`docs/02-ARCHITECTURE.md` §6) and this screen shows none of them, so it does
 * not ask for them: one query for identities, one for the message stamps, and
 * the counting happens here.
 *
 * ⚠ RLS scopes both, so there is no `owner_id` filter — adding one would imply
 * the policy might not be doing its job.
 */
export async function fetchContacts(
  supabase: SupabaseClient,
  { limit = 200 }: { limit?: number } = {},
): Promise<{ contacts: ContactSummary[]; error: string | null }> {
  try {
    const { data: contactRows, error: contactError } = await supabase
      .from('contacts')
      .select('id, display_name, notes')
      .limit(limit);

    if (contactError) return { contacts: [], error: contactError.message };

    const contacts = (contactRows ?? []) as {
      id: string;
      display_name: string;
      notes: string | null;
    }[];
    if (contacts.length === 0) return { contacts: [], error: null };

    const { data: identityRows, error: identityError } = await supabase
      .from('contact_identities')
      .select('id, contact_id, channel_type, external_id, display_name');

    if (identityError) return { contacts: [], error: identityError.message };

    const identities = (identityRows ?? []) as IdentityRow[];

    /*
     * ⚠ Stamps, a subject and a thread id — deliberately no `body_text`.
     *
     * The list needs a count and a most-recent stamp, and a same-name clue
     * needs the subject of somebody's newest message and which threads are
     * theirs. Selecting bodies for any of that would pull the whole corpus into
     * a page that renders none of it, which is the quiet over-fetch §6 is about.
     */
    const { data: messageRows, error: messageError } = await supabase
      .from('messages')
      .select('sender_identity, sent_at, subject, conversation_id')
      .not('sender_identity', 'is', null);

    if (messageError) return { contacts: [], error: messageError.message };

    const sentRows = (messageRows ?? []) as {
      sender_identity: string;
      sent_at: string;
      subject: string | null;
      conversation_id: string | null;
    }[];

    const stats = new Map<string, { count: number; last: string | null }>();
    for (const row of sentRows) {
      const current = stats.get(row.sender_identity) ?? { count: 0, last: null };
      current.count += 1;
      if (!current.last || row.sent_at > current.last) current.last = row.sent_at;
      stats.set(row.sender_identity, current);
    }

    const byContact = new Map<string, ContactIdentity[]>();
    for (const identity of identities) {
      if (!identity.contact_id) continue;
      const list = byContact.get(identity.contact_id) ?? [];
      list.push({
        id: identity.id,
        channelType: identity.channel_type,
        externalId: identity.external_id,
        displayName: identity.display_name,
      });
      byContact.set(identity.contact_id, list);
    }

    const summaries = contacts.map((contact) => {
      const own = byContact.get(contact.id) ?? [];
      let count = 0;
      let last: string | null = null;

      for (const identity of own) {
        const stat = stats.get(identity.id);
        if (!stat) continue;
        count += stat.count;
        if (stat.last && (!last || stat.last > last)) last = stat.last;
      }

      const summary: ContactSummary = {
        id: contact.id,
        displayName: contact.display_name,
        identities: own,
        messageCount: count,
        lastMessageAt: last,
      };
      return summary;
    });

    /*
     * ── Same name, different people ─────────────────────────────────────────
     *
     * Ms. Maria's research task 4. Only contacts whose name another contact
     * also has get a clue, so a list of distinct names reads exactly as before
     * — and the affiliation reads happen only when there is a group to score.
     */
    const groups = sameNameGroups(summaries);
    if (groups.length > 0) {
      const grouped = new Set(groups.flat().map((c) => c.id));
      const notesById = new Map(contacts.map((c) => [c.id, c.notes]));
      const groupedIdentities = identities.filter(
        (i) => i.contact_id !== null && grouped.has(i.contact_id),
      );
      const groupedIdentityIds = new Set(groupedIdentities.map((i) => i.id));

      const clues = assembleClues({
        contacts: groups.flat().map((c) => ({
          id: c.id,
          displayName: c.displayName,
          notes: notesById.get(c.id) ?? null,
        })),
        identities: groupedIdentities.map((i) => ({
          id: i.id,
          contactId: i.contact_id,
          channelType: i.channel_type,
          externalId: i.external_id,
          displayName: i.display_name,
        })),
        sent: sentRows
          .filter((m) => groupedIdentityIds.has(m.sender_identity))
          .map((m) => ({
            senderIdentity: m.sender_identity,
            subject: m.subject,
            sentAt: m.sent_at,
            conversationId: m.conversation_id,
          })),
        // A failed read costs the company clue, never the list.
        affiliations: await fetchAffiliations(supabase).catch(() => []),
      });

      const cluesById = new Map(clues.map((c) => [c.id, c]));
      for (const group of groups) {
        const scored = tellApart(group.flatMap((c) => cluesById.get(c.id) ?? []));
        for (const contact of group) {
          contact.sameName = { count: group.length, clue: scored.get(contact.id) ?? null };
        }
      }
    }

    /*
     * Most recently heard from first, and **contacts with no messages last**
     * rather than hidden.
     *
     * A contact row exists the moment an identity is resolved, so one with zero
     * messages is a real state — and a list that silently omitted them would
     * disagree with the count on the page above it.
     */
    summaries.sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt) {
        return b.lastMessageAt.localeCompare(a.lastMessageAt);
      }
      if (a.lastMessageAt) return -1;
      if (b.lastMessageAt) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    return { contacts: summaries, error: null };
  } catch (cause) {
    return {
      contacts: [],
      error: cause instanceof Error ? cause.message : 'Contacts are unavailable.',
    };
  }
}

/**
 * Affiliation rows with the thread each one's message is in — the evidence
 * behind a company clue.
 *
 * ⚠ RLS scopes both reads, so there is no `owner_id` filter, as everywhere else
 * in this file. The voice path has its own owner-filtered copy in
 * `lib/voice/tools.ts`, deliberately: the two security models never share a
 * query. Bounded by how many affiliation rows exist, not by the corpus.
 */
export async function fetchAffiliations(
  supabase: SupabaseClient,
): Promise<{ row: BriefRow; conversationId: string | null }[]> {
  const { data: rows, error } = await supabase
    .from('extractions')
    .select('id, kind, model, message_id, payload')
    .eq('kind', AFFILIATION_KIND)
    // ⚠ `is`, never `eq(…, null)` — see `fetchContactBrief`.
    .is('archived_at', null)
    .limit(500);
  if (error) return [];

  const extractions = (rows ?? []) as {
    id: string;
    kind: string;
    model: string;
    message_id: string;
    payload: BriefRow['payload'] | null;
  }[];
  if (extractions.length === 0) return [];

  type MessageRow = {
    id: string;
    sent_at: string;
    channel_id: string;
    conversation_id: string | null;
  };
  const messages = new Map<string, MessageRow>();
  const ids = [...new Set(extractions.map((e) => e.message_id))];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase
      .from('messages')
      .select('id, sent_at, channel_id, conversation_id')
      .in('id', ids.slice(i, i + 100));
    for (const m of (data ?? []) as MessageRow[]) messages.set(m.id, m);
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

export interface ContactDetail {
  id: string;
  displayName: string;
  notes: string | null;
  identities: ContactIdentity[];
}

/**
 * One contact, and the conversations they appear in.
 *
 * ── ⚠ Why the history is CONVERSATIONS, not "messages they sent" ─────────────
 *
 * `messages` records a sender and no recipients (`docs/02-ARCHITECTURE.md` §3),
 * so "messages from this person" is a half-record: it shows their side of a
 * thread and drops the reader's replies. US-5 asks for *"every conversation
 * I've had with that person, across all channels, merged"* — so the query
 * resolves their identities to the conversations those messages sit in, then
 * returns every message in them.
 *
 * The cost is that a group thread shows other people's messages too. That is
 * correct for a conversation view and it is what makes a reply legible; the
 * alternative reads as a monologue.
 */
export async function fetchContactDetail(
  supabase: SupabaseClient,
  contactId: string,
): Promise<{
  contact: ContactDetail | null;
  messages: {
    id: string;
    direction: string;
    subject: string | null;
    body_text: string;
    sent_at: string;
    channel_id: string;
    sender: { external_id: string; display_name: string | null } | null;
  }[];
  error: string | null;
}> {
  // Reject a non-uuid before it reaches Postgres: PostgREST answers a malformed
  // uuid with a 400 naming the column and type, which is a worse thing to
  // render than "not found". Same guard as `fetchMessage`.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactId)) {
    return { contact: null, messages: [], error: null };
  }

  try {
    const { data: contactRow, error: contactError } = await supabase
      .from('contacts')
      .select('id, display_name, notes')
      .eq('id', contactId)
      // `maybeSingle`, not `single`: no row is an ordinary outcome here (a bad
      // id, or someone else's contact — RLS makes those indistinguishable, and
      // that is right), and `single` reports it as an error.
      // ⚠ It has to come LAST — it returns a builder with no filters on it.
      .maybeSingle();

    if (contactError) return { contact: null, messages: [], error: contactError.message };
    if (!contactRow) return { contact: null, messages: [], error: null };

    const { data: identityRows, error: identityError } = await supabase
      .from('contact_identities')
      .select('id, contact_id, channel_type, external_id, display_name')
      .eq('contact_id', contactId);

    if (identityError) return { contact: null, messages: [], error: identityError.message };

    const identities = ((identityRows ?? []) as IdentityRow[]).map((row) => ({
      id: row.id,
      channelType: row.channel_type,
      externalId: row.external_id,
      displayName: row.display_name,
    }));

    const contact: ContactDetail = {
      id: (contactRow as { id: string }).id,
      displayName: (contactRow as { display_name: string }).display_name,
      notes: (contactRow as { notes: string | null }).notes,
      identities,
    };

    if (identities.length === 0) return { contact, messages: [], error: null };

    // Which conversations did they take part in?
    const { data: theirs, error: theirsError } = await supabase
      .from('messages')
      .select('conversation_id')
      .in(
        'sender_identity',
        identities.map((i) => i.id),
      )
      .not('conversation_id', 'is', null);

    if (theirsError) return { contact, messages: [], error: theirsError.message };

    const conversationIds = [
      ...new Set(
        ((theirs ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id),
      ),
    ];

    if (conversationIds.length === 0) return { contact, messages: [], error: null };

    const { data: messageRows, error: messageError } = await supabase
      .from('messages')
      .select(
        'id, direction, subject, body_text, sent_at, channel_id, ' +
          'sender:contact_identities!messages_sender_identity_fkey(external_id, display_name)',
      )
      .in('conversation_id', conversationIds)
      .order('sent_at', { ascending: false })
      // Bounded for the same reason the timeline is: every body here is
      // serialised into the page whether or not its row is opened.
      .limit(50);

    if (messageError) return { contact, messages: [], error: messageError.message };

    const messages = ((messageRows ?? []) as unknown as {
      id: string;
      direction: string;
      subject: string | null;
      body_text: string;
      sent_at: string;
      channel_id: string;
      sender:
        | { external_id: string; display_name: string | null }
        | { external_id: string; display_name: string | null }[]
        | null;
    }[]).map((row) => ({
      ...row,
      sender: Array.isArray(row.sender) ? (row.sender[0] ?? null) : row.sender,
    }));

    return { contact, messages, error: null };
  } catch (cause) {
    return {
      contact: null,
      messages: [],
      // Never include the payload: this query returns real message bodies. §6.
      error: cause instanceof Error ? cause.message : 'That contact is unavailable.',
    };
  }
}

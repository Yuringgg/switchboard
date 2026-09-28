import { AFFILIATION_KIND, nameTokens, rollUpAffiliations, type BriefRow } from './brief';

/**
 * Telling apart people who share a name.
 *
 * Ms. Maria's research task 4, *"Per-Person Personalization: design logic to
 * differentiate individuals with identical names based on project context."*
 * Two Marias is the easy case. The real one is seven, and a voice agent that
 * reads seven names aloud has already lost the caller.
 *
 * ── The idea: one clue per person, the one nobody else in the group has ─────
 *
 * Every person gets the single most reliable thing that is TRUE OF THEM AND OF
 * NOBODY ELSE WITH THAT NAME, picked in this order:
 *
 *   1. `name`     their full name, when that alone differs ("Maria Cruz")
 *   2. `note`     the reader's own note on the contact — typed by a person, so
 *                 it beats anything inferred
 *   3. `company`  from the brief, and only when the extraction NAMES them
 *                 (ADR-028) — never from whoever happened to send the message
 *   4. `domain`   the work domain they email from; free mail says nothing
 *   5. `topic`    the subject of the newest message they sent
 *   6. `channel`  which lines they write on
 *   7. `last`     the day they last wrote
 *
 * ⚠ A clue is RELATIVE to the group. "At Acme" tells two Marias apart only if
 * the other one is not also at Acme, so the same person can get a different
 * clue in a different group. That is why this takes the whole group, and why a
 * narrowed group is re-scored rather than reusing the old clues.
 *
 * ⚠ When nothing differs, the answer is `null` — said as "these cannot be told
 * apart", never a guess. Two contacts with the same name, domain, subject and
 * day are indistinguishable from the messages, and the fix is a note, not a
 * cleverer heuristic.
 *
 * No I/O in this file. The voice path (service role, owner filtered by hand)
 * and the console (RLS) fetch the same shapes with opposite security models,
 * and `lib/voice/tools.ts` explains why their queries are never shared. What is
 * shared is this: the deciding.
 */

export type ClueKind = 'name' | 'note' | 'company' | 'domain' | 'topic' | 'channel' | 'last';

export const CLUE_ORDER: readonly ClueKind[] = [
  'name',
  'note',
  'company',
  'domain',
  'topic',
  'channel',
  'last',
];

export interface Clue {
  kind: ClueKind;
  /** The value itself: a company, a domain, a subject, an ISO time for `last`. */
  value: string;
  /** For `company`, their role there, when the same row states it. */
  detail?: string | null;
}

export interface PersonClues {
  id: string;
  name: string;
  /** First line of the reader's note on the contact. */
  note: string | null;
  company: string | null;
  role: string | null;
  /** Work domains, registrable form (`mapua.edu.ph`, not `mymail.mapua.edu.ph`). */
  domains: string[];
  /** Subject of the newest message they sent that has one. */
  topic: string | null;
  /** Channel types they write on, sorted. */
  channels: string[];
  lastAt: string | null;
}

/**
 * The longest note a contact can carry: room for "Designer at Acme, the Q3
 * website project", short enough that its first line is still sayable.
 *
 * ⚠ Here, not in `contact-note.tsx`: a constant exported from a 'use client'
 * file arrives in a server component as a client reference, not a number, and
 * the server action validates against it.
 */
export const NOTE_MAX = 280;

/* ─── Small parsers ───────────────────────────────────────────────────────── */

/**
 * Providers anyone can sign up to. `maria@gmail.com` says nothing about which
 * Maria — every Maria has one.
 */
const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.com.ph',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'zoho.com',
]);

/** Second levels that sit under a country code: `acme.co.uk`, `mapua.edu.ph`. */
const COUNTRY_SECOND_LEVEL = new Set(['com', 'co', 'edu', 'gov', 'org', 'net', 'ac']);

/**
 * The work domain of an address, or null.
 *
 * ⚠ Registrable form, so `tm.openai.com` and `email.openai.com` are ONE
 * company. Subdomains are how a sender routes mail, not who they are; counting
 * them would "tell apart" two people at the same firm by their mail server.
 */
export function workDomain(address: string | null | undefined): string | null {
  if (!address) return null;
  const at = address.lastIndexOf('@');
  if (at < 0) return null;

  const host = address
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/[>\s].*$/, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;

  const [second, top] = labels.slice(-2) as [string, string];
  const keep = top.length === 2 && COUNTRY_SECOND_LEVEL.has(second) && labels.length >= 3 ? 3 : 2;
  const domain = labels.slice(-keep).join('.');

  return FREE_MAIL.has(domain) ? null : domain;
}

/**
 * The first line of a note, short enough to say.
 *
 * ⚠ Cut on a word boundary, the same reason `speakable` does: a word severed
 * mid-way is read aloud as a mispronunciation.
 */
export function noteLabel(notes: string | null | undefined, max = 60): string | null {
  const line = (notes ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
}

/** Manila calendar day — the only sense in which "last wrote" is a day. */
function manilaDay(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(at);
}

const norm = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

/** Every value a person holds for one kind of clue, normalised for comparing. */
function valuesOf(person: PersonClues, kind: ClueKind): { key: string; clue: Clue }[] {
  const one = (value: string | null | undefined, detail?: string | null) =>
    value?.trim() ? [{ key: norm(value), clue: { kind, value: value.trim(), detail } }] : [];

  switch (kind) {
    case 'name':
      return one(person.name);
    case 'note':
      return one(person.note);
    case 'company':
      return one(person.company, person.role);
    case 'domain':
      return person.domains.flatMap((domain) => one(domain));
    case 'topic':
      return one(person.topic);
    case 'channel':
      // ⚠ One value PER channel, not the set joined. Joined, "gmail" and
      // "gmail+whatsapp" differ, and the Gmail-only person would be called
      // "the one on Gmail" when both of them are on Gmail.
      return person.channels.flatMap((channel) => one(channel));
    case 'last':
      return person.lastAt ? [{ key: manilaDay(person.lastAt), clue: { kind, value: person.lastAt } }] : [];
  }
}

/* ─── The deciding ────────────────────────────────────────────────────────── */

/**
 * One clue per person: the first, in `CLUE_ORDER`, that nobody else in the
 * group shares. `null` when every clue they have is shared.
 *
 * A group of one has nobody to be told apart from, so it gets the most useful
 * thing to SAY about them instead — "Maria Santos, at Acme" confirms the right
 * person was found — skipping `name`, which the caller has just heard.
 */
export function tellApart(people: PersonClues[]): Map<string, Clue | null> {
  const result = new Map<string, Clue | null>();

  if (people.length === 1) {
    const [only] = people as [PersonClues];
    const kind = CLUE_ORDER.filter((k) => k !== 'name').find((k) => valuesOf(only, k).length);
    result.set(only.id, kind ? valuesOf(only, kind)[0]!.clue : null);
    return result;
  }

  for (const person of people) {
    let found: Clue | null = null;

    for (const kind of CLUE_ORDER) {
      const others = new Set(
        people.filter((p) => p.id !== person.id).flatMap((p) => valuesOf(p, kind).map((v) => v.key)),
      );
      const own = valuesOf(person, kind).find((v) => !others.has(v.key));
      if (own) {
        found = own.clue;
        break;
      }
    }

    result.set(person.id, found);
  }

  return result;
}

/**
 * A clue as words.
 *
 * `name` is the empty string on purpose: the name is already being said, and
 * "Maria Cruz, named Maria Cruz" is what the model would otherwise produce.
 */
export function phraseClue(
  clue: Clue,
  { channelLabel, day }: { channelLabel: (type: string) => string; day: (iso: string) => string },
): string {
  switch (clue.kind) {
    case 'name':
      return '';
    case 'note':
      return `your note says “${clue.value}”`;
    case 'company':
      return clue.detail ? `${clue.detail} at ${clue.value}` : `at ${clue.value}`;
    case 'domain':
      return `emails from ${clue.value}`;
    case 'topic':
      return `last wrote about “${clue.value}”`;
    case 'channel':
      // A meeting is something you were in, not a line somebody writes on.
      return clue.value === 'meeting' ? 'heard in a meeting' : `on ${channelLabel(clue.value)}`;
    case 'last':
      return `last wrote ${day(clue.value)}`;
  }
}

/* ─── Narrowing by what the caller said ───────────────────────────────────── */

/** Words that carry no clue in "the one from Acme who wrote about the website". */
const FILLER = new Set([
  'the', 'one', 'from', 'about', 'at', 'who', 'with', 'in', 'on', 'of', 'and',
  'or', 'for', 'to', 'that', 'is', 'was', 'sent', 'said', 'named', 'called',
  'works', 'work', 'email', 'emails', 'emailed', 'wrote', 'messaged', 'my', 'me',
  'her', 'his', 'their', 'she', 'he', 'they', 'a', 'an', 'it', 'this',
]);

/**
 * The words of a spoken hint worth matching, at most four.
 *
 * ⚠ Letters and digits only. These go into a PostgREST `or()` filter, where a
 * comma or a parenthesis is syntax — so anything that is not part of a word is
 * removed, not escaped.
 */
export function hintWords(hint: string | null | undefined): string[] {
  const words = (hint ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !FILLER.has(w));
  return [...new Set(words)].slice(0, 4);
}

/** Everything known about a person that a hint could be matching, as one string. */
export function clueText(person: PersonClues): string {
  return norm(
    [
      person.name,
      person.note,
      person.company,
      person.role,
      ...person.domains,
      person.topic,
      ...person.channels,
    ]
      .filter(Boolean)
      .join(' · '),
  );
}

/**
 * Who is left once the caller has said something about them.
 *
 * A person survives when EVERY word is found — in what is known about them, or
 * in their conversations (`inMessages`, word → person ids, looked up by the
 * caller with its own tenant rule).
 */
export function narrowByHint(
  people: PersonClues[],
  words: string[],
  inMessages: Map<string, Set<string>> = new Map(),
): PersonClues[] {
  if (words.length === 0) return people;
  return people.filter((person) => {
    const text = clueText(person);
    return words.every((word) => text.includes(word) || inMessages.get(word)?.has(person.id));
  });
}

/* ─── Assembly from rows ──────────────────────────────────────────────────── */

export interface ClueInput {
  contacts: { id: string; displayName: string; notes: string | null }[];
  identities: {
    id: string;
    contactId: string | null;
    channelType: string;
    externalId: string;
    displayName: string | null;
  }[];
  /** Messages SENT by those identities. No body. */
  sent: {
    senderIdentity: string | null;
    subject: string | null;
    sentAt: string;
    conversationId: string | null;
  }[];
  /** Affiliation rows, each with the conversation its message belongs to. */
  affiliations: { row: BriefRow; conversationId: string | null }[];
}

/**
 * Rows in, clues out. Tolerant of partial rows: a failed side query leaves a
 * clue missing, never the person.
 */
export function assembleClues(input: ClueInput): PersonClues[] {
  const identityOwner = new Map<string, string>();
  const byContact = new Map<string, ClueInput['identities']>();
  for (const identity of input.identities) {
    if (!identity?.contactId || !identity.id) continue;
    identityOwner.set(identity.id, identity.contactId);
    byContact.set(identity.contactId, [...(byContact.get(identity.contactId) ?? []), identity]);
  }

  const sentBy = new Map<string, ClueInput['sent']>();
  for (const message of input.sent) {
    const contactId = message?.senderIdentity ? identityOwner.get(message.senderIdentity) : undefined;
    if (!contactId) continue;
    sentBy.set(contactId, [...(sentBy.get(contactId) ?? []), message]);
  }

  return input.contacts.map((contact) => {
    const identities = byContact.get(contact.id) ?? [];
    const sent = [...(sentBy.get(contact.id) ?? [])].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    const conversations = new Set(sent.map((m) => m.conversationId).filter(Boolean));

    // ⚠ ADR-028: only rows from their conversations, and only rolled up when the
    // row's title NAMES them. `rollUpAffiliations` enforces the second half.
    const rows = input.affiliations
      .filter((a) => a.row?.kind === AFFILIATION_KIND && a.conversationId && conversations.has(a.conversationId))
      .map((a) => a.row);
    const { facts } = rollUpAffiliations(
      rows,
      nameTokens([contact.displayName, ...identities.map((i) => i.displayName)]),
    );

    return {
      id: contact.id,
      name: contact.displayName,
      note: noteLabel(contact.notes),
      company: facts.company?.value ?? null,
      role: facts.role?.value ?? null,
      domains: [...new Set(identities.map((i) => workDomain(i.externalId)).filter((d): d is string => !!d))],
      topic: sent.find((m) => m.subject?.trim())?.subject?.trim() ?? null,
      channels: [...new Set(identities.map((i) => i.channelType))].sort(),
      lastAt: sent[0]?.sentAt ?? null,
    };
  });
}

/** Contacts grouped by the name a person would say, for the console list. */
export function sameNameGroups<T extends { id: string; displayName: string }>(items: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = norm(item.displayName);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

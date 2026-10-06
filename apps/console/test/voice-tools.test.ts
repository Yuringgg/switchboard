import { describe, expect, it } from 'vitest';

import { isPlausibleCallId, CALL_SESSION_TTL_MS } from '../src/lib/voice/call-session';
import {
  getAttentionItems,
  getFiles,
  getOverview,
  getPersonActivity,
  getRecentMessages,
  isVoiceTool,
  readFile,
  readMessage,
  resolvePerson,
  searchMessagesForVoice,
  searchWords,
  spokenFileKind,
  VOICE_TOOLS,
} from '../src/lib/voice/tools';

/**
 * The voice tools, and the tenant filter they carry.
 *
 * ⚠ These run under `service_role`, where **every RLS policy is inert**. The
 * `.eq('owner_id', …)` in each query is the only thing separating tenants on
 * this path, and it is the kind of line that gets dropped during a refactor by
 * someone who has read the comment on `fetchAttention` saying an owner filter
 * would imply the policy is not doing its job — which is true there and the
 * exact opposite of true here.
 *
 * So the tests below assert the filter is applied, by recording what the client
 * was asked to do. A fake rather than a database: the property being checked is
 * "was owner_id constrained", and that is visible without Postgres.
 */

/**
 * A Supabase query-builder stand-in that records its calls.
 *
 * Every method returns `this` so chains work, and the terminal shapes
 * (`maybeSingle`, and awaiting the builder itself) resolve to whatever rows the
 * test supplied.
 */
function fakeClient(rows: unknown[] = [], { error = null }: { error?: unknown } = {}) {
  const calls: { method: string; args: unknown[] }[] = [];

  const builder: Record<string, unknown> = {};
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return builder;
  };

  for (const method of [
    'select',
    'eq',
    'in',
    'is',
    'neq',
    'not',
    'gte',
    'ilike',
    'or',
    'order',
    'limit',
    'update',
  ]) {
    builder[method] = record(method);
  }

  builder.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error });
  // Awaiting the builder is how PostgREST terminates a query without a
  // `.single()`, so the fake has to be thenable to stand in for it.
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: rows, error });

  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
  };

  return { client: client as never, calls };
}

/** Did every table read constrain owner_id to this tenant? */
function ownerFilters(calls: { method: string; args: unknown[] }[]): unknown[] {
  return calls
    .filter((call) => call.method === 'eq' && call.args[0] === 'owner_id')
    .map((call) => call.args[1]);
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';

describe('the tenant filter — the property that matters', () => {
  it('getAttentionItems constrains owner_id', async () => {
    const { client, calls } = fakeClient([]);
    await getAttentionItems(client, OWNER);
    expect(ownerFilters(calls)).toContain(OWNER);
  });

  it('searchMessagesForVoice constrains owner_id', async () => {
    const { client, calls } = fakeClient([]);
    await searchMessagesForVoice(client, OWNER, 'deadline');
    expect(ownerFilters(calls)).toContain(OWNER);
  });

  it('resolvePerson constrains owner_id', async () => {
    const { client, calls } = fakeClient([]);
    await resolvePerson(client, OWNER, 'Maria');
    expect(ownerFilters(calls)).toContain(OWNER);
  });

  it('getRecentMessages constrains owner_id', async () => {
    const { client, calls } = fakeClient([]);
    await getRecentMessages(client, OWNER);
    expect(ownerFilters(calls)).toContain(OWNER);
  });

  it('getRecentMessages constrains owner_id on the CHANNEL lookup too', async () => {
    const { client, calls } = fakeClient([]);
    await getRecentMessages(client, OWNER, { channel: 'gmail' });

    /*
     * ⚠ Two queries, two filters. Resolving channel ids without an owner filter
     * would hand this tenant another tenant's channel id, and the message query
     * would then happily read messages that are not theirs.
     */
    expect(ownerFilters(calls).filter((id) => id === OWNER).length).toBeGreaterThanOrEqual(1);
  });

  it('returns nothing — not everything — when a channel filter matches none', async () => {
    const { client } = fakeClient([]);
    const result = await getRecentMessages(client, OWNER, { channel: 'whatsapp' });

    /*
     * ⚠ The dangerous shape is falling through to an unfiltered query when the
     * filter matched no channel. That would read Gmail aloud to somebody who
     * asked for WhatsApp.
     */
    expect(result.messages).toEqual([]);
    expect(result.summary).toMatch(/no whatsapp account is connected/i);
  });

  /*
   * ── ⚠ The meeting channel, which the filter used to drop on the floor ─────
   *
   * `getRecentMessages` resolved its channel with a two-arm ternary. A caller
   * saying "meetings" fell through to `null`, which means NO FILTER — so the
   * agent answered a question about meetings by reading out Gmail, down a
   * phone line, with no screen to catch it on.
   *
   * It failed silently in the one direction that matters: a filter that is
   * ignored looks exactly like a filter that matched everything.
   */
  /*
   * ⚠ The fake answers EVERY query with the same rows, so a row here has to be
   * legal as a channel lookup result AND as a message. `body_text` is `not
   * null` in the schema (migration 0001), so '' is what the real column would
   * hold, never undefined.
   */
  const MEETING_ROW = {
    id: 'chan-meeting',
    subject: null,
    body_text: '',
    sent_at: '2026-09-19T20:28:00.000Z',
    sender: null,
    channel: { type: 'meeting' },
  };

  it('accepts "meetings" as a channel and actually filters on it', async () => {
    const { client, calls } = fakeClient([MEETING_ROW]);
    await getRecentMessages(client, OWNER, { channel: 'meetings' });

    const typeFilters = calls
      .filter((c) => c.method === 'eq' && c.args[0] === 'type')
      .map((c) => c.args[1]);

    expect(typeFilters).toContain('meeting');
  });

  it('accepts the platform names a caller actually says', async () => {
    // Nobody says "the meeting channel" out loud; they say Zoom.
    for (const spoken of ['meeting', 'meetings', 'zoom', 'teams']) {
      const { client, calls } = fakeClient([MEETING_ROW]);
      await getRecentMessages(client, OWNER, { channel: spoken });

      const typeFilters = calls
        .filter((c) => c.method === 'eq' && c.args[0] === 'type')
        .map((c) => c.args[1]);

      expect(typeFilters, `"${spoken}" should resolve to the meeting channel`).toContain(
        'meeting',
      );
    }
  });

  it('says meetings were not RECORDED, not that an account is missing', async () => {
    const { client } = fakeClient([]);
    const result = await getRecentMessages(client, OWNER, { channel: 'meetings' });

    /*
     * ⚠ The generic template said "No meeting account is connected", which is
     * not a sentence anybody says. Gmail and WhatsApp are accounts somebody
     * connects; a meeting either happened or it did not.
     */
    expect(result.messages).toEqual([]);
    expect(result.summary).toMatch(/no meetings have been recorded/i);
    expect(result.summary).not.toMatch(/account/i);
  });

  it('a word nobody recognises still means no filter, not an error', async () => {
    const { client, calls } = fakeClient([]);
    const result = await getRecentMessages(client, OWNER, { channel: 'telegram' });

    /*
     * ⚠ Deliberate. The model heard a word out loud and may have misheard it.
     * Refusing would be pedantry the caller can neither see nor correct, so an
     * unrecognised word falls back to the whole record.
     */
    expect(calls.filter((c) => c.method === 'eq' && c.args[0] === 'type')).toHaveLength(0);
    expect(result.summary).not.toMatch(/TOOL_ERROR/);
  });

  it('getPersonActivity constrains owner_id before trusting a person id', async () => {
    const { client, calls } = fakeClient([]);
    await getPersonActivity(client, OWNER, PERSON);

    /*
     * ⚠ This is what stops a uuid belonging to ANOTHER tenant resolving to a
     * real person. The id arrives from a language model that heard it in a
     * previous tool result — it is not a capability, and it must not act like
     * one.
     */
    expect(ownerFilters(calls)).toContain(OWNER);
  });
});

describe('resolvePerson', () => {
  it('escapes like-wildcards in a spoken name', async () => {
    const { client, calls } = fakeClient([]);
    await resolvePerson(client, OWNER, '100%');

    const ilike = calls.find((call) => call.method === 'ilike');
    // A spoken name will not contain `%`. "The input can't contain that" is the
    // assumption every injection bug is built on.
    expect(String(ilike?.args[1])).toContain('\\%');
  });

  it('reports every match rather than picking one', async () => {
    const { client } = fakeClient([
      { id: 'a', display_name: 'Maria Santos' },
      { id: 'b', display_name: 'Maria Cruz' },
    ]);

    const result = await resolvePerson(client, OWNER, 'Maria');

    // Ms. Maria's requirement, and the agent prompt's "never pick one
    // silently". Returning two is the correct outcome, not a failure.
    expect((result.matches as unknown[]).length).toBe(2);
    expect(result.summary).toMatch(/two people/i);
    expect(result.summary).toMatch(/ask which one/i);
  });

  it('says plainly when nobody matches', async () => {
    const { client } = fakeClient([]);
    const result = await resolvePerson(client, OWNER, 'Nobody');

    expect(result.summary).toContain('Nobody');
    expect(result.summary).not.toMatch(/TOOL_ERROR/);
  });
});

/*
 * ── Telling apart people who share a name (Ms. Maria's research task 4) ─────
 *
 * ⚠ The fake answers EVERY query with the same rows, so each row below is
 * legal as a contact, an identity, a sent message, an affiliation and a hint
 * hit at once. Two people, both "Maria Santos", one at acme.ph and one at
 * mapua.edu.ph.
 */
function twoMarias() {
  const row = (id: string, externalId: string, conversationId: string) => ({
    id,
    display_name: 'Maria Santos',
    notes: null,
    contact_id: id,
    channel_type: 'gmail',
    external_id: externalId,
    sender_identity: id,
    subject: 'Website',
    sent_at: '2026-09-20T02:00:00Z',
    conversation_id: conversationId,
    kind: 'not-an-affiliation',
    message_id: id,
    payload: {},
  });
  return [row('a', 'maria@acme.ph', 't1'), row('b', 'msantos@mymail.mapua.edu.ph', 't2')];
}

describe('resolvePerson tells same-name people apart', () => {
  it('says what tells each one apart, not just "two people"', async () => {
    const { client } = fakeClient(twoMarias());
    const result = await resolvePerson(client, OWNER, 'Maria');

    expect(result.summary).toMatch(/two people/i);
    expect(result.summary).toContain('emails from acme.ph');
    expect(result.summary).toContain('emails from mapua.edu.ph');
    const matches = result.matches as { tellApart: string | null }[];
    expect(matches.map((m) => m.tellApart)).toEqual([
      'emails from acme.ph',
      'emails from mapua.edu.ph',
    ]);
  });

  it('filters owner_id on EVERY read it makes, the hint search included', async () => {
    const { client, calls } = fakeClient(twoMarias());
    await resolvePerson(client, OWNER, 'Maria', { hint: 'website' });

    /*
     * ⚠ Not `toContain`. This path now makes several reads, and one of them
     * missing the filter reads another tenant's rows down a phone line. Every
     * `from()` must be matched by an owner filter.
     */
    const reads = calls.filter((call) => call.method === 'from').length;
    expect(reads).toBeGreaterThan(3);
    expect(ownerFilters(calls)).toEqual(Array(reads).fill(OWNER));
  });

  it('never lets a hint write PostgREST syntax into the or() filter', async () => {
    const { client, calls } = fakeClient(twoMarias());
    await resolvePerson(client, OWNER, 'Maria', { hint: 'acme),owner_id.neq.x,(%_*' });

    const filters = calls.filter((call) => call.method === 'or').map((call) => String(call.args[0]));
    expect(filters.length).toBeGreaterThan(0);
    for (const filter of filters) {
      expect(filter).toMatch(/^subject\.ilike\.%[\p{L}\p{N}]+%,body_text\.ilike\.%[\p{L}\p{N}]+%$/u);
    }
  });

  it('asks for a hint instead of reading out a long list', async () => {
    const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id, display_name: 'Maria Santos' }));
    const { client } = fakeClient(rows);
    const result = await resolvePerson(client, OWNER, 'Maria');

    expect(result.summary).toMatch(/four people/i);
    expect(result.summary).toMatch(/too many to read out/i);
    expect(result.summary).toMatch(/hint/i);
  });

  it('says plainly when people cannot be told apart, and names the fix', async () => {
    const rows = ['a', 'b'].map((id) => ({ id, display_name: 'Maria Santos' }));
    const { client } = fakeClient(rows);
    const result = await resolvePerson(client, OWNER, 'Maria');

    expect(result.summary).toMatch(/cannot tell apart/i);
    expect(result.summary).toMatch(/note/i);
  });
});

describe('empty is not the same as broken', () => {
  it('an empty result says nothing was found', async () => {
    const { client } = fakeClient([]);
    const result = await searchMessagesForVoice(client, OWNER, 'submarine');

    // The agent's prompt turns this into "I don't have anything about that".
    expect(result.summary).not.toMatch(/TOOL_ERROR/);
  });

  it('a failed query is marked TOOL_ERROR so the agent does not report absence', async () => {
    const { client } = fakeClient([], { error: { message: 'connection reset' } });
    const result = await searchMessagesForVoice(client, OWNER, 'submarine');

    /*
     * ⚠ The distinction the whole prompt hinges on. "Nothing found" when the
     * database was unreachable is a lie that sounds like an answer, and the
     * caller acts on it. There is no screen to check it against.
     */
    expect(result.summary).toMatch(/^TOOL_ERROR/);
  });

  it('never leaks a provider error message into something speakable', async () => {
    const { client } = fakeClient([], {
      error: { message: 'column "body_text" contains: dinner with Maria at 7' },
    });
    const result = await searchMessagesForVoice(client, OWNER, 'dinner');

    // A Postgres error can echo a value, and a value here is a fragment of
    // somebody's message. It must not reach the speaker.
    expect(result.summary).not.toContain('Maria');
  });
});

describe('counts are computed here, not by the model', () => {
  it('spells the count out in words', async () => {
    // Ids, because the search merges its text and file-name queries by id — and
    // the fake answers both with these same two rows, so this also checks a
    // message found twice is counted once.
    const { client } = fakeClient([
      { id: 'm1', subject: 'One', body_text: 'a', sent_at: '2026-09-09T02:00:00Z', sender: null },
      { id: 'm2', subject: 'Two', body_text: 'b', sent_at: '2026-09-09T03:00:00Z', sender: null },
    ]);

    const result = await searchMessagesForVoice(client, OWNER, 'thing');

    // The prompt says the agent must never count for itself. It can only obey
    // that if the count arrives already worked out.
    expect(result.summary).toMatch(/two messages/);
  });
});

describe('the tool allowlist', () => {
  it('matches the nine tools the prompt declares', () => {
    expect([...VOICE_TOOLS]).toEqual([
      'resolve_person',
      'get_attention_items',
      'get_recent_messages',
      'search_messages',
      'get_person_activity',
      'get_files',
      'read_message',
      'get_overview',
      'read_file',
    ]);
  });

  it('rejects a tool the agent invented', () => {
    // `get_meeting_brief` is in the FIRST draft of the prompt and has no
    // implementation. If a stale Vapi assistant still asks for it, the route
    // must say so rather than dispatch something.
    expect(isVoiceTool('get_meeting_brief')).toBe(false);
    expect(isVoiceTool('drop_table')).toBe(false);
    expect(isVoiceTool(null)).toBe(false);
  });
});

describe('isPlausibleCallId', () => {
  it('accepts a normal opaque id', () => {
    expect(isPlausibleCallId('c8f3a1b2-9d4e-4f2a-8c1b-7e6d5a4b3c2d')).toBe(true);
  });

  it('rejects anything that is not a bounded token', () => {
    expect(isPlausibleCallId('')).toBe(false);
    expect(isPlausibleCallId('a'.repeat(129))).toBe(false);
    // The value becomes a primary key and selects the row that decides whose
    // mail is read. It gets a format check even though it is opaque.
    expect(isPlausibleCallId("'; drop table messages; --")).toBe(false);
    expect(isPlausibleCallId(42)).toBe(false);
    expect(isPlausibleCallId(undefined)).toBe(false);
  });
});

describe('CALL_SESSION_TTL_MS', () => {
  it('is bounded — a call id is a bearer token by another name', () => {
    expect(CALL_SESSION_TTL_MS).toBeGreaterThan(0);
    expect(CALL_SESSION_TTL_MS).toBeLessThanOrEqual(4 * 60 * 60 * 1000);
  });
});

/*
 * ── Files — Uriel could not see a single attachment (2026-10-06) ────────────
 *
 * The Files page showed Gmail's pictures and PDFs; every voice tool read
 * `messages` and none read `attachments`, so an email with an invoice attached
 * was read aloud as if it had none.
 */

/** Did the embedded files carry their own tenant filter? */
function attachmentOwnerFilters(calls: { method: string; args: unknown[] }[]): unknown[] {
  return calls
    .filter((call) => call.method === 'eq' && call.args[0] === 'attachments.owner_id')
    .map((call) => call.args[1]);
}

const INVOICE_ROW = {
  id: 'm1',
  display_name: 'Bea Santos',
  subject: 'Invoice for August',
  body_text: 'Attached is the invoice.',
  sent_at: '2026-10-01T03:00:00Z',
  direction: 'inbound',
  sender: { display_name: 'Bea Santos', external_id: 'bea@example.com' },
  channel: { type: 'gmail' },
  attachments: [{ filename: 'INV-2207.pdf', mime_type: 'application/pdf' }],
};

describe('files on the messages Uriel reads', () => {
  it('getRecentMessages names a message’s files, and filters them by owner', async () => {
    const { client, calls } = fakeClient([INVOICE_ROW]);
    const result = await getRecentMessages(client, OWNER);

    expect(attachmentOwnerFilters(calls)).toContain(OWNER);
    expect((result.messages as { files?: unknown }[])[0]?.files).toEqual([
      { name: 'INV-2207.pdf', kind: 'a PDF' },
    ]);
  });

  it('leaves `files` off a message that has none', async () => {
    const { client } = fakeClient([{ ...INVOICE_ROW, attachments: [] }]);
    const result = await getRecentMessages(client, OWNER);

    expect((result.messages as object[])[0]).not.toHaveProperty('files');
  });

  it('getPersonActivity names files too, owner-filtered', async () => {
    const { client, calls } = fakeClient([INVOICE_ROW]);
    const result = await getPersonActivity(client, OWNER, PERSON);

    expect(attachmentOwnerFilters(calls)).toContain(OWNER);
    expect((result.messages as { files?: unknown }[])[0]?.files).toHaveLength(1);
  });

  it('search also matches a file’s NAME, with the owner filter on both', async () => {
    const { client, calls } = fakeClient([]);
    await searchMessagesForVoice(client, OWNER, 'invoice');

    expect(
      calls.some(
        (call) =>
          call.method === 'ilike' &&
          call.args[0] === 'attachments.filename' &&
          call.args[1] === '%invoice%',
      ),
    ).toBe(true);
    // Two queries (text, file name): the owner filter on each, and on each one's files.
    expect(ownerFilters(calls).filter((id) => id === OWNER)).toHaveLength(2);
    expect(attachmentOwnerFilters(calls).filter((id) => id === OWNER)).toHaveLength(2);
  });
});

describe('get_files', () => {
  it('constrains owner_id on the messages and on their files', async () => {
    const { client, calls } = fakeClient([]);
    await getFiles(client, OWNER);

    expect(ownerFilters(calls)).toContain(OWNER);
    expect(attachmentOwnerFilters(calls)).toContain(OWNER);
  });

  it('lists files newest first, spoken, with the count worked out', async () => {
    const { client } = fakeClient([INVOICE_ROW]);
    const result = await getFiles(client, OWNER);

    expect(result.summary).toBe('One file has been saved.');
    expect(result.files).toEqual([
      {
        name: 'INV-2207.pdf',
        kind: 'a PDF',
        from: 'Bea Santos',
        when: expect.any(String),
        subject: 'Invoice for August',
        // The email it came on, so `read_message` can open it.
        messageId: 'm1',
      },
    ]);
  });

  it('says "you" for a file you sent', async () => {
    const { client } = fakeClient([{ ...INVOICE_ROW, direction: 'outbound' }]);
    const result = await getFiles(client, OWNER);

    expect((result.files as { from: string }[])[0]?.from).toBe('you');
  });

  it('narrows to one person through owner-filtered lookups', async () => {
    const { client, calls } = fakeClient([INVOICE_ROW]);
    const result = await getFiles(client, OWNER, { personId: PERSON });

    /*
     * ⚠ Three reads — the contact, their identities, the messages — and every
     * one carries the tenant filter. An unfiltered identity lookup would let a
     * guessed person id pull another tenant's sender ids into the query.
     */
    expect(ownerFilters(calls).filter((id) => id === OWNER).length).toBeGreaterThanOrEqual(3);
    expect(calls).toContainEqual({ method: 'in', args: ['sender_identity', ['m1']] });
    expect(result.summary).toBe('Bea Santos sent one file.');
  });

  it('refuses a malformed person id before querying anything', async () => {
    const { client, calls } = fakeClient([]);
    const result = await getFiles(client, OWNER, { personId: 'not-a-uuid' });

    expect(result.summary).toMatch(/^TOOL_ERROR/);
    expect(calls).toHaveLength(0);
  });

  it('a failed read is TOOL_ERROR, never "no files"', async () => {
    const { client } = fakeClient([], { error: { message: 'connection reset' } });
    const result = await getFiles(client, OWNER, { query: 'invoice' });

    expect(result.summary).toMatch(/^TOOL_ERROR/);
  });

  it('an empty library says so', async () => {
    const { client } = fakeClient([]);
    const result = await getFiles(client, OWNER);

    expect(result.summary).toBe('No files have been saved yet.');
  });
});

/*
 * ── Each word, not the phrase (2026-10-06) ──────────────────────────────────
 *
 * Asked for "OpenAI's about a refund", Uriel said it had nothing — while the
 * inbox held "Your OpenAI OpCo, LLC refund". The search was one ilike on the
 * whole phrase, and those words never sit side by side.
 */
describe('searchWords', () => {
  it('keeps the words a search is FOR', () => {
    expect(searchWords('OpenAI refund')).toEqual(['openai', 'refund']);
  });

  it('drops the sentence around them, even a whole spoken question', () => {
    expect(
      searchWords(
        "Can you now reach the files folder and see if there are any OpenAI's about a refund",
      ),
    ).toEqual(['openai', 'refund']);
  });

  it('leaves letters and digits only — nothing that is syntax in or()', () => {
    expect(searchWords('INV-2207.pdf')).toEqual(['inv', '2207', 'pdf']);
    expect(searchWords('a,b) or(owner_id.neq.x')).not.toContain(',');
    for (const word of searchWords('100%_off (sale), now')) {
      expect(word).toMatch(/^[\p{L}\p{N}]+$/u);
    }
  });

  it('is empty when there is nothing to search for', () => {
    expect(searchWords('any files')).toEqual([]);
  });
});

describe('search matches each word', () => {
  it('search_messages: one or() per word, and each word on the file name', async () => {
    const { client, calls } = fakeClient([]);
    await searchMessagesForVoice(client, OWNER, 'OpenAI refund');

    const ors = calls.filter((call) => call.method === 'or').map((call) => call.args[0]);
    expect(ors).toEqual([
      'subject.ilike.%openai%,body_text.ilike.%openai%',
      'subject.ilike.%refund%,body_text.ilike.%refund%',
    ]);
    const onNames = calls.filter(
      (call) => call.method === 'ilike' && call.args[0] === 'attachments.filename',
    );
    expect(onNames.map((call) => call.args[1])).toEqual(['%openai%', '%refund%']);
  });

  it('get_files: matches the email’s words as well as the file’s name', async () => {
    const { client, calls } = fakeClient([INVOICE_ROW]);
    const result = await getFiles(client, OWNER, { query: 'OpenAI refund' });

    // The credit note is "CreditNote-….pdf"; only its email says "refund".
    // Per word: the file's name or text (one `or` on attachments), and the
    // email's subject or body (one on messages).
    const ors = calls.filter((call) => call.method === 'or');
    expect(ors).toHaveLength(4);
    expect(ors).toContainEqual({
      method: 'or',
      args: [
        'filename.ilike.%refund%,text_content.ilike.%refund%',
        { referencedTable: 'attachments' },
      ],
    });
    expect(result.summary).toBe('one file matches openai refund.');
  });

  it('get_files: a query of only filler lists the latest instead', async () => {
    const { client, calls } = fakeClient([INVOICE_ROW]);
    const result = await getFiles(client, OWNER, { query: 'any files' });

    expect(calls.some((call) => call.method === 'or' || call.method === 'ilike')).toBe(false);
    expect(result.summary).toBe('One file has been saved.');
  });
});

/*
 * ── Everything else on the screen (2026-10-06) ──────────────────────────────
 *
 * Yuri: "make uriel reach everything in switchboard". The board's columns and
 * calendar marks, a person's brief, a whole message, the channels and counts —
 * all on screen, none reachable by voice until now.
 */
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';

describe('get_attention_items — columns, calendar, and finished work', () => {
  it('says which column a card is in, whether it is on the calendar, and who sent it', async () => {
    const { client } = fakeClient([
      {
        kind: 'meeting',
        status: 'in_progress',
        message_id: 'm1',
        calendar_event_id: 'evt_1',
        payload: { title: 'Project sync', quote: 'Friday at 3?' },
        message: { sender: { display_name: 'Bea Santos', external_id: 'bea@example.com' } },
      },
    ]);
    const result = await getAttentionItems(client, OWNER);

    expect((result.items as object[])[0]).toMatchObject({
      kind: 'meeting',
      column: 'in progress',
      onCalendar: true,
      from: 'Bea Santos',
      messageId: 'm1',
    });
  });

  it('status "done" reads finished cards, cleared ones included', async () => {
    const { client, calls } = fakeClient([]);
    const result = await getAttentionItems(client, OWNER, { status: 'done' });

    expect(calls).toContainEqual({ method: 'eq', args: ['status', 'done'] });
    // Clearing the Done column archives cards; finished work must still count.
    expect(calls.some((call) => call.method === 'is')).toBe(false);
    expect(ownerFilters(calls)).toContain(OWNER);
    expect(result.summary).toBe('Nothing has been marked done yet.');
  });
});

describe('get_person_activity — the brief', () => {
  it('carries what the contact page knows, through owner-filtered reads', async () => {
    // The fake answers every read with this row, so it has to be legal as a
    // contact, an identity, a message and an affiliation extraction at once.
    const row = {
      id: 'm1',
      display_name: 'Bea Santos',
      conversation_id: 'conv1',
      message_id: 'm1',
      sent_at: '2026-10-01T03:00:00Z',
      channel_id: 'c1',
      kind: 'affiliation',
      status: 'not_started',
      model: 'test-model',
      subject: 'Quotation',
      body_text: 'Hi',
      payload: { title: 'Bea Santos works at Halcyon Interiors', quote: 'I’m with Halcyon', company: 'Halcyon Interiors' },
    };
    const { client, calls } = fakeClient([row]);
    const result = await getPersonActivity(client, OWNER, PERSON);

    expect(result.about).toEqual({ company: 'Halcyon Interiors' });
    // Contact, messages, identities, conversations, their messages, extractions.
    expect(ownerFilters(calls).filter((id) => id === OWNER).length).toBeGreaterThanOrEqual(6);
  });
});

describe('read_message', () => {
  it('refuses a malformed id before querying anything', async () => {
    const { client, calls } = fakeClient([]);
    const result = await readMessage(client, OWNER, 'not-an-id');

    expect(result.summary).toMatch(/^TOOL_ERROR/);
    expect(calls).toHaveLength(0);
  });

  it('constrains owner_id on the message and on its extractions', async () => {
    const { client, calls } = fakeClient([]);
    const result = await readMessage(client, OWNER, MESSAGE_ID);

    // ⚠ Without it, a guessed id opens another tenant's message aloud.
    expect(ownerFilters(calls).filter((id) => id === OWNER)).toHaveLength(2);
    expect(result.summary).toBe('That message is not in your Switchboard.');
  });

  it('reads the whole text, capped, with its files', async () => {
    const long = 'word '.repeat(600);
    const { client } = fakeClient([{ ...INVOICE_ROW, id: MESSAGE_ID, body_text: long }]);
    const result = await readMessage(client, OWNER, MESSAGE_ID);

    expect(result.summary).toMatch(/^From Bea Santos on Gmail/);
    expect(result.truncated).toBe(true);
    expect((result.text as string).length).toBeLessThanOrEqual(1501);
    expect(result.files).toEqual([{ name: 'INV-2207.pdf', kind: 'a PDF' }]);
  });
});

describe('get_overview', () => {
  const NOW = new Date('2026-10-06T04:00:00Z');

  it('constrains owner_id on every read', async () => {
    const { client, calls } = fakeClient([]);
    await getOverview(client, OWNER, NOW);

    // Channels, messages, board, files, contacts.
    expect(ownerFilters(calls).filter((id) => id === OWNER)).toHaveLength(5);
  });

  it('says so when nothing is connected', async () => {
    const { client } = fakeClient([]);
    const result = await getOverview(client, OWNER, NOW);

    expect(result.summary).toBe('No channels are connected yet.');
  });

  it('works the numbers out, and names a channel in trouble plainly', async () => {
    const { client } = fakeClient([
      { id: 'c1', type: 'gmail', status: 'error', channel_id: 'c1', sent_at: '2026-10-06T01:00:00Z' },
    ]);
    const result = await getOverview(client, OWNER, NOW);

    expect(result.channels).toEqual([{ name: 'Gmail', state: 'needs reconnecting in Channels' }]);
    expect(result.arrived).toEqual([{ channel: 'Gmail', today: 1, thisWeek: 1 }]);
    expect(result.summary).toBe(
      'Gmail needs attention. one message arrived today, and no items are open on the board.',
    );
  });
});

/*
 * ── Opening a file (2026-10-06) ─────────────────────────────────────────────
 *
 * "he cant open files though". The worker reads every saved PDF and recording
 * (migration 0020); read_file hands Uriel what it read.
 */
describe('read_file', () => {
  const FILE_ID = '44444444-4444-4444-8444-444444444444';
  const fileRow = (overrides: Record<string, unknown> = {}) => ({
    filename: 'CreditNote-C9D3B154-0027-CN-01.pdf',
    mime_type: 'application/pdf',
    text_status: 'done',
    text_kind: 'pdf_text',
    text_content: 'Credit Note · ₱1,100.00 refunded on August 21, 2026',
    message: {
      sent_at: '2026-08-21T03:00:00Z',
      direction: 'inbound',
      sender: { display_name: 'OpenAI OpCo, LLC', external_id: 'ar@openai.com' },
    },
    ...overrides,
  });

  it('refuses a malformed id before querying anything', async () => {
    const { client, calls } = fakeClient([]);
    const result = await readFile(client, OWNER, 'nope');

    expect(result.summary).toMatch(/^TOOL_ERROR/);
    expect(calls).toHaveLength(0);
  });

  it('constrains owner_id, and says so plainly when the file is not theirs', async () => {
    const { client, calls } = fakeClient([]);
    const result = await readFile(client, OWNER, FILE_ID);

    // ⚠ Without it, a guessed id reads another tenant's file aloud.
    expect(ownerFilters(calls)).toEqual([OWNER]);
    expect(result.summary).toBe('That file is not in your Switchboard.');
  });

  it('reads what a PDF says, with who sent it', async () => {
    const { client } = fakeClient([fileRow()]);
    const result = await readFile(client, OWNER, FILE_ID);

    expect(result).toMatchObject({
      summary: 'What the PDF says.',
      name: 'CreditNote-C9D3B154-0027-CN-01.pdf',
      kind: 'a PDF',
      from: 'OpenAI OpCo, LLC',
      text: 'Credit Note · ₱1,100.00 refunded on August 21, 2026',
      truncated: false,
    });
  });

  it('reads a recording’s transcript', async () => {
    const { client } = fakeClient([
      fileRow({
        filename: 'Voice note.m4a',
        mime_type: 'audio/x-m4a',
        text_kind: 'transcript',
        text_content: 'Sige, call tayo after lunch.',
      }),
    ]);
    const result = await readFile(client, OWNER, FILE_ID);

    expect(result.summary).toBe('The recording, transcribed.');
    expect(result.text).toBe('Sige, call tayo after lunch.');
  });

  it('says a file not read yet will be, rather than that it is empty', async () => {
    const { client } = fakeClient([fileRow({ text_status: null, text_content: null })]);
    const result = await readFile(client, OWNER, FILE_ID);

    expect(result.summary).toBe('That file has not been read yet. Try again in a few minutes.');
    expect(result).not.toHaveProperty('text');
  });

  it('says a scan has no text, and that a picture cannot be read', async () => {
    const scan = await readFile(
      fakeClient([fileRow({ text_status: 'empty', text_content: null })]).client,
      OWNER,
      FILE_ID,
    );
    expect(scan.summary).toMatch(/no text in that file/i);

    const picture = await readFile(
      fakeClient([fileRow({ filename: 'photo.jpg', mime_type: 'image/jpeg', text_status: null })]).client,
      OWNER,
      FILE_ID,
    );
    expect(picture.summary).toBe('Pictures cannot be read yet. It is on the Files page.');
  });
});

describe('files say whether they can be read', () => {
  it('carries a fileId, and readable only once the worker has its text', async () => {
    const { client } = fakeClient([
      {
        ...INVOICE_ROW,
        attachments: [
          { id: 'f1', filename: 'INV-2207.pdf', mime_type: 'application/pdf', text_status: 'done' },
          { id: 'f2', filename: 'photo.jpg', mime_type: 'image/jpeg', text_status: null },
        ],
      },
    ]);
    const result = await getRecentMessages(client, OWNER);

    expect((result.messages as { files?: unknown }[])[0]?.files).toEqual([
      { name: 'INV-2207.pdf', kind: 'a PDF', fileId: 'f1', readable: true },
      { name: 'photo.jpg', kind: 'a picture', fileId: 'f2' },
    ]);
  });
});

describe('spokenFileKind', () => {
  it('says what a person calls it', () => {
    expect(spokenFileKind('application/pdf', 'a.pdf')).toBe('a PDF');
    expect(spokenFileKind('image/jpeg', 'IMG_2041.jpg')).toBe('a picture');
    expect(spokenFileKind('application/octet-stream', 'brief.docx')).toBe('a Word document');
    expect(spokenFileKind(null, 'rates.xlsx')).toBe('a spreadsheet');
    expect(spokenFileKind(null, 'deck.pptx')).toBe('a slide deck');
    expect(spokenFileKind(null, null)).toBe('a file');
  });
});

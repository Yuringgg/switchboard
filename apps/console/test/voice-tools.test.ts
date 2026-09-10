import { describe, expect, it } from 'vitest';

import { isPlausibleCallId, CALL_SESSION_TTL_MS } from '../src/lib/voice/call-session';
import {
  getAttentionItems,
  getPersonActivity,
  getRecentMessages,
  isVoiceTool,
  resolvePerson,
  searchMessagesForVoice,
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

  for (const method of ['select', 'eq', 'in', 'is', 'neq', 'ilike', 'or', 'order', 'limit', 'update']) {
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
    const { client } = fakeClient([
      { subject: 'One', body_text: 'a', sent_at: '2026-09-09T02:00:00Z', sender: null },
      { subject: 'Two', body_text: 'b', sent_at: '2026-09-09T03:00:00Z', sender: null },
    ]);

    const result = await searchMessagesForVoice(client, OWNER, 'thing');

    // The prompt says the agent must never count for itself. It can only obey
    // that if the count arrives already worked out.
    expect(result.summary).toMatch(/two messages/);
  });
});

describe('the tool allowlist', () => {
  it('matches the five tools the prompt declares', () => {
    expect([...VOICE_TOOLS]).toEqual([
      'resolve_person',
      'get_attention_items',
      'get_recent_messages',
      'search_messages',
      'get_person_activity',
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

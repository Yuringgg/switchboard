import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseWebhookPayload } from '../src/parse';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'whatsapp');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as unknown;
}

describe('parseWebhookPayload', () => {
  describe('an ordinary text message', () => {
    const { events, skipped } = parseWebhookPayload(fixture('text'));

    it('yields exactly one event', () => {
      expect(events).toHaveLength(1);
      expect(skipped).toEqual({ statuses: 0, otherFields: 0, unusable: 0 });
    });

    it('carries the phone_number_id as the account reference', () => {
      // NOT display_phone_number. The id is opaque and stable; the display
      // number is a formatted string whose punctuation Meta has changed.
      expect(events[0]?.phoneNumberId).toBe('106540352242922');
    });

    it('uses the wamid as the idempotency key', () => {
      expect(events[0]?.externalId).toMatch(/^wamid\./);
      expect(events[0]?.externalId).toBe(events[0]?.envelope.message.id);
    });

    it('attaches the sender profile matched by wa_id', () => {
      expect(events[0]?.envelope.contact?.profile?.name).toBe('Marisol Enriquez');
    });

    it('copies the message object verbatim', () => {
      // This splits the payload; it does not parse it. The worker normalizes
      // from what is stored, so anything lost here is lost for good.
      expect(events[0]?.envelope.message).toEqual({
        from: '639170000001',
        id: 'wamid.HBgMNjM5MTcwMDAwMDAxFQIAEhggMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAxAA==',
        timestamp: '1785240000',
        type: 'text',
        text: { body: 'Good morning! Confirming our meeting Thursday 3pm.' },
      });
    });

    it('carries the business number, so normalize needs no second argument', () => {
      // The rule the Phase 2 refactor checkpoint produced: a stored payload
      // must be self-sufficient. See ChannelAdapter in @switchboard/core.
      expect(events[0]?.envelope.metadata.display_phone_number).toBe('15550783881');
    });
  });

  /*
   * ── The test that earns this file ────────────────────────────────────────
   *
   * Every payload example in Meta's documentation has one entry, one change and
   * one message. Code written against those — entry[0].changes[0].value
   * .messages[0] — passes every other test here and silently drops mail in
   * production, which is the worst failure mode this system has: no error, no
   * log line, just messages that never arrive.
   */
  describe('a batched payload', () => {
    const { events, skipped } = parseWebhookPayload(fixture('batch'));

    it('finds every message across entries, changes and arrays', () => {
      expect(events).toHaveLength(4);
    });

    it('keeps messages from a second business number distinct', () => {
      // One POST, two business numbers, therefore two channels — and in a
      // multi-tenant system, potentially two owners. Collapsing these to one
      // phoneNumberId would attribute a message to the wrong tenant.
      const accounts = events.map((e) => e.phoneNumberId);
      expect(new Set(accounts).size).toBe(2);
      expect(accounts.at(-1)).toBe('220099887766554');
    });

    it('matches each sender profile by wa_id, not by position', () => {
      expect(events[0]?.envelope.contact?.profile?.name).toBe('Marisol Enriquez');
      expect(events[1]?.envelope.contact?.profile?.name).toBe('Ate Niña Concepción');
    });

    it('counts statuses that share a change with messages', () => {
      // The status branch cannot be written as "either statuses or messages".
      expect(skipped.statuses).toBe(1);
    });

    it('produces unique idempotency keys', () => {
      const ids = events.map((e) => e.externalId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('delivery receipts', () => {
    const { events, skipped } = parseWebhookPayload(fixture('statuses-only'));

    it('queues nothing', () => {
      // This is the most common payload in a live account. If it queued rows,
      // every message the business sent would appear in the timeline twice.
      expect(events).toHaveLength(0);
    });

    it('counts them, so a quiet webhook is distinguishable from a broken one', () => {
      expect(skipped.statuses).toBe(2);
    });
  });

  describe('a field that is not messages', () => {
    const { events, skipped } = parseWebhookPayload(fixture('other-field'));

    it('is skipped without inspecting its value', () => {
      expect(events).toHaveLength(0);
      expect(skipped.otherFields).toBe(2);
    });
  });

  describe('messages that cannot be attributed', () => {
    it('drops a message with no phone_number_id rather than guessing an owner', () => {
      const { events, skipped } = parseWebhookPayload({
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { display_phone_number: '15550783881' },
                  messages: [
                    { from: '639170000001', id: 'wamid.X', timestamp: '1785240000', type: 'text' },
                  ],
                },
              },
            ],
          },
        ],
      });

      // No account reference means no channel, means no owner. A message
      // attributed to the wrong tenant is worse than one that never arrived,
      // and RLS cannot catch it — the worker bypasses RLS.
      expect(events).toHaveLength(0);
      expect(skipped.unusable).toBe(1);
    });

    it('drops a message with no id, which has no idempotency key', () => {
      const { events, skipped } = parseWebhookPayload({
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: '106540352242922' },
                  messages: [{ from: '639170000001', timestamp: '1785240000', type: 'text' }],
                },
              },
            ],
          },
        ],
      });

      expect(events).toHaveLength(0);
      expect(skipped.unusable).toBe(1);
    });

    it('drops a message with no sender', () => {
      const { events, skipped } = parseWebhookPayload({
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: '106540352242922' },
                  messages: [{ id: 'wamid.X', timestamp: '1785240000', type: 'text' }],
                },
              },
            ],
          },
        ],
      });

      expect(events).toHaveLength(0);
      expect(skipped.unusable).toBe(1);
    });
  });

  describe('malformed input', () => {
    /*
     * This runs on an endpoint the public internet can reach. The HMAC check
     * gates it, so a payload arriving here is authentically Meta's — but a
     * throw would still be a 500, and Meta treats non-200 as a delivery failure
     * and retries for up to 7 days before disabling the endpoint. A shape we do
     * not understand must degrade to "nothing to do", never to an exception.
     */
    const shapes: [string, unknown][] = [
      ['null', null],
      ['undefined', undefined],
      ['a string', 'not json'],
      ['a number', 42],
      ['an empty object', {}],
      ['entry as an object', { entry: { changes: [] } }],
      ['changes as a string', { entry: [{ changes: 'nope' }] }],
      ['a change with no value', { entry: [{ changes: [{ field: 'messages' }] }] }],
      ['messages as an object', { entry: [{ changes: [{ value: { messages: {} } }] }] }],
      ['a null message in the array', {
        entry: [{ changes: [{ value: { metadata: { phone_number_id: '1' }, messages: [null] } }] }],
      }],
    ];

    for (const [name, payload] of shapes) {
      it(`survives ${name}`, () => {
        expect(() => parseWebhookPayload(payload)).not.toThrow();
        expect(parseWebhookPayload(payload).events).toEqual([]);
      });
    }
  });

  it('is pure — the same payload always parses identically', () => {
    const payload = fixture('batch');
    expect(parseWebhookPayload(payload)).toEqual(parseWebhookPayload(payload));
  });
});

import { describe, expect, it } from 'vitest';

import {
  CHANNEL_TYPES,
  isChannelType,
  type ChannelAdapter,
  type InboundRef,
  type NormalizeResult,
} from '../src/index';

describe('isChannelType', () => {
  it('accepts every channel in scope', () => {
    for (const type of CHANNEL_TYPES) {
      expect(isChannelType(type)).toBe(true);
    }
  });

  it('rejects channels that are not in scope', () => {
    // Telegram was cut (ADR-001); the others were never in.
    expect(isChannelType('telegram')).toBe(false);
    expect(isChannelType('messenger')).toBe(false);
  });

  it('rejects non-string input without throwing', () => {
    // This runs against untrusted webhook payloads, so it must not assume a type.
    expect(isChannelType(undefined)).toBe(false);
    expect(isChannelType(null)).toBe(false);
    expect(isChannelType(42)).toBe(false);
    expect(isChannelType({ channelType: 'gmail' })).toBe(false);
  });
});

/**
 * A stand-in adapter over a trivial payload. It exists to prove the contract is
 * implementable and that `normalize` can be exercised with no I/O and no live
 * account — the property every real adapter's tests will depend on.
 *
 * ⚠ The payload it normalizes is SELF-SUFFICIENT: it carries the account the
 * message was addressed to, not just the message. That is the rule the Phase 2
 * checkpoint produced, and this adapter is the smallest thing that demonstrates
 * why the old `normalize(event: RawEvent)` signature could not hold — a stored
 * payload is all that survives the queue.
 */
interface EchoPayload {
  from: string;
  to: string;
  body: string;
  threadId: string;
  id: string;
  sentAt: string;
}

const echoAdapter: ChannelAdapter = {
  type: 'gmail',

  verifyWebhook(rawBody: string, headers: Headers, secret: string): boolean {
    return headers.get('x-echo-signature') === `${secret}:${rawBody.length}`;
  },

  parseWebhook(payload: unknown): InboundRef[] {
    const body = payload as { messages?: EchoPayload[] };
    return (body.messages ?? []).map((message) => ({
      // The ACCOUNT the provider addressed — never a channel id, which this
      // function has no way to know and no business deciding.
      accountRef: message.to,
      externalId: message.id,
      payload: message,
    }));
  },

  normalize(payload: unknown): NormalizeResult {
    const message = payload as EchoPayload;
    if (!message?.id) return { ok: false, reason: 'payload has no id' };

    return {
      ok: true,
      message: {
        externalId: message.id,
        externalThreadId: message.threadId,
        direction: message.from === message.to ? 'outbound' : 'inbound',
        sender: { channelType: 'gmail', externalId: message.from },
        recipients: [{ channelType: 'gmail', externalId: message.to }],
        bodyText: message.body,
        attachments: [],
        sentAt: new Date(message.sentAt),
      },
    };
  },
};

describe('ChannelAdapter contract', () => {
  const stored: EchoPayload = {
    id: 'msg-1',
    from: 'client@example.com',
    to: 'yuri@example.com',
    threadId: 'thr-1',
    body: 'Meeting Thursday 3pm?',
    sentAt: '2026-07-26T00:00:00.000Z',
  };

  it('normalizes a stored payload into canonical form', () => {
    const result = echoAdapter.normalize(stored);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.externalId).toBe('msg-1');
    expect(result.message.sender.externalId).toBe('client@example.com');
    expect(result.message.bodyText).toBe('Meeting Thursday 3pm?');
  });

  it('reports an unusable payload instead of throwing', () => {
    // A throw fails the whole queued event, burns its attempts, and parks every
    // other message in the same batch. One odd message must not block the rest.
    const result = echoAdapter.normalize({ body: 'no id here' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('payload has no id');
  });

  it('is pure — the same payload always normalizes identically', () => {
    // This is what makes fixture-driven adapter tests possible. If an adapter
    // ever reaches for the network or the clock, this is the test that fails.
    expect(echoAdapter.normalize(stored)).toEqual(echoAdapter.normalize(stored));
  });

  it('preserves externalId, which is the idempotency key', () => {
    // `messages` carries unique (channel_id, external_id). A normalize that
    // invents or mutates this id turns webhook redelivery into duplicate rows.
    const result = echoAdapter.normalize(stored);
    expect(result.ok && result.message.externalId).toBe(stored.id);
  });

  it('parses a webhook into account references, never channel ids', () => {
    /*
     * The signature this replaced returned `RawEvent[]`, which carries a
     * `channelId`. Producing one requires a database lookup — the lookup that
     * decides `owner_id`, in a system where the worker bypasses RLS. Keeping it
     * out of a pure function is the point of `InboundRef`.
     */
    const refs = echoAdapter.parseWebhook?.({ messages: [stored] }) ?? [];

    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      accountRef: 'yuri@example.com',
      externalId: 'msg-1',
      payload: stored,
    });
    expect(refs[0]).not.toHaveProperty('channelId');
  });

  it('verifies a webhook against a secret it is given, not one it reads', () => {
    // The old signature took (headers, rawBody) and no secret, so the only way
    // to implement it was reading process.env from inside a pure package.
    const rawBody = '{"messages":[]}';
    const headers = new Headers({ 'x-echo-signature': `s3cret:${rawBody.length}` });

    expect(echoAdapter.verifyWebhook?.(rawBody, headers, 's3cret')).toBe(true);
    expect(echoAdapter.verifyWebhook?.(rawBody, headers, 'wrong')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import {
  CHANNEL_TYPES,
  isChannelType,
  type CanonicalMessage,
  type ChannelAdapter,
  type RawEvent,
} from '../src/index.js';

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
 */
const echoAdapter: ChannelAdapter = {
  type: 'gmail',
  normalize(event: RawEvent): CanonicalMessage {
    const payload = event.payload as { from: string; body: string; threadId: string };
    return {
      externalId: event.externalId,
      externalThreadId: payload.threadId,
      direction: 'inbound',
      sender: { channelType: event.channelType, externalId: payload.from },
      recipients: [],
      bodyText: payload.body,
      attachments: [],
      sentAt: event.receivedAt,
    };
  },
};

describe('ChannelAdapter contract', () => {
  const event: RawEvent = {
    channelType: 'gmail',
    channelId: '00000000-0000-0000-0000-000000000000',
    externalId: 'msg-1',
    receivedAt: new Date('2026-07-26T00:00:00Z'),
    payload: { from: 'client@example.com', body: 'Meeting Thursday 3pm?', threadId: 'thr-1' },
  };

  it('normalizes a raw event into canonical form', () => {
    const message = echoAdapter.normalize(event);

    expect(message.externalId).toBe('msg-1');
    expect(message.sender.externalId).toBe('client@example.com');
    expect(message.bodyText).toBe('Meeting Thursday 3pm?');
  });

  it('is pure — the same event always normalizes identically', () => {
    // This is what makes fixture-driven adapter tests possible. If an adapter
    // ever reaches for the network or the clock, this is the test that fails.
    expect(echoAdapter.normalize(event)).toEqual(echoAdapter.normalize(event));
  });

  it('preserves externalId, which is the idempotency key', () => {
    // `messages` carries unique (channel_id, external_id). A normalize that
    // invents or mutates this id turns webhook redelivery into duplicate rows.
    expect(echoAdapter.normalize(event).externalId).toBe(event.externalId);
  });
});

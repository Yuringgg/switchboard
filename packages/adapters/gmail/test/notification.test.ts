import { describe, expect, it } from 'vitest';

import { parsePushNotification } from '../src/notification';

function envelope(data: unknown, messageId = 'pubsub-msg-1') {
  return {
    message: {
      data: Buffer.from(JSON.stringify(data)).toString('base64'),
      messageId,
      publishTime: '2026-07-26T10:00:00.000Z',
    },
    subscription: 'projects/switchboard-503613/subscriptions/gmail-push-sub',
  };
}

describe('parsePushNotification', () => {
  it('parses a real-shaped Gmail notification', () => {
    const result = parsePushNotification(
      envelope({ emailAddress: 'user@example.com', historyId: 987654 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification.emailAddress).toBe('user@example.com');
    expect(result.notification.historyId).toBe('987654');
    expect(result.notification.messageId).toBe('pubsub-msg-1');
  });

  it('keeps historyId exact beyond Number.MAX_SAFE_INTEGER', () => {
    // Gmail sends this as a JSON number. Parsed as a number it silently loses
    // precision, and the cursor then points at the wrong place in the history —
    // which looks like "some emails just never arrive", not like a bug here.
    const huge = '9007199254740993'; // MAX_SAFE_INTEGER + 2
    const result = parsePushNotification(
      parseJsonPreservingBig(`{"emailAddress":"u@example.com","historyId":${huge}}`),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification.historyId).toBe(huge);
  });

  it('accepts historyId sent as a string', () => {
    const result = parsePushNotification(
      envelope({ emailAddress: 'u@example.com', historyId: '42' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.notification.historyId).toBe('42');
  });

  it.each([
    ['not an object', 'string body'],
    ['missing message', {}],
    ['message not an object', { message: 'x' }],
    ['missing data', { message: { messageId: 'a' } }],
    ['missing messageId', { message: { data: 'eyJhIjoxfQ==' } }],
  ])('rejects %s', (_label, body) => {
    const result = parsePushNotification(body);
    expect(result.ok).toBe(false);
  });

  it('rejects data that is not base64 JSON', () => {
    const result = parsePushNotification({
      message: { data: 'not-base64-json!!', messageId: 'a' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a payload missing emailAddress or historyId', () => {
    expect(parsePushNotification(envelope({ historyId: 1 })).ok).toBe(false);
    expect(parsePushNotification(envelope({ emailAddress: 'u@example.com' })).ok).toBe(false);
  });

  it('rejects a non-numeric historyId', () => {
    const result = parsePushNotification(
      envelope({ emailAddress: 'u@example.com', historyId: 'abc' }),
    );
    expect(result.ok).toBe(false);
  });

  it('never throws on hostile input', () => {
    // This runs on unverified-shaped data from the internet. It must return a
    // result, not blow up the route.
    for (const body of [null, undefined, 42, [], { message: null }, { message: { data: {} } }]) {
      expect(() => parsePushNotification(body)).not.toThrow();
      expect(parsePushNotification(body).ok).toBe(false);
    }
  });
});

/** Build the envelope from raw JSON text so a big integer survives the test itself. */
function parseJsonPreservingBig(json: string) {
  return {
    message: {
      data: Buffer.from(json).toString('base64'),
      messageId: 'pubsub-msg-big',
    },
  };
}

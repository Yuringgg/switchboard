import { describe, expect, it } from 'vitest';

import { parseWatchResponse } from '../src/watch';

describe('parseWatchResponse', () => {
  it('parses a real-shaped watch response', () => {
    const result = parseWatchResponse('{"historyId":"9876543","expiration":"1785700000000"}');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.watch.historyId).toBe('9876543');
    expect(result.watch.expiresAt.getTime()).toBe(1785700000000);
  });

  it('accepts historyId and expiration sent as JSON numbers', () => {
    // Gmail's docs say string; the API has been observed sending both.
    const result = parseWatchResponse('{"historyId":9876543,"expiration":1785700000000}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.watch.historyId).toBe('9876543');
  });

  it('keeps historyId exact past Number.MAX_SAFE_INTEGER', () => {
    // The same precision trap as the push notification. Parsed as a double,
    // ...993 becomes ...992, the cursor lands mid-history, and the symptom is
    // "some emails never arrive" rather than anything resembling a parse bug.
    const result = parseWatchResponse(
      '{"historyId":9007199254740993,"expiration":"1785700000000"}',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.watch.historyId).toBe('9007199254740993');
  });

  it('rejects a response missing historyId', () => {
    const result = parseWatchResponse('{"expiration":"1785700000000"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/historyId/);
  });

  it('rejects a response missing expiration', () => {
    // Without it we cannot schedule renewal, and the watch dies silently in
    // seven days. Better to fail the connect than to register a watch we will
    // never renew.
    const result = parseWatchResponse('{"historyId":"123"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expiration/);
  });

  it('rejects a non-JSON body', () => {
    expect(parseWatchResponse('<html>502</html>').ok).toBe(false);
  });

  it('rejects a zero or negative expiration', () => {
    expect(parseWatchResponse('{"historyId":"1","expiration":"0"}').ok).toBe(false);
  });

  it('never throws on hostile input', () => {
    for (const body of ['', 'null', '[]', '"str"', '{']) {
      expect(() => parseWatchResponse(body)).not.toThrow();
      expect(parseWatchResponse(body).ok).toBe(false);
    }
  });
});

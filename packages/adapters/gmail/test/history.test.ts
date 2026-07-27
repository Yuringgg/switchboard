import { describe, expect, it } from 'vitest';

import { parseHistoryResponse } from '../src/history';

const FALLBACK = '1000';

describe('parseHistoryResponse', () => {
  it('collects added message ids', () => {
    const result = parseHistoryResponse(
      JSON.stringify({
        history: [
          { id: '1', messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }] },
          { id: '2', messagesAdded: [{ message: { id: 'm2', threadId: 't2' } }] },
        ],
        historyId: '2000',
      }),
      FALLBACK,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.messageIds).toEqual(['m1', 'm2']);
    expect(result.page.nextHistoryId).toBe('2000');
  });

  it('de-duplicates a message appearing in several history entries', () => {
    // Gmail repeats a message across entries when it is labelled or read soon
    // after arriving. Without this the worker fetches and upserts it twice.
    const result = parseHistoryResponse(
      JSON.stringify({
        history: [
          { id: '1', messagesAdded: [{ message: { id: 'm1' } }] },
          { id: '2', messagesAdded: [{ message: { id: 'm1' } }] },
          { id: '3', messagesAdded: [{ message: { id: 'm2' } }] },
        ],
        historyId: '2000',
      }),
      FALLBACK,
    );

    if (!result.ok) throw new Error(result.reason);
    expect(result.page.messageIds).toEqual(['m1', 'm2']);
  });

  it('keeps historyId exact past Number.MAX_SAFE_INTEGER', () => {
    // Third place this trap appears. Parsed as a double the cursor lands
    // mid-history and mail silently stops arriving.
    const result = parseHistoryResponse('{"history":[],"historyId":9007199254740993}', FALLBACK);
    if (!result.ok) throw new Error(result.reason);
    expect(result.page.nextHistoryId).toBe('9007199254740993');
  });

  it('falls back to the current cursor when the response has no historyId', () => {
    // Never advance past a point we cannot name — that would skip mail.
    const result = parseHistoryResponse('{"history":[]}', FALLBACK);
    if (!result.ok) throw new Error(result.reason);
    expect(result.page.nextHistoryId).toBe(FALLBACK);
  });

  it('reports an empty delta rather than failing', () => {
    // The common case: a notification for a change we do not care about.
    const result = parseHistoryResponse('{"historyId":"2000"}', FALLBACK);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page.messageIds).toEqual([]);
  });

  it('surfaces a page token so pagination is not silently truncated', () => {
    const result = parseHistoryResponse(
      JSON.stringify({ history: [], historyId: '2000', nextPageToken: 'abc' }),
      FALLBACK,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.page.nextPageToken).toBe('abc');
  });

  it('ignores history entries with no messagesAdded', () => {
    const result = parseHistoryResponse(
      JSON.stringify({
        history: [{ id: '1' }, { id: '2', messagesAdded: [{}] }],
        historyId: '2000',
      }),
      FALLBACK,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.page.messageIds).toEqual([]);
  });

  it('never throws on hostile input', () => {
    for (const body of ['', 'null', '[]', '{', '"str"', '{"history":"x"}']) {
      expect(() => parseHistoryResponse(body, FALLBACK)).not.toThrow();
    }
  });
});

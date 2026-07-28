import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { verifyHubSignature } from '@switchboard/core';
import { describe, expect, it } from 'vitest';

import { normalizeWhatsAppMessage } from '../src/normalize';
import { parseWebhookPayload } from '../src/parse';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'whatsapp');
const APP_SECRET = 'test-app-secret';

/**
 * The whole path, from raw bytes to the values that reach the database.
 *
 * ── Why this exists when parse and normalize are already tested ──────────────
 *
 * They are tested in isolation, and the seam between them is where this kind of
 * pipeline actually breaks: the route verifies bytes, parses them, stores an
 * envelope, and a *different process* — the worker, minutes later, after a queue
 * — normalizes whatever came back out of jsonb. Nothing in either unit test
 * covers the assumption connecting them, which is that the envelope the route
 * writes is sufficient for the worker to read.
 *
 * So this runs the real sequence in order, with a JSON round trip in the middle
 * standing in for the jsonb column, and asserts the values `persistMessage`
 * would write.
 */

function bytes(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.json`), 'utf8');
}

function sign(rawBody: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(rawBody, 'utf8').digest('hex')}`;
}

describe('raw webhook bytes → the row the worker writes', () => {
  it('carries a text message the whole way', () => {
    const rawBody = bytes('text');

    // 1. The route: verify the exact bytes received.
    expect(verifyHubSignature(rawBody, sign(rawBody), APP_SECRET)).toBe(true);

    // 2. The route: parse, and queue one raw_events row per message.
    const { events } = parseWebhookPayload(JSON.parse(rawBody));
    expect(events).toHaveLength(1);
    const queued = events[0]!;

    /*
     * 3. The queue. `raw_events.payload` is jsonb, so whatever the route wrote
     *    comes back through a serialization boundary — Dates would arrive as
     *    strings, `undefined` keys would vanish, class instances would flatten.
     *    Round-tripping here is what makes those failures show up now rather
     *    than in the worker's logs.
     */
    const fromQueue = JSON.parse(JSON.stringify(queued.envelope)) as typeof queued.envelope;
    expect(fromQueue).toEqual(queued.envelope);

    // 4. The worker: normalize what came out of the queue, and nothing else.
    const result = normalizeWhatsAppMessage(fromQueue);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 5. What persistMessage writes. owner_id and channel_id are NOT here —
    //    they come from the channels row, which is the point.
    expect({
      external_id: result.message.externalId,
      external_thread_id: result.message.externalThreadId,
      direction: result.message.direction,
      subject: result.message.subject ?? null,
      body_text: result.message.bodyText,
      sent_at: result.message.sentAt.toISOString(),
      sender_external_id: result.message.sender.externalId,
      sender_display_name: result.message.sender.displayName ?? null,
    }).toEqual({
      external_id: queued.externalId,
      external_thread_id: '639170000001',
      direction: 'inbound',
      subject: null,
      body_text: 'Good morning! Confirming our meeting Thursday 3pm.',
      sent_at: '2026-07-28T12:00:00.000Z',
      sender_external_id: '639170000001',
      sender_display_name: 'Marisol Enriquez',
    });

    // The idempotency key is the same value at both ends. `raw_events` and
    // `messages` are keyed on it independently, and they must agree.
    expect(result.message.externalId).toBe(queued.externalId);
  });

  it('keeps a batch of four separable all the way through', () => {
    const rawBody = bytes('batch');
    expect(verifyHubSignature(rawBody, sign(rawBody), APP_SECRET)).toBe(true);

    const { events } = parseWebhookPayload(JSON.parse(rawBody));
    expect(events).toHaveLength(4);

    const rows = events.map((event) => {
      const fromQueue = JSON.parse(JSON.stringify(event.envelope)) as typeof event.envelope;
      const result = normalizeWhatsAppMessage(fromQueue);
      if (!result.ok) throw new Error(result.reason);

      return {
        accountRef: event.phoneNumberId,
        externalId: result.message.externalId,
        thread: result.message.externalThreadId,
        body: result.message.bodyText,
      };
    });

    // Four distinct messages, two business numbers, three senders — and the
    // fourth belongs to a different channel than the first three, so it would
    // resolve to a different `channels` row and potentially a different tenant.
    expect(new Set(rows.map((r) => r.externalId)).size).toBe(4);
    expect(new Set(rows.map((r) => r.accountRef))).toEqual(
      new Set(['106540352242922', '220099887766554']),
    );
    expect(rows.at(-1)?.accountRef).toBe('220099887766554');
    expect(rows.at(-1)?.thread).toBe('639170000003');
  });

  it('survives Taglish through the jsonb round trip', () => {
    // The encoding path end to end. Mojibake introduced anywhere along here
    // gets embedded in Phase 4 and makes the message unfindable by the words it
    // contains — and it never raises.
    const rawBody = bytes('taglish');
    const { events } = parseWebhookPayload(JSON.parse(rawBody));
    const fromQueue = JSON.parse(JSON.stringify(events[0]!.envelope));

    const result = normalizeWhatsAppMessage(fromQueue);
    if (!result.ok) throw new Error(result.reason);

    expect(result.message.bodyText).toContain('traffic sa EDSA');
    expect(result.message.bodyText).toContain('🙏');
    expect(result.message.sender.displayName).toBe('Ate Niña Concepción');
  });

  it('queues nothing at all for a statuses-only delivery', () => {
    // The most common payload in a live account. It must reach the end of the
    // route without touching the database.
    const rawBody = bytes('statuses-only');
    expect(verifyHubSignature(rawBody, sign(rawBody), APP_SECRET)).toBe(true);
    expect(parseWebhookPayload(JSON.parse(rawBody)).events).toEqual([]);
  });
});

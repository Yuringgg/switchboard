import type { Database } from '@switchboard/db';
import { describe, expect, it, vi } from 'vitest';

import type { ClaimedEvent } from '../src/claim';
import { ingestMeetingEvent, type MeetingEventPayload } from '../src/meeting-ingest';
import * as persistModule from '../src/persist';

/**
 * Ingesting a meeting transcript (`src/meeting-ingest.ts`).
 *
 * ── ⚠⚠ WHAT THESE ARE ACTUALLY GUARDING ────────────────────────────────────
 *
 * The worker runs as `service_role`, where **every RLS policy in migration
 * 0002 is inert**. On this path there is one thing separating tenants: the
 * `owner_id` that `claim.ts` read off the channels row.
 *
 * Meetings make that unusually easy to get wrong. `meeting-sweep.ts` knows the
 * owner — it read it from `meeting_bot_sessions` to do its work — so writing it
 * into the queued payload would be the natural thing to do, and reading it back
 * out here would look equally natural. It would also be a payload field
 * deciding who owns a message, which is precisely what ADR-026 and migration
 * 0016 exist to prevent.
 *
 * So the first test below plants a HOSTILE `ownerId` in the payload and proves
 * it is ignored. It would pass silently today and fail the moment somebody
 * "simplifies" the context out of the claimed event.
 */

const OWNER = '11111111-1111-4111-8111-111111111111';
const CHANNEL = '22222222-2222-4222-8222-222222222222';
const ATTACKER = '99999999-9999-4999-8999-999999999999';

function event(payload: unknown): ClaimedEvent {
  return {
    id: 'event-1',
    ownerId: OWNER,
    channelId: CHANNEL,
    channelType: 'meeting',
    externalId: 'rec-1',
    payload,
    attempts: 0,
  } as ClaimedEvent;
}

function transcriptPayload(overrides: Partial<MeetingEventPayload> = {}): MeetingEventPayload {
  return {
    recordingId: '3299fb14-bb93-4db3-bb17-a2fa64d29a84',
    startedAt: '2026-09-19T20:28:03.267Z',
    title: 'Client sync',
    meetingUrl: 'https://us05web.zoom.us/j/78581577133?pwd=secret',
    botId: '8b37ef2b-0bd2-4812-9e81-1ccae8973322',
    transcript: [
      {
        participant: {
          id: 1,
          name: 'Maria Santos',
          is_host: true,
          platform: 'unknown',
          email: null,
          extra_data: {},
        },
        words: [
          { text: 'We', start_timestamp: { relative: 1, absolute: null }, end_timestamp: { relative: 1.3, absolute: null } },
          { text: 'ship', start_timestamp: { relative: 1.4, absolute: null }, end_timestamp: { relative: 1.8, absolute: null } },
          { text: 'Thursday', start_timestamp: { relative: 1.9, absolute: null }, end_timestamp: { relative: 2.4, absolute: null } },
        ],
        language_code: 'en',
      },
    ],
    ...overrides,
  };
}

const db = {} as Database;

describe('ingestMeetingEvent', () => {
  it('takes owner_id from the CLAIMED EVENT, never from the payload', async () => {
    const spy = vi
      .spyOn(persistModule, 'persistMessage')
      .mockResolvedValue({ messageId: 'msg-1', created: true });

    /*
     * ⚠ A hostile payload claiming a different owner. The sweep genuinely knows
     * the owner, so a field like this is a plausible thing for a future change
     * to add — and the moment anything reads it, one tenant's meeting lands in
     * another tenant's console with no policy able to catch it.
     */
    const hostile = { ...transcriptPayload(), ownerId: ATTACKER, owner_id: ATTACKER };

    await ingestMeetingEvent(db, event(hostile));

    expect(spy).toHaveBeenCalledOnce();
    const ctx = spy.mock.calls[0]![1];
    expect(ctx.ownerId).toBe(OWNER);
    expect(ctx.channelId).toBe(CHANNEL);

    spy.mockRestore();
  });

  it('stores the whole payload verbatim, so a re-mapping is a backfill', async () => {
    const spy = vi
      .spyOn(persistModule, 'persistMessage')
      .mockResolvedValue({ messageId: 'msg-1', created: true });

    const payload = transcriptPayload();
    await ingestMeetingEvent(db, event(payload));

    // ⚠ The 4th argument is `payload_raw`. Meetings do not happen twice, so
    // what Recall returned has to survive verbatim — anything this first pass
    // got wrong is then fixable over stored data.
    expect(spy.mock.calls[0]![3]).toBe(payload);

    spy.mockRestore();
  });

  /*
   * ⚠ Skipped, not thrown. A throw fails the event, retries it to MAX_ATTEMPTS
   * and parks it in `failed` forever — for a transcript that will never
   * normalize differently however often it is retried.
   */
  it('skips an unusable transcript instead of failing the event', async () => {
    const spy = vi.spyOn(persistModule, 'persistMessage');

    const outcome = await ingestMeetingEvent(
      db,
      event(transcriptPayload({ transcript: [] })),
    );

    expect(outcome).toEqual({ created: 0, skipped: 1, createdIds: [] });
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('skips a payload that is not an object rather than throwing', async () => {
    for (const bad of [null, undefined, 'transcript', 42]) {
      const outcome = await ingestMeetingEvent(db, event(bad));
      expect(outcome.skipped, `${JSON.stringify(bad)} should be skipped`).toBe(1);
      expect(outcome.created).toBe(0);
    }
  });

  /*
   * ⚠⚠ The transcript carries no absolute time on any word. The recording's
   * start has to survive the queue hop as a real date, or every meeting lands
   * in January 1970 — sorting correctly among itself, so nothing looks wrong.
   */
  it('carries the recording start time through as the message date', async () => {
    const spy = vi
      .spyOn(persistModule, 'persistMessage')
      .mockResolvedValue({ messageId: 'msg-1', created: true });

    await ingestMeetingEvent(db, event(transcriptPayload()));

    const message = spy.mock.calls[0]![2];
    expect(message.sentAt.toISOString()).toBe('2026-09-19T20:28:03.267Z');
    expect(message.sentAt.getUTCFullYear()).toBe(2026);

    spy.mockRestore();
  });

  it('reports the created message id so Phase 4A can summarise it', async () => {
    const spy = vi
      .spyOn(persistModule, 'persistMessage')
      .mockResolvedValue({ messageId: 'msg-42', created: true });

    const outcome = await ingestMeetingEvent(db, event(transcriptPayload()));

    expect(outcome).toEqual({ created: 1, skipped: 0, createdIds: ['msg-42'] });

    spy.mockRestore();
  });

  it('reports nothing created when the message already existed', async () => {
    const spy = vi
      .spyOn(persistModule, 'persistMessage')
      .mockResolvedValue({ messageId: 'msg-42', created: false });

    const outcome = await ingestMeetingEvent(db, event(transcriptPayload()));

    expect(outcome).toEqual({ created: 0, skipped: 0, createdIds: [] });

    spy.mockRestore();
  });
});

import { describe, expect, it } from 'vitest';

import { fanOutToChannels } from '../src/lib/ingest';

const NOTIFICATION = { emailAddress: 'shared@company.com', historyId: '9911', pubsubMessageId: 'ps-1' };

describe('fanOutToChannels', () => {
  it('queues one row for a single connected channel', () => {
    const rows = fanOutToChannels([{ id: 'ch-1', owner_id: 'user-a' }], 'ps-1', NOTIFICATION);

    expect(rows).toEqual([
      {
        owner_id: 'user-a',
        channel_id: 'ch-1',
        external_id: 'ps-1',
        payload: NOTIFICATION,
        status: 'pending',
      },
    ]);
  });

  it('queues one row PER OWNER for a shared mailbox', () => {
    /*
     * The case that used to 500.
     *
     * Migration 0003 keys channels on (owner_id, type, display_name) and says
     * outright that two tenants connecting one shared mailbox is legitimate.
     * The route resolved with .maybeSingle(), which errors on two rows — so the
     * schema permitted a state ingest could not survive, and Pub/Sub would
     * retry that mailbox forever while both consoles stayed empty.
     */
    const rows = fanOutToChannels(
      [
        { id: 'ch-1', owner_id: 'user-a' },
        { id: 'ch-2', owner_id: 'user-b' },
      ],
      'ps-1',
      NOTIFICATION,
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.owner_id)).toEqual(['user-a', 'user-b']);
    expect(rows.map((r) => r.channel_id)).toEqual(['ch-1', 'ch-2']);
  });

  it('gives every owner their own copy rather than picking one', () => {
    // `.limit(1)` would have been the tempting fix and it is worse than the
    // crash: it delivers one tenant's mail to whichever row sorted first, which
    // is the one failure in this system no RLS policy can catch.
    const rows = fanOutToChannels(
      [
        { id: 'ch-1', owner_id: 'user-a' },
        { id: 'ch-2', owner_id: 'user-b' },
      ],
      'ps-1',
      NOTIFICATION,
    );

    expect(new Set(rows.map((r) => r.owner_id)).size).toBe(2);
  });

  it('repeats external_id across owners, which the schema allows', () => {
    // raw_events is unique on (channel_id, external_id) — migration 0004 — so
    // the same pubsub id under two channels is two rows, while a redelivery to
    // either still collides and is discarded.
    const rows = fanOutToChannels(
      [
        { id: 'ch-1', owner_id: 'user-a' },
        { id: 'ch-2', owner_id: 'user-b' },
      ],
      'ps-1',
      NOTIFICATION,
    );

    expect(rows.every((r) => r.external_id === 'ps-1')).toBe(true);
    expect(new Set(rows.map((r) => `${r.channel_id}:${r.external_id}`)).size).toBe(2);
  });

  it('takes owner_id from the channel row, never from the payload', () => {
    // Rule 1 of the ingest contract. The worker bypasses RLS, so this value is
    // the only thing keeping tenants apart.
    const hostile = { ...NOTIFICATION, owner_id: 'attacker', ownerId: 'attacker' };
    const rows = fanOutToChannels([{ id: 'ch-1', owner_id: 'user-a' }], 'ps-1', hostile);

    expect(rows[0]?.owner_id).toBe('user-a');
  });

  it('queues nothing when no channel has the mailbox connected', () => {
    // A watch outliving a disconnect. The route answers 200 — retrying will
    // never make a channel appear.
    expect(fanOutToChannels([], 'ps-1', NOTIFICATION)).toEqual([]);
  });

  it('drops rows that cannot be attributed instead of defaulting them', () => {
    const rows = fanOutToChannels(
      [
        { id: 'ch-1', owner_id: '' },
        { id: '', owner_id: 'user-b' },
        { id: 'ch-3', owner_id: 'user-c' },
      ] as { id: string; owner_id: string }[],
      'ps-1',
      NOTIFICATION,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.owner_id).toBe('user-c');
  });

  it('de-dupes a channel repeated within one notification', () => {
    // The unique index would reject the repeat anyway, but as a 23505 the route
    // counts it as a provider redelivery — a different thing, and it would read
    // as normal in the logs.
    const rows = fanOutToChannels(
      [
        { id: 'ch-1', owner_id: 'user-a' },
        { id: 'ch-1', owner_id: 'user-a' },
      ],
      'ps-1',
      NOTIFICATION,
    );

    expect(rows).toHaveLength(1);
  });

  it('is pure', () => {
    const channels = [{ id: 'ch-1', owner_id: 'user-a' }];
    expect(fanOutToChannels(channels, 'ps-1', NOTIFICATION)).toEqual(
      fanOutToChannels(channels, 'ps-1', NOTIFICATION),
    );
    expect(channels).toEqual([{ id: 'ch-1', owner_id: 'user-a' }]);
  });
});

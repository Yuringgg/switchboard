import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { whatsappAdapter } from '../src/index';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'whatsapp');
const APP_SECRET = 'test-app-secret';

function rawFixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.json`), 'utf8');
}

function signed(rawBody: string, secret = APP_SECRET): Headers {
  const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return new Headers({ 'x-hub-signature-256': `sha256=${digest}` });
}

/**
 * The WhatsApp adapter against the `ChannelAdapter` contract.
 *
 * This is the file that makes Phase 2's refactor checkpoint mean something. The
 * contract's original signatures could not be implemented by any adapter —
 * `verifyWebhook` had no secret, `parseWebhook` had to invent a `channelId`.
 * Nothing implemented the interface, so nothing failed. This does, so a future
 * edit that drifts away from what an adapter can actually do fails here.
 */
describe('whatsappAdapter satisfies ChannelAdapter', () => {
  it('declares its channel type', () => {
    expect(whatsappAdapter.type).toBe('whatsapp');
  });

  it('has no poll — WhatsApp is pure push', () => {
    /*
     * The asymmetry against Gmail is the entire reason this channel pair was
     * chosen (docs/04-ROADMAP.md Phase 2). Gmail is hybrid push/pull with a
     * cursor; WhatsApp has nothing to poll and `sync_state` stays empty for it.
     */
    expect(whatsappAdapter.poll).toBeUndefined();
  });

  it('has no send — outbound is deliberately out of scope (US-12)', () => {
    expect(whatsappAdapter.send).toBeUndefined();
  });

  describe('verifyWebhook', () => {
    const rawBody = rawFixture('text');

    it('accepts a correctly signed body', () => {
      expect(whatsappAdapter.verifyWebhook?.(rawBody, signed(rawBody), APP_SECRET)).toBe(true);
    });

    it('rejects a body signed with a different secret', () => {
      const headers = signed(rawBody, 'not-the-app-secret');
      expect(whatsappAdapter.verifyWebhook?.(rawBody, headers, APP_SECRET)).toBe(false);
    });

    it('rejects a missing signature header', () => {
      expect(whatsappAdapter.verifyWebhook?.(rawBody, new Headers(), APP_SECRET)).toBe(false);
    });

    it('rejects an empty secret rather than treating it as a match', () => {
      // Fail closed. Unset config must never mean "skip verification".
      expect(whatsappAdapter.verifyWebhook?.(rawBody, signed(rawBody), '')).toBe(false);
    });

    it('fails on a body that was parsed and re-serialized', () => {
      /*
       * The failure the whole design guards against, pinned. The data is
       * identical; the bytes are not — JSON.stringify reorders nothing here but
       * drops every newline and indent, and the digest is over bytes.
       */
      const reserialized = JSON.stringify(JSON.parse(rawBody));
      expect(reserialized).not.toBe(rawBody);
      expect(JSON.parse(reserialized)).toEqual(JSON.parse(rawBody));

      expect(whatsappAdapter.verifyWebhook?.(reserialized, signed(rawBody), APP_SECRET)).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    it('returns account references, never channel ids', () => {
      const refs = whatsappAdapter.parseWebhook?.(JSON.parse(rawFixture('batch'))) ?? [];

      expect(refs).toHaveLength(4);
      expect(refs[0]?.accountRef).toBe('106540352242922');
      expect(refs[0]?.externalId).toMatch(/^wamid\./);
      // A channel id would require a database lookup — the lookup that decides
      // owner_id, in a system where the worker bypasses RLS.
      expect(refs[0]).not.toHaveProperty('channelId');
    });

    it('returns a payload that normalize alone can consume', () => {
      // The rule the checkpoint produced: a stored payload is self-sufficient.
      const refs = whatsappAdapter.parseWebhook?.(JSON.parse(rawFixture('text'))) ?? [];
      const result = whatsappAdapter.normalize(refs[0]?.payload);

      expect(result.ok).toBe(true);
      expect(result.ok && result.message.direction).toBe('inbound');
    });
  });

  describe('normalize', () => {
    it('reports rather than throws on a payload it cannot use', () => {
      expect(() => whatsappAdapter.normalize({ nonsense: true })).not.toThrow();
      expect(whatsappAdapter.normalize({ nonsense: true }).ok).toBe(false);
    });
  });
});

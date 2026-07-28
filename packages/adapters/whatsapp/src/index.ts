import {
  verifyHubSignature,
  type ChannelAdapter,
  type InboundRef,
  type NormalizeResult,
} from '@switchboard/core';

import { normalizeWhatsAppMessage } from './normalize';
import { parseWebhookPayload, type WhatsAppEnvelope } from './parse';

export { parseWebhookPayload } from './parse';
export type {
  InboundEvent,
  ParsedWebhook,
  ParseSkips,
  WhatsAppEnvelope,
} from './parse';

export { normalizeWhatsAppMessage } from './normalize';

export type {
  WhatsAppChange,
  WhatsAppChangeValue,
  WhatsAppContact,
  WhatsAppContactCard,
  WhatsAppEntry,
  WhatsAppLocation,
  WhatsAppMedia,
  WhatsAppMessage,
  WhatsAppMetadata,
  WhatsAppStatus,
  WhatsAppWebhookPayload,
} from './types';

/**
 * The WhatsApp adapter, as a `ChannelAdapter`.
 *
 * ── Why this object exists when the console and worker call the functions ────
 *
 * `docs/02-ARCHITECTURE.md` §2 calls the adapter contract "the heart of the
 * design", and Phase 2 exists to test that claim against a structurally
 * different channel. A contract nothing implements is a comment. This is the
 * proof that the amended interface is satisfiable end to end by a real channel
 * — and it is what will fail to compile if a future edit to `ChannelAdapter`
 * drifts away from what an adapter can actually do again.
 *
 * The call sites still use the named functions directly, because each needs
 * something the interface deliberately does not carry: ingest needs the
 * `accountRef` → channel lookup and the skip counts for its logs, and the
 * worker needs to distinguish "this message cannot be normalized" from "this
 * batch failed". Both are visible through `parseWebhookPayload` and absent
 * from `parseWebhook`, which flattens to the contract's shape.
 *
 * ⚠ There is no `poll`. WhatsApp is pure push — nothing to poll, no cursor,
 * and `sync_state` stays empty for a WhatsApp channel. That asymmetry against
 * Gmail is the whole reason this pair of channels was chosen.
 */
export const whatsappAdapter: ChannelAdapter = {
  type: 'whatsapp',

  /**
   * Meta's `X-Hub-Signature-256`: HMAC-SHA256 over the raw body, hex, keyed
   * with the app secret. The implementation lives in `core` because it is
   * security-critical and has to be testable without a Next request.
   */
  verifyWebhook(rawBody: string, headers: Headers, secret: string): boolean {
    return verifyHubSignature(rawBody, headers.get('x-hub-signature-256'), secret);
  },

  parseWebhook(payload: unknown): InboundRef[] {
    return parseWebhookPayload(payload).events.map((event) => ({
      accountRef: event.phoneNumberId,
      externalId: event.externalId,
      payload: event.envelope,
    }));
  },

  normalize(payload: unknown): NormalizeResult {
    return normalizeWhatsAppMessage(payload as WhatsAppEnvelope);
  },
};

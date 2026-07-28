import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeWhatsAppMessage } from '../src/normalize';
import { parseWebhookPayload, type WhatsAppEnvelope } from '../src/parse';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'whatsapp');

/** Parse a fixture and hand back the envelope the worker would normalize. */
function envelope(name: string, index = 0): WhatsAppEnvelope {
  const payload = JSON.parse(
    readFileSync(join(FIXTURES, `${name}.json`), 'utf8'),
  ) as unknown;

  const parsed = parseWebhookPayload(payload).events[index];
  if (!parsed) throw new Error(`fixture ${name} has no event at index ${index}`);
  return parsed.envelope;
}

function normalized(name: string, index = 0) {
  const result = normalizeWhatsAppMessage(envelope(name, index));
  if (!result.ok) throw new Error(result.reason);
  return result.message;
}

describe('normalizeWhatsAppMessage', () => {
  describe('a text message', () => {
    const message = normalized('text');

    it('carries the body', () => {
      expect(message.bodyText).toBe('Good morning! Confirming our meeting Thursday 3pm.');
    });

    it('is inbound, and the sender is the customer', () => {
      expect(message.direction).toBe('inbound');
      expect(message.sender.externalId).toBe('639170000001');
      expect(message.sender.channelType).toBe('whatsapp');
      expect(message.sender.displayName).toBe('Marisol Enriquez');
    });

    it('records the business number as the recipient identity', () => {
      // Same as Gmail with the connected mailbox — this is what makes a
      // contact's history complete rather than sender-only.
      expect(message.recipients).toEqual([
        { channelType: 'whatsapp', externalId: '15550783881' },
      ]);
    });

    it('threads on the counterparty, because a chat is a conversation', () => {
      // WhatsApp has no thread id. The conversation IS the chat with a person.
      expect(message.externalThreadId).toBe('639170000001');
    });

    it('reads the timestamp as unix SECONDS', () => {
      // Read as milliseconds this lands in January 1970 — and a timeline of
      // only WhatsApp messages still sorts correctly, so nothing looks wrong.
      expect(message.sentAt.toISOString()).toBe('2026-07-28T12:00:00.000Z');
      // The same digits read as milliseconds would be 1970-01-21.
      expect(new Date(1785240000).getUTCFullYear()).toBe(1970);
    });

    it('has no subject, ever', () => {
      // Email has one, chat does not. The console renders the opening line as
      // the headline instead, so chat does not read as degraded email.
      expect(message.subject).toBeUndefined();
    });

    it('has no attachments', () => {
      expect(message.attachments).toEqual([]);
    });
  });

  describe('Taglish', () => {
    const message = normalized('taglish');

    it('preserves code-switched text, accents and emoji intact', () => {
      // The corpus is Taglish. Phase 4 embeds body_text, and mojibake here
      // makes a message unfindable by the words it actually contains.
      expect(message.bodyText).toContain('baka ma-late ako ng konti');
      expect(message.bodyText).toContain('🙏');
    });

    it('preserves an accented display name', () => {
      expect(message.sender.displayName).toBe('Ate Niña Concepción');
    });
  });

  describe('media', () => {
    it('uses an image caption as the body', () => {
      const message = normalized('image-with-caption');
      expect(message.bodyText).toBe('Ito yung signed copy ng contract, page 4.');
    });

    it('emits a reference with no URL and no bytes', () => {
      const message = normalized('image-with-caption');
      expect(message.attachments).toEqual([
        { externalId: '1284551239007744', mimeType: 'image/jpeg' },
      ]);
      // A URL would mean I/O, and normalize is pure. See AttachmentRef in core.
      expect(message.attachments[0]).not.toHaveProperty('url');
    });

    it("leaves body_text EMPTY for media with no caption, and does not invent one", () => {
      /*
       * '' is legal and meaningful — the column is not null and a photo with no
       * caption genuinely has no text. Writing "[image]" would put a word into
       * body_text that nobody sent, and Phase 4 embeds that column: a corpus
       * salted with machine-written tokens returns them in search results.
       */
      const message = normalized('image-no-caption');
      expect(message.bodyText).toBe('');
      expect(message.attachments).toHaveLength(1);
    });

    it('keeps a document filename, including non-ASCII', () => {
      const message = normalized('document');
      expect(message.attachments).toEqual([
        {
          externalId: '1284551239007746',
          filename: 'Kasunduan — Panghuling Bersyon.pdf',
          mimeType: 'application/pdf',
        },
      ]);
    });

    it('invents no filename for media that has none', () => {
      // A fabricated "image.jpg" would read as the sender's own name for it.
      const message = normalized('image-no-caption');
      expect(message.attachments[0]).not.toHaveProperty('filename');
    });

    it('treats a voice note as text-less media', () => {
      const message = normalized('voice-note');
      expect(message.bodyText).toBe('');
      expect(message.attachments[0]?.mimeType).toBe('audio/ogg; codecs=opus');
    });
  });

  describe('messages whose content is not a body', () => {
    it('uses a location name and address as searchable text', () => {
      // These words came from the sender's map pin, so embedding them is
      // faithful rather than invented — unlike an "[image]" placeholder.
      const message = normalized('location');
      expect(message.bodyText).toBe(
        'Ayala Triangle Gardens\nPaseo de Roxas, Makati, Metro Manila',
      );
    });

    it('stores a reaction as its emoji rather than dropping it', () => {
      const message = normalized('reaction');
      expect(message.bodyText).toBe('👍');
      // What it reacted to survives in payload_raw, which the worker stores.
      expect(envelope('reaction').message.reaction?.message_id).toMatch(/^wamid\./);
    });

    it('stores an unsupported message rather than losing the fact it arrived', () => {
      const message = normalized('unsupported');
      expect(message.bodyText).toBe('');
      expect(message.externalId).toMatch(/^wamid\./);
    });
  });

  describe('a reply', () => {
    const message = normalized('reply-with-context');

    it('threads on the chat, NOT on the quoted message', () => {
      // context.id names a quoted message, not a thread. Using it would make
      // every quoted reply its own conversation.
      expect(message.externalThreadId).toBe('639170000001');
    });

    it('stays inbound even though it quotes the business number', () => {
      expect(message.direction).toBe('inbound');
    });
  });

  describe('direction', () => {
    it('marks a message from the business number outbound', () => {
      const base = envelope('text');
      const result = normalizeWhatsAppMessage({
        ...base,
        message: { ...base.message, from: '15550783881' },
      });

      expect(result.ok && result.message.direction).toBe('outbound');
    });

    it('compares numbers by digits, ignoring formatting', () => {
      // display_phone_number is a formatted string; `from` is bare digits.
      // Comparing with === marks every inbound message outbound, which renders
      // the entire timeline as "You".
      const base = envelope('text');
      const result = normalizeWhatsAppMessage({
        ...base,
        metadata: { ...base.metadata, display_phone_number: '+1 (555) 078-3881' },
        message: { ...base.message, from: '15550783881' },
      });

      expect(result.ok && result.message.direction).toBe('outbound');
    });

    it('does not treat an absent business number as a match', () => {
      const base = envelope('text');
      const result = normalizeWhatsAppMessage({
        ...base,
        metadata: {},
        message: { ...base.message, from: '' },
      });

      // Empty must never equal empty here, or an absent display_phone_number
      // would make an arbitrary sender look like the business itself.
      expect(result.ok).toBe(false);
    });
  });

  describe('unusable input', () => {
    /*
     * Reported, never thrown. A throw fails the whole queued event, burns its
     * attempts and parks it in `failed` — for one odd message that could have
     * been skipped while the rest of the batch went through.
     */
    it('reports a missing id', () => {
      const base = envelope('text');
      const result = normalizeWhatsAppMessage({ ...base, message: { ...base.message, id: undefined } });
      expect(result).toEqual({ ok: false, reason: 'message has no id' });
    });

    it('reports a missing sender', () => {
      const base = envelope('text');
      const result = normalizeWhatsAppMessage({ ...base, message: { ...base.message, from: undefined } });
      expect(result).toEqual({ ok: false, reason: 'message has no sender' });
    });

    it('reports an unusable timestamp', () => {
      const base = envelope('text');
      for (const timestamp of [undefined, '', 'yesterday', '0', '-5']) {
        const result = normalizeWhatsAppMessage({
          ...base,
          message: { ...base.message, timestamp },
        });
        expect(result).toEqual({ ok: false, reason: 'message has no usable timestamp' });
      }
    });

    it('does not throw on an empty envelope', () => {
      expect(() => normalizeWhatsAppMessage({} as WhatsAppEnvelope)).not.toThrow();
      expect(normalizeWhatsAppMessage(undefined as unknown as WhatsAppEnvelope).ok).toBe(false);
    });
  });

  it('is pure — the same envelope always normalizes identically', () => {
    // The property every fixture-driven adapter test rests on. If normalize
    // ever reaches for the network or the clock, this is what fails.
    const input = envelope('text');
    expect(normalizeWhatsAppMessage(input)).toEqual(normalizeWhatsAppMessage(input));
  });

  it('preserves externalId, which is the idempotency key', () => {
    // `messages` carries unique (channel_id, external_id).
    const input = envelope('batch', 2);
    const result = normalizeWhatsAppMessage(input);
    expect(result.ok && result.message.externalId).toBe(input.message.id);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeGmailMessage, parseAddressList, type GmailMessage } from '../src/normalize';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'gmail');
const MAILBOX = 'owner@example.com';

function fixture(name: string): GmailMessage {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as GmailMessage;
}

describe('normalizeGmailMessage', () => {
  describe('multipart/alternative (text + html)', () => {
    const result = normalizeGmailMessage(fixture('multipart-alternative'), MAILBOX);

    it('normalizes', () => {
      expect(result.ok).toBe(true);
    });

    it('prefers the real text/plain part over converting the html', () => {
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.bodyText).toBe('Plain part.\nSecond line.');
      expect(result.message.bodyHtml).toContain('<div>');
    });

    it('marks a self-sent message outbound', () => {
      // Observed on real mail: a message to yourself carries BOTH SENT and
      // INBOX, so labels cannot decide direction. The From address can.
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.direction).toBe('outbound');
    });

    it('carries the thread id and subject', () => {
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.externalThreadId).toBe('fixturethread001');
      expect(result.message.subject).toBe('Quarterly handover notes');
    });

    it('uses internalDate, not the sender-controlled Date header', () => {
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.sentAt.getTime()).toBe(1785000000000);
    });
  });

  describe('nested html-only (multipart/mixed > related > text/html)', () => {
    const result = normalizeGmailMessage(fixture('nested-html-only'), MAILBOX);

    it('finds the body several levels deep', () => {
      // Scanning one level would find nothing here.
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.message.bodyText.length).toBeGreaterThan(0);
    });

    it('synthesises body_text from html when there is no text/plain', () => {
      // The majority case in a real inbox, and body_text is NOT NULL.
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.bodyText).toContain('Hello there.');
      expect(result.message.bodyText).toContain('First item');
    });

    it('keeps link destinations', () => {
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.bodyText).toContain('https://service.example/report');
    });

    it('drops css and never leaks it into the body', () => {
      // This text gets embedded in Phase 4; tag soup becomes bad retrieval.
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.bodyText).not.toContain('color:red');
      expect(result.message.bodyText).not.toContain('<');
    });

    it('does not count an inline image as an attachment', () => {
      // It has an attachmentId but no filename — a logo, not an attachment.
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.attachments).toEqual([]);
    });

    it('marks mail from someone else inbound', () => {
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.direction).toBe('inbound');
    });
  });

  describe('bare text/html payload with no parts', () => {
    const result = normalizeGmailMessage(fixture('bare-html'), MAILBOX);

    it('reads the body straight off the payload', () => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.message.bodyText).toContain('Line one');
      expect(result.message.bodyText).toContain('Line two');
    });

    it('strips script contents entirely', () => {
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.bodyText).not.toContain('track()');
    });

    it('reads headers case-insensitively', () => {
      // This fixture uses `Mime-Version`; another uses `MIME-Version`. Both are
      // real, and a case-sensitive lookup silently loses the subject.
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.subject).toBe('A newsletter');
    });
  });

  describe('attachments', () => {
    const result = normalizeGmailMessage(fixture('with-attachment'), MAILBOX);

    it('collects only parts with both a filename and an attachmentId', () => {
      if (!result.ok) throw new Error(result.reason);
      const names = result.message.attachments.map((a) => a.filename).sort();
      expect(names).toEqual(['contract.pdf', 'notes.txt']);
    });

    it('records the provider id and never a URL', () => {
      // AttachmentRef carries no URL by design — a URL would force normalize to
      // do I/O, and its purity is what makes fixtures viable.
      if (!result.ok) throw new Error(result.reason);
      const pdf = result.message.attachments.find((a) => a.filename === 'contract.pdf');
      expect(pdf?.externalId).toBe('attach-pdf-id');
      expect(pdf?.sizeBytes).toBe(84213);
      expect(pdf).not.toHaveProperty('blobUrl');
    });

    it('never lets an attached text file become the message body', () => {
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.bodyText).toBe('See attached.');
      expect(result.message.bodyText).not.toContain('MUST NOT BECOME THE BODY');
    });

    it('keeps a quoted display name containing a comma as one recipient', () => {
      if (!result.ok) throw new Error(result.reason);
      expect(result.message.sender.displayName).toBe('Chua, Lei');
      expect(result.message.recipients.map((r) => r.externalId)).toEqual([
        'owner@example.com',
        'jane@example.com',
        'cc-person@example.com',
      ]);
    });
  });

  describe('refusals', () => {
    it('refuses a message with no parseable From', () => {
      // sender_identity drives contact resolution; guessing would attribute
      // someone's mail to the wrong person.
      const result = normalizeGmailMessage(fixture('missing-from'), MAILBOX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/From/);
    });

    it.each([
      ['no id', { threadId: 't', internalDate: '1' }],
      ['no threadId', { id: 'm', internalDate: '1' }],
      ['no internalDate', { id: 'm', threadId: 't' }],
      ['unparseable internalDate', { id: 'm', threadId: 't', internalDate: 'soon' }],
    ])('refuses a message with %s', (_label, partial) => {
      const result = normalizeGmailMessage(partial as GmailMessage, MAILBOX);
      expect(result.ok).toBe(false);
    });

    it('never throws on hostile input', () => {
      for (const input of [null, undefined, {}, { id: 1 }, { payload: 'x' }]) {
        expect(() => normalizeGmailMessage(input as never, MAILBOX)).not.toThrow();
      }
    });
  });
});

describe('parseAddressList', () => {
  it('parses name and bare forms', () => {
    expect(parseAddressList('A B <a@b.com>, c@d.com')).toEqual([
      { channelType: 'gmail', externalId: 'a@b.com', displayName: 'A B' },
      { channelType: 'gmail', externalId: 'c@d.com' },
    ]);
  });

  it('does not split on a comma inside a quoted display name', () => {
    const parsed = parseAddressList('"Doe, Jane" <jane@x.com>, bob@y.com');
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.displayName).toBe('Doe, Jane');
  });

  it('lowercases addresses so identity resolution matches', () => {
    // Otherwise Owner@Example.com and owner@example.com become two contacts.
    expect(parseAddressList('Owner <Owner@Example.COM>')[0]?.externalId).toBe(
      'owner@example.com',
    );
  });

  it('decodes the display name AFTER splitting, not before', () => {
    // Given the raw wire form, the comma inside the encoded-word must not act
    // as a list separator.
    const encoded = `=?UTF-8?B?${Buffer.from('Dela Cruz, Maria').toString('base64')}?=`;
    const parsed = parseAddressList(`${encoded} <maria@x.com>, bob@y.com`);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.displayName).toBe('Dela Cruz, Maria');
    expect(parsed[1]?.externalId).toBe('bob@y.com');
  });

  it('joins encoded-words split across a folded header', () => {
    const a = `=?UTF-8?B?${Buffer.from('Dela ').toString('base64')}?=`;
    const b = `=?UTF-8?B?${Buffer.from('Cruz').toString('base64')}?=`;
    // \r\n + indent is how a folded header arrives if it is not unfolded.
    expect(parseAddressList(`${a}\r\n ${b} <x@y.com>`)[0]?.displayName).toBe('Dela Cruz');
  });

  it('returns empty for missing or junk input', () => {
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddressList('')).toEqual([]);
    expect(parseAddressList('not an address')).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { charsetFromContentType, decodeBytes, decodeEncodedWords } from '../src/decode';
import { normalizeGmailMessage, type GmailMessage } from '../src/normalize';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'gmail');
const MAILBOX = 'owner@example.com';

function fixture(name: string): GmailMessage {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as GmailMessage;
}

describe('decodeEncodedWords', () => {
  it('decodes a base64 encoded-word', () => {
    expect(decodeEncodedWords('=?UTF-8?B?VGFwb3MgbmE=?=')).toBe('Tapos na');
  });

  it('decodes a Q encoded-word, with _ as space', () => {
    expect(decodeEncodedWords('=?UTF-8?Q?Mar=C3=ADa_Santos?=')).toBe('María Santos');
  });

  it('drops the whitespace between adjacent encoded-words', () => {
    // RFC 2047 §6.2 — that space is a separator, not content. Long subjects are
    // split this way, and keeping it injects a space mid-sentence.
    const a = `=?UTF-8?B?${Buffer.from('Paalala: bukas ang ').toString('base64')}?=`;
    const b = `=?UTF-8?B?${Buffer.from('miting sa opisina').toString('base64')}?=`;
    expect(decodeEncodedWords(`${a} ${b}`)).toBe('Paalala: bukas ang miting sa opisina');
  });

  it('handles emoji and ñ, which is the point for a Taglish corpus', () => {
    const text = 'Tapos na ang ulat ñ — Pasensya na po 🙏';
    const encoded = `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;
    expect(decodeEncodedWords(encoded)).toBe(text);
  });

  it('decodes a legacy charset encoded-word', () => {
    expect(decodeEncodedWords('=?ISO-8859-1?Q?Reuni=F3n?=')).toBe('Reunión');
  });

  it('leaves a plain header untouched', () => {
    expect(decodeEncodedWords('Quarterly handover notes')).toBe('Quarterly handover notes');
    expect(decodeEncodedWords('')).toBe('');
    expect(decodeEncodedWords(undefined)).toBeUndefined();
  });

  it('decodes an encoded-word embedded in a larger header', () => {
    expect(decodeEncodedWords('=?UTF-8?Q?Mar=C3=ADa?= <maria@example.com>')).toBe(
      'María <maria@example.com>',
    );
  });

  it('leaves a malformed encoded-word visible rather than dropping the header', () => {
    // Visible nonsense beats a silently missing subject.
    const malformed = '=?UTF-8?B?!!!not-base64!!!?=';
    expect(() => decodeEncodedWords(malformed)).not.toThrow();
    expect(decodeEncodedWords('=?BOGUS-CHARSET?B?QUJD?=')).toBeTruthy();
  });

  it('never throws on hostile input', () => {
    for (const value of ['=?', '=?a?b?c?=', '=?UTF-8?Z?xx?=', '=?'.repeat(50)]) {
      expect(() => decodeEncodedWords(value)).not.toThrow();
    }
  });
});

describe('decodeBytes', () => {
  it('decodes windows-1252 bytes that UTF-8 would mangle', () => {
    const bytes = Buffer.from('Reunión', 'latin1');
    expect(decodeBytes(bytes, 'windows-1252')).toBe('Reunión');
    // Proving the failure being prevented: as UTF-8 the character is lost.
    expect(decodeBytes(bytes, 'utf-8')).not.toBe('Reunión');
  });

  it('treats iso-8859-1 as windows-1252, which is what senders mean', () => {
    expect(decodeBytes(Buffer.from('café', 'latin1'), 'ISO-8859-1')).toBe('café');
  });

  it('falls back to utf-8 for an unknown charset instead of throwing', () => {
    expect(decodeBytes(Buffer.from('hello'), 'x-made-up-charset')).toBe('hello');
  });

  it('replaces an undecodable byte rather than losing the message', () => {
    expect(() => decodeBytes(Buffer.from([0xff, 0xfe, 0x41]), 'utf-8')).not.toThrow();
  });
});

describe('charsetFromContentType', () => {
  it.each([
    ['text/plain; charset=UTF-8', 'UTF-8'],
    ['text/html; charset="ISO-8859-1"', 'ISO-8859-1'],
    ['text/plain;charset=windows-1252;format=flowed', 'windows-1252'],
    ['text/plain', undefined],
    [undefined, undefined],
  ])('%s → %s', (input, expected) => {
    expect(charsetFromContentType(input)).toBe(expected);
  });
});

describe('normalize with real encodings', () => {
  it('decodes an encoded Taglish subject', () => {
    const result = normalizeGmailMessage(fixture('encoded-headers'), MAILBOX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.subject).toBe('Tapos na ang ulat ñ — Pasensya na po 🙏');
    // The failure this guards: the raw wrapper reaching the database.
    expect(result.message.subject).not.toContain('=?');
  });

  it('decodes a Q-encoded display name on the sender', () => {
    const result = normalizeGmailMessage(fixture('encoded-headers'), MAILBOX);
    if (!result.ok) throw new Error(result.reason);
    expect(result.message.sender.displayName).toBe('María Santos');
    expect(result.message.sender.externalId).toBe('maria@example.com');
  });

  it('decodes each part with its OWN charset', () => {
    // This message declares ISO-8859-1 on text/plain and UTF-8 on text/html —
    // ordinary for older clients, and impossible to get right with one global
    // assumption.
    const result = normalizeGmailMessage(fixture('latin1-body'), MAILBOX);
    if (!result.ok) throw new Error(result.reason);

    expect(result.message.bodyText).toContain('Reunión');
    expect(result.message.bodyText).toContain('miércoles');
    expect(result.message.bodyText).not.toContain('�');
    expect(result.message.bodyHtml).toContain('miércoles');
  });

  it('decodes a legacy-charset subject', () => {
    const result = normalizeGmailMessage(fixture('latin1-body'), MAILBOX);
    if (!result.ok) throw new Error(result.reason);
    expect(result.message.subject).toBe('Reunión');
  });

  it('decodes an encoded attachment filename', () => {
    const result = normalizeGmailMessage(fixture('encoded-filename'), MAILBOX);
    if (!result.ok) throw new Error(result.reason);
    expect(result.message.attachments[0]?.filename).toBe('Kontrata ñ.pdf');
  });

  it('leaves ASCII fixtures byte-identical', () => {
    // The decode path must not disturb the common case.
    const result = normalizeGmailMessage(fixture('multipart-alternative'), MAILBOX);
    if (!result.ok) throw new Error(result.reason);
    expect(result.message.subject).toBe('Quarterly handover notes');
    expect(result.message.bodyText).toBe('Plain part.\nSecond line.');
  });
});

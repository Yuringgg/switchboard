/**
 * Character decoding for mail.
 *
 * ⚠ This matters more here than in most projects: the corpus is **Taglish**,
 * and Filipino senders routinely produce `ñ`, accented vowels and emoji. Every
 * one of those arrives encoded, and a decoder that assumes clean ASCII does not
 * fail loudly — it stores mojibake. That mojibake is then embedded in Phase 4,
 * so a message becomes permanently unfindable by the words it actually
 * contains, and nothing anywhere reports an error.
 */

/**
 * Decode bytes using a declared charset.
 *
 * `TextDecoder` handles the legacy encodings mail still uses. Note WHATWG maps
 * `iso-8859-1` onto `windows-1252`, which is what mail clients do in practice
 * anyway — real senders label windows-1252 as ISO-8859-1 constantly.
 */
export function decodeBytes(bytes: Buffer, charset?: string): string {
  const label = (charset ?? 'utf-8').trim().toLowerCase();

  try {
    // `fatal: false` so an undecodable byte becomes U+FFFD rather than throwing.
    // Losing one character beats losing the whole message.
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    // Unknown label — TextDecoder throws on construction. UTF-8 is the best
    // guess for anything modern and degrades gracefully for ASCII.
    return bytes.toString('utf8');
  }
}

/** Pull `charset` out of a Content-Type header value. */
export function charsetFromContentType(contentType: string | undefined): string | undefined {
  if (!contentType) return undefined;
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
  return match?.[1];
}

/** Gmail's base64url: `-` and `_` for `+` and `/`, padding omitted. */
export function base64UrlToBuffer(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Quoted-printable as used INSIDE an encoded-word: `_` is a space. */
function decodeQEncoding(text: string): Buffer {
  const bytes: number[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '_') {
      bytes.push(0x20);
      continue;
    }

    if (char === '=' && i + 2 < text.length) {
      const hex = text.slice(i + 1, i + 3);
      const value = Number.parseInt(hex, 16);
      if (/^[0-9a-f]{2}$/i.test(hex) && Number.isFinite(value)) {
        bytes.push(value);
        i += 2;
        continue;
      }
    }

    bytes.push(char!.charCodeAt(0) & 0xff);
  }

  return Buffer.from(bytes);
}

/**
 * Decode RFC 2047 encoded-words: `=?charset?B|Q?text?=`.
 *
 * ⚠ Gmail does NOT decode these. `users.messages.get` returns header values
 * exactly as they arrived, so a subject reading "Tapos na ang ulat ñ" reaches
 * us as `=?UTF-8?B?VGFwb3MgbmEgYW5nIHVsYXQgw7E=?=` and — untouched — is what
 * gets written to `messages.subject` and shown in the timeline.
 *
 * Anything that is not an encoded-word passes through unchanged, so this is
 * safe to apply to every header.
 */
export function decodeEncodedWords(value: string | undefined): string | undefined {
  if (!value) return value;
  if (!value.includes('=?')) return value; // Fast path: most headers are plain.

  // RFC 2047 §6.2: whitespace BETWEEN two adjacent encoded-words is a
  // separator, not content, and must be dropped. Long subjects are split across
  // several words, and keeping the gaps injects spaces mid-word.
  //
  // `\s` rather than `[ \t]` so a folded header — CRLF plus indent — is covered
  // too. Gmail normally unfolds, but a header it passes through verbatim would
  // otherwise re-introduce the gap this line exists to remove.
  const joined = value.replace(/\?=\s+=\?/g, '?==?');

  return joined.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, charset: string, encoding: string, text: string) => {
      try {
        const bytes =
          encoding.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : decodeQEncoding(text);
        return decodeBytes(bytes, charset);
      } catch {
        // Malformed encoded-word: leave it as it arrived rather than dropping
        // the header. Visible nonsense beats a silently missing subject.
        return whole;
      }
    },
  );
}

/**
 * Convert an HTML email body to plain text.
 *
 * ⚠ This is not a nicety. `messages.body_text` is NOT NULL, and **most real
 * email has no text/plain part at all** — inspecting a live inbox, two of three
 * messages were HTML-only (`multipart/mixed > multipart/related > text/html`,
 * and a bare `text/html`). Without this, ingestion violates the constraint on
 * the majority of mail.
 *
 * It also feeds Phase 4: this text is what gets chunked and embedded, so tag
 * soup here becomes bad retrieval later.
 *
 * Deliberately dependency-free and lossy. It is not trying to render HTML —
 * only to recover the words a human would read, in roughly the right order.
 */

/** Entities common in real mail. Numeric forms are handled separately. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      safeFromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function safeFromCodePoint(code: number): string {
  // A malformed entity must not throw — this runs over arbitrary inbound mail.
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

export function htmlToText(html: string): string {
  if (!html) return '';

  let text = html;

  // Content that is never read as prose. Removed wholesale, including the tags,
  // or their contents leak into the body as literal CSS and JavaScript — which
  // would then be embedded and searched in Phase 4.
  text = text.replace(/<(script|style|head|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // Comments, including Outlook's conditional blocks.
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');

  // Preserve a link's destination when the anchor text does not already contain
  // it. Losing every URL from an email makes the archive markedly less useful.
  text = text.replace(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').trim();
      if (!label) return href;
      if (label.includes(href) || href.includes(label)) return label;
      if (href.startsWith('mailto:')) return label;
      return `${label} (${href})`;
    },
  );

  // Structural breaks become newlines BEFORE tags are stripped, or every block
  // element runs together into one unreadable line.
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table|section|article)\s*>/gi, '\n');
  text = text.replace(/<(hr|\/thead|\/tbody)\s*\/?>/gi, '\n');
  // Table cells are columns, not lines — a tab keeps them on one row.
  text = text.replace(/<\/t[dh]\s*>/gi, '\t');
  text = text.replace(/<li\b[^>]*>/gi, '\n• ');

  // Everything else.
  text = text.replace(/<[^>]+>/g, '');

  text = decodeEntities(text);

  // Whitespace tidy-up, preserving paragraph structure.
  text = text.replace(/\r\n?/g, '\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/ *\n */g, '\n');
  // Three or more blank lines is layout, not meaning.
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

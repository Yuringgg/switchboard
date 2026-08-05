import type { Metadata, Viewport } from 'next';
import { Archivo, Martian_Mono } from 'next/font/google';

import { THEME_INIT_SCRIPT } from '@/lib/theme';

import './globals.css';

/**
 * Two families, each with a job.
 *
 * ── ⚠ Why these two and not the previous pair ────────────────────────────────
 *
 * This was **Instrument Sans + IBM Plex Mono** until 2026-08-06. Ms. Maria's
 * note on the console was *"halatang ginawa mo siya sa AI — try to change the
 * font, the spacing, the way you present it"*, and she was reading something
 * real: both of those faces sit on the reflex-reject list of training-data
 * defaults that `.agents/skills/impeccable/reference/brand.md` keeps, which is
 * to say they are the two fonts a generator reaches for first. The tell was
 * never the layout. It was the letterforms.
 *
 * The split itself is NOT a default and is kept: one family for anything a
 * person wrote, one mono for anything the machine knows. On a monitoring
 * console the eye has to separate "what arrived" from "what the system is
 * doing", and a change of voice does that faster than a change of colour.
 *
 * **Archivo** (Omnibus-Type) carries the human half — subjects, names, message
 * bodies. A grotesque drawn for high-performance small text: tall x-height,
 * slightly narrow, sturdy at 14px in a dense list, and closer to signage than
 * to a UI font, which is the register this thing wants.
 *
 * **Martian Mono** carries the machine half — timestamps, addresses, counts,
 * state, the wordmark, the keycaps. Squared terminals and flat joins; it reads
 * as *engraved onto a panel* rather than typed into an editor, which is the one
 * metaphor this product is built on. It is wider than Plex was, so the label
 * tracking in `globals.css` came down from 0.16em to 0.1em in the same change —
 * see the note on `--text-label`.
 *
 * Tabular figures in both, so a column of times does not shift width as the
 * digits change.
 */
const sans = Archivo({
  subsets: ['latin'],
  variable: '--font-sans-archivo',
  display: 'swap',
});

const mono = Martian_Mono({
  subsets: ['latin'],
  variable: '--font-mono-martian',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Switchboard',
  description:
    'Gmail and WhatsApp in one ordered timeline, read by a model that shows its work.',
};

export const viewport: Viewport = {
  // Declares the document renders in either mode. The init script then pins
  // `style.color-scheme` on <html> to the resolved one, which is what actually
  // themes the scrollbar and the form controls.
  colorScheme: 'light dark',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    /*
     * `suppressHydrationWarning` is required and is narrow in effect: it
     * applies to this element's own attributes only, not to the tree below.
     * The theme script runs before React and writes `class` and
     * `style.color-scheme` on <html>, so the server's markup and the DOM React
     * hydrates into legitimately differ. Without it, React warns on every load
     * about a mismatch that is the feature working.
     */
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Blocking, inline, and first — before the stylesheet and before any
          paint. Deferred or moved below, the page renders light and then flips,
          and the flash is worst for exactly the person the feature is for.
          The content is a constant from lib/theme.ts, never user input.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

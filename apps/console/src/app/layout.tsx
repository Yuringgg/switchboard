import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';

import { THEME_INIT_SCRIPT } from '@/lib/theme';

import './globals.css';

/**
 * Two families, each with a job.
 *
 * Instrument Sans carries anything a person wrote — subjects, names, message
 * previews. It is a grotesque with slightly tighter apertures than the system
 * stack, which is what keeps a dense list readable at 13–14px.
 *
 * IBM Plex Mono carries anything the machine knows: timestamps, addresses,
 * channel state, counts, the wordmark. That split is not decoration. On a
 * monitoring console the eye needs to separate "what arrived" from "what the
 * system is doing", and a change of voice does that faster than a change of
 * colour. Tabular figures also mean a column of times does not shift width as
 * the digits change.
 */
const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-sans-instrument',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Switchboard',
  description: 'One console for every conversation.',
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

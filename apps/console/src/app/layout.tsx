import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';

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
  // The token values already follow prefers-color-scheme; this tells the
  // browser to theme its own chrome to match.
  colorScheme: 'light dark',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

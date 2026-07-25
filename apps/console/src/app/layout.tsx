import type { Metadata, Viewport } from 'next';

import './globals.css';

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

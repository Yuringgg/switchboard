import type { ReactNode } from 'react';

import { Brand } from '@/components/brand';
import { Callout } from '@/components/callout';

/**
 * Frame shared by /login and /signup, so the two pages cannot drift visually.
 *
 * ── What it is doing differently from the console ────────────────────────────
 *
 * This is the only screen in the product seen by someone who does not yet know
 * what Switchboard is, so it is the only place the product line appears. The
 * form sits on a raised `panel` card against the background — the same
 * frame-versus-record relationship the console uses, reduced to its smallest
 * possible statement: the panel is the instrument, and here the instrument is
 * all there is.
 */
export function AuthCard({
  title,
  subtitle,
  error,
  notice,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  error?: string;
  notice?: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-[22rem]">
        <div className="flex flex-col items-center text-center">
          <Brand />
          <p className="mt-2.5 text-note text-muted-foreground">
            One console for every conversation.
          </p>
        </div>

        <div className="mt-7 rounded-xl border border-border bg-panel px-6 py-6">
          <h1 className="text-display font-semibold">{title}</h1>
          <p className="mt-1.5 text-note text-muted-foreground">{subtitle}</p>

          {/* role="alert" so a screen reader announces the failure on load —
              these arrive via a server redirect, not an in-page update. */}
          {error && (
            <Callout tone="error" role="alert" className="mt-4">
              {error}
            </Callout>
          )}

          {notice && (
            <Callout tone="notice" role="status" className="mt-4">
              {notice}
            </Callout>
          )}

          {children}
        </div>

        <p className="mt-5 text-center text-note text-muted-foreground">{footer}</p>
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';

import { Brand } from '@/components/brand';

/**
 * A full-page message wearing the console's own frame.
 *
 * ── Why it is not the AppShell ───────────────────────────────────────────────
 *
 * `AppShell` needs a signed-in user's id and email, and a `channels` promise
 * built from an authenticated Supabase client. Neither exists on a 404, which
 * can be reached signed out, or in an error boundary, where the very thing
 * that failed may be the session. A page whose job is to survive a failure
 * cannot depend on the machinery that just failed.
 *
 * So it borrows the vocabulary — the mark, the panel card, the type scale —
 * without the plumbing. Used by `app/not-found.tsx` and `app/error.tsx`.
 */
export function ShellMessage({
  code,
  title,
  children,
  action,
}: {
  /** The stencilled marker above the title: "404", "Error". */
  code: string;
  title: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-[26rem]">
        <div className="flex flex-col items-center text-center">
          <Brand />
        </div>

        <div className="mt-7 rounded-xl border border-border bg-panel px-6 py-7 text-center">
          <p className="font-mono text-label uppercase text-muted-foreground">{code}</p>
          <h1 className="mt-2.5 text-display font-semibold">{title}</h1>
          <div className="mt-2 text-note leading-relaxed text-balance text-muted-foreground">
            {children}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            {action}
          </div>
        </div>
      </div>
    </div>
  );
}

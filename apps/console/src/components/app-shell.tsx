import { LogOut } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { signOut } from '@/lib/auth-actions';
import { CHANNELS } from '@/lib/channels';
import { createClient } from '@/lib/supabase/server';
import { NAV_ITEMS } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * The console's frame: identity, navigation, and the channel legend.
 *
 * Deliberately CSS-only and server-rendered — no drawer state, no client
 * JavaScript. On narrow widths the sidebar becomes a horizontally scrollable
 * strip above the content rather than a hamburger menu.
 */
export async function AppShell({
  title,
  description,
  userEmail,
  /**
   * Which nav entry is the current page.
   *
   * Separate from `ready`: `ready` means the route exists, `activeHref` means
   * you are on it. Conflating them made every built route claim
   * `aria-current="page"`, which tells a screen-reader user they are on several
   * pages at once.
   */
  activeHref,
  children,
}: {
  title: string;
  description?: string;
  userEmail: string;
  activeHref: string;
  children: ReactNode;
}) {
  // RLS scopes this to the signed-in user, so no owner filter is needed.
  const supabase = await createClient();
  const { data } = await supabase.from('channels').select('type, status');
  const channelStates: { type: string; status: string }[] = data ?? [];

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <SwitchboardMark />
          <span className="text-[15px] leading-none font-semibold tracking-tight">
            Switchboard
          </span>
        </div>

        <nav className="px-3 pb-3 md:pb-0" aria-label="Primary">
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {NAV_ITEMS.map(({ label, href, icon: Icon, ready }) => {
              const content = (
                <>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                  {!ready && (
                    <span className="ml-auto hidden text-[10px] tracking-wide text-muted-foreground/70 uppercase md:inline">
                      soon
                    </span>
                  )}
                </>
              );

              const isActive = ready && href === activeHref;

              const className = cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm whitespace-nowrap',
                'focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                isActive && 'bg-accent text-accent-foreground font-medium',
                ready && !isActive && 'text-foreground hover:bg-accent/50',
                !ready && 'text-muted-foreground',
              );

              return (
                <li key={label} className="shrink-0 md:shrink">
                  {ready ? (
                    // Routes that exist are real links. Phase 3 flips `ready`.
                    <Link
                      href={href}
                      className={className}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      {content}
                    </Link>
                  ) : (
                    // Not a link, and not focusable — a nav item that looks
                    // clickable and 404s is worse than one that reads as pending.
                    <span
                      className={className}
                      aria-disabled
                      title={`${label} isn't built yet`}
                    >
                      {content}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-auto hidden px-5 py-4 md:block">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Channels
          </p>
          <ul className="mt-2.5 space-y-2">
            {CHANNELS.map(({ type, label, dotClass }) => {
              // Read from the database, not hardcoded. This said "Not
              // connected" beside a channel that WAS connected, which is worse
              // than showing nothing: it sends you looking for a broken
              // connection instead of the actual problem.
              const connected = channelStates.filter((c) => c.type === type);
              const anyError = connected.some((c) => c.status === 'error');

              return (
                <li key={type} className="flex items-center gap-2 text-sm">
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      dotClass,
                      connected.length > 0 ? 'opacity-100' : 'opacity-40',
                    )}
                    aria-hidden
                  />
                  <span className="text-muted-foreground">{label}</span>
                  <span
                    className={cn(
                      'ml-auto text-xs',
                      anyError ? 'text-destructive' : 'text-muted-foreground/70',
                    )}
                  >
                    {connected.length === 0
                      ? 'Not connected'
                      : anyError
                        ? 'Needs attention'
                        : 'Connected'}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 border-t border-border pt-3.5">
            <p className="truncate text-xs text-muted-foreground" title={userEmail}>
              {userEmail}
            </p>
            <form action={signOut}>
              <button
                type="submit"
                className="mt-1.5 -ml-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <LogOut className="size-3" aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border px-5 py-4 md:px-8 md:py-5">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </header>

        <main className="flex flex-1 flex-col px-5 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Many lines in, one operator's view out. */
function SwitchboardMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px] text-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 5h6a4 4 0 0 1 4 4v6a4 4 0 0 0 4 4h4" />
      <path d="M3 19h6a4 4 0 0 0 4-4" opacity={0.45} />
      <circle cx="20.5" cy="5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

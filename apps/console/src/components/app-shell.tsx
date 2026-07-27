import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';

import { Brand } from '@/components/brand';
import { Live, LiveStatus, SCROLLER_ID } from '@/components/live';
import { signOut } from '@/lib/auth-actions';
import { CHANNELS, type ChannelRow } from '@/lib/channels';
import { NAV_ITEMS } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * The console's frame: identity, navigation, and the channel legend.
 *
 * ── Layout ───────────────────────────────────────────────────────────────────
 *
 * The frame does not scroll; the record does. `h-dvh` + `overflow-hidden` on
 * the outer element gives the page a fixed height, and the only element with
 * `overflow-y-auto` is the message column. This replaces `min-h-dvh`, under
 * which the whole document scrolled as one column: the sidebar rode up with
 * the timeline, and because the aside grew to the document's full height,
 * `mt-auto` on the channel legend pushed "Gmail — Connected" and "Sign out"
 * into the middle of the page.
 *
 * Still deliberately CSS-only — no drawer state, no client JavaScript for the
 * navigation. On narrow widths the sidebar is a strip above the content with a
 * horizontally scrollable nav, and it stays put now too.
 *
 * ── Data ─────────────────────────────────────────────────────────────────────
 *
 * `channels` arrives as an unawaited promise from the page, which starts it in
 * parallel with the page's own queries. The shell renders immediately and the
 * legend fills in behind a `<Suspense>`. This component used to run its own
 * `createClient()` and a second `channels` query — and because a shell only
 * renders after the page's awaits resolve, that was a whole extra sequential
 * round trip to Singapore for data the page already had.
 */
export function AppShell({
  title,
  description,
  userEmail,
  userId,
  /**
   * Which nav entry is the current page.
   *
   * Separate from `ready`: `ready` means the route exists, `activeHref` means
   * you are on it. Conflating them made every built route claim
   * `aria-current="page"`, which tells a screen-reader user they are on several
   * pages at once.
   */
  activeHref,
  channels,
  children,
}: {
  title: string;
  description?: string;
  userEmail: string;
  userId: string;
  activeHref: string;
  channels: Promise<{ channels: ChannelRow[]; error: string | null }>;
  children: ReactNode;
}) {
  return (
    <Live userId={userId}>
      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-border bg-panel md:w-60 md:overflow-y-auto md:border-r md:border-b-0">
          <div className="flex items-center gap-2.5 px-4 py-3 md:px-5 md:py-4">
            <Brand />

            {/* The account controls live in the sidebar's footer on desktop,
                which is `hidden` on mobile — so on a phone they come here.
                A console you cannot sign out of is not finished. */}
            <div className="ml-auto flex items-center gap-3 md:hidden">
              <Suspense fallback={<LampsFallback />}>
                <ChannelLamps channels={channels} />
              </Suspense>
              <form action={signOut}>
                <button
                  type="submit"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <LogOut className="size-3.5" aria-hidden />
                  <span className="sr-only">Sign out</span>
                </button>
              </form>
            </div>
          </div>

          <nav className="px-3 pb-2.5 md:pb-0" aria-label="Primary">
            <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
              {NAV_ITEMS.map(({ label, href, icon: Icon, ready }) => {
                const isActive = ready && href === activeHref;

                const content = (
                  <>
                    {/* The active line, borrowed from the timeline's rail so
                        the two read as the same system. Desktop only — a left
                        marker means nothing in a horizontal strip. */}
                    {isActive && (
                      <span
                        className="absolute top-1.5 bottom-1.5 -left-1 hidden w-0.5 rounded-full bg-foreground md:block"
                        aria-hidden
                      />
                    )}
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {label}
                    {!ready && (
                      <span className="ml-auto hidden font-mono text-[9px] tracking-[0.14em] text-muted-foreground/70 uppercase md:inline">
                        soon
                      </span>
                    )}
                  </>
                );

                const className = cn(
                  'relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] whitespace-nowrap',
                  'focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                  isActive && 'bg-accent font-medium text-foreground md:bg-transparent',
                  ready && !isActive && 'text-muted-foreground hover:text-foreground',
                  !ready && 'text-muted-foreground/60',
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
            {/* The same word as the nav entry and the page it links to. A
                surface that calls one thing three names is one the reader has
                to keep translating. */}
            <p className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground/70 uppercase">
              Channels
            </p>

            <Suspense fallback={<LegendFallback />}>
              <ChannelLegend channels={channels} />
            </Suspense>

            <div className="mt-5 border-t border-border pt-3.5">
              <p
                className="truncate font-mono text-[11px] text-muted-foreground"
                title={userEmail}
              >
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

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-border bg-panel">
            <div className="mx-auto flex w-full max-w-4xl items-center gap-4 px-5 py-3 md:px-8 md:py-4">
              <div className="min-w-0">
                <h1 className="truncate text-[15px] font-semibold tracking-tight">
                  {title}
                </h1>
                {description && (
                  <p className="mt-0.5 hidden truncate text-[13px] text-muted-foreground sm:block">
                    {description}
                  </p>
                )}
              </div>
              <LiveStatus className="ml-auto shrink-0" />
            </div>
          </header>

          {/*
            The one element that scrolls. `live.tsx` reads its offset by id to
            decide whether an arriving message may be inserted above what you
            are currently reading.
          */}
          <main id={SCROLLER_ID} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-5 py-5 md:px-8 md:py-7">
              {children}
            </div>
          </main>
        </div>
      </div>
    </Live>
  );
}

/** Which channels exist and whether they are healthy — the sidebar's footer. */
async function ChannelLegend({
  channels,
}: {
  channels: Promise<{ channels: ChannelRow[]; error: string | null }>;
}) {
  const { channels: rows } = await channels;

  return (
    <ul className="mt-2.5 space-y-2">
      {CHANNELS.map(({ type, label, dotClass }) => {
        // Read from the database, not hardcoded. This said "Not connected"
        // beside a channel that WAS connected, which is worse than showing
        // nothing: it sends you looking for a broken connection instead of the
        // actual problem.
        const connected = rows.filter((c) => c.type === type);
        const anyError = connected.some((c) => c.status === 'error');

        return (
          <li key={type} className="flex items-center gap-2 text-[13px]">
            <span
              className={cn(
                'size-1.5 rounded-full',
                dotClass,
                connected.length > 0 ? 'opacity-100' : 'opacity-30',
              )}
              aria-hidden
            />
            <span className={connected.length > 0 ? '' : 'text-muted-foreground'}>
              {label}
            </span>
            <span
              className={cn(
                'ml-auto font-mono text-[10px] tracking-[0.08em] uppercase',
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
  );
}

/** The same information on a phone, where there is only room for the lamps. */
async function ChannelLamps({
  channels,
}: {
  channels: Promise<{ channels: ChannelRow[]; error: string | null }>;
}) {
  const { channels: rows } = await channels;

  return (
    <ul className="flex items-center gap-1.5">
      {CHANNELS.map(({ type, label, dotClass }) => {
        const connected = rows.filter((c) => c.type === type);
        const anyError = connected.some((c) => c.status === 'error');
        const state =
          connected.length === 0
            ? 'not connected'
            : anyError
              ? 'needs attention'
              : 'connected';

        return (
          <li key={type}>
            <span
              className={cn(
                'block size-1.5 rounded-full',
                anyError ? 'bg-destructive' : dotClass,
                connected.length === 0 && 'opacity-30',
              )}
              title={`${label} — ${state}`}
              aria-hidden
            />
            <span className="sr-only">{`${label} — ${state}`}</span>
          </li>
        );
      })}
    </ul>
  );
}

function LegendFallback() {
  return (
    <ul className="mt-2.5 space-y-2" aria-hidden>
      {CHANNELS.map(({ type }) => (
        <li key={type} className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-muted-foreground/20" />
          <span className="h-3 w-16 rounded bg-muted-foreground/10" />
          <span className="ml-auto h-3 w-6 rounded bg-muted-foreground/10" />
        </li>
      ))}
    </ul>
  );
}

function LampsFallback() {
  return (
    <span className="flex items-center gap-1.5" aria-hidden>
      {CHANNELS.map(({ type }) => (
        <span key={type} className="size-1.5 rounded-full bg-muted-foreground/20" />
      ))}
    </span>
  );
}

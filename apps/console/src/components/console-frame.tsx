import { LogOut } from 'lucide-react';
import { Suspense, type ReactNode } from 'react';

import { Brand } from '@/components/brand';
import { ConsoleNav } from '@/components/console-nav';
import { Live, SCROLLER_ID } from '@/components/live';
import { ThemeToggle } from '@/components/theme-toggle';
import { signOut } from '@/lib/auth-actions';
import { CHANNELS, type ChannelRow } from '@/lib/channels';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The part of the console that does NOT change when you move between pages:
 * identity, navigation, the channel legend, and the live connection.
 *
 * ── ⚠ Why this is rendered by a layout, not by each page (2026-10-02) ───────
 *
 * Until 2026-10-02 every page rendered the whole frame itself, through
 * `AppShell`. That made the frame part of the PAGE, so every click threw it
 * away and built it again: the sidebar, the realtime subscription in `Live`,
 * and the backdrop all remounted, and — because a page renders only after its
 * own awaits resolve — nothing on screen changed at all until the server had
 * answered. With no `loading.tsx` anywhere, Next could not prefetch anything
 * for these dynamic routes either, so every click was a full round trip with
 * the old page frozen in place.
 *
 * Now `app/(console)/layout.tsx` renders this once, and it survives navigation.
 * Each page renders only `PageFrame` (its header and its scroll column), and
 * each route has a `loading.tsx` that shows that page's skeleton the moment
 * you click. ADR-031.
 *
 * ⚠ A layout is NOT re-rendered by a client-side navigation. Anything here is
 * as fresh as the last full load, `router.refresh()` (which `Live` calls when
 * mail arrives) or server-action revalidation. The channel legend is the only
 * data it shows, and that is the right freshness for it. Do not move per-page
 * data up here.
 *
 * ── Layout ───────────────────────────────────────────────────────────────────
 *
 * The frame does not scroll; the record does. `h-dvh` + `overflow-hidden` on
 * the outer element gives the page a fixed height, and the only element with
 * `overflow-y-auto` is the message column inside `PageFrame`. This replaces
 * `min-h-dvh`, under which the whole document scrolled as one column: the
 * sidebar rode up with the timeline, and because the aside grew to the
 * document's full height, `mt-auto` on the channel legend pushed "Gmail —
 * Connected" and "Sign out" into the middle of the page.
 *
 * Still deliberately CSS-only — no drawer state. On narrow widths the sidebar
 * is a strip above the content and the navigation is a dock along the bottom.
 *
 * ── Data ─────────────────────────────────────────────────────────────────────
 *
 * `channels` arrives as an unawaited promise, so the frame renders immediately
 * and the legend fills in behind a `<Suspense>`.
 */
export function ConsoleFrame({
  userEmail,
  userId,
  channels,
  /**
   * Which nav entry is lit, when the URL cannot say. Only `/preview` passes
   * it — its URL is `/preview` whichever screen it is showing. Real routes
   * leave it out and the nav reads the path.
   */
  activeHref,
  children,
}: {
  userEmail: string;
  userId: string;
  channels: Promise<{ channels: ChannelRow[]; error: string | null }>;
  activeHref?: string;
  children: ReactNode;
}) {
  return (
    <Live userId={userId}>
      {/*
        First thing in the tab order. Without it, reaching the timeline by
        keyboard means tabbing past the whole sidebar on every navigation —
        and the sidebar is the part that never changes.
      */}
      <a
        href={`#${SCROLLER_ID}`}
        className="focus-ring sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to messages
      </a>

      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        {/*
          Wider by a rem and better padded than it was. The rail's labels are
          set in Archivo now and the scale went up a step on 2026-08-06; 240px
          was tuned for the old pair and "Needs attention" was already the entry
          deciding the width.
        */}
        <aside className="flex shrink-0 flex-col border-b border-border bg-panel md:w-64 md:overflow-y-auto md:border-r md:border-b-0">
          <div className="flex items-center gap-2.5 px-4 py-3.5 md:px-6 md:py-6">
            <Brand />

            {/* The account controls live in the sidebar's footer on desktop,
                which is `hidden` on mobile — so on a phone they come here.
                A console you cannot sign out of is not finished. */}
            <div className="ml-auto flex items-center gap-2 md:hidden">
              <Suspense fallback={<LampsFallback />}>
                <ChannelLamps channels={channels} />
              </Suspense>
              <ThemeToggle />
              <form action={signOut}>
                <button
                  type="submit"
                  className={buttonClass({ variant: 'ghost', size: 'icon' })}
                >
                  <LogOut className="size-3.5" aria-hidden />
                  <span className="sr-only">Sign out</span>
                </button>
              </form>
            </div>
          </div>

          {/*
            The rail. Same component as the dock at the bottom of the frame on a
            phone, turned on its side — `hidden` rather than a second set of
            styles, so exactly one of the two is ever in the accessibility tree
            and "Primary" names one navigation at any width.

            ⚠ `md:flex`, not `md:block`. The entries are flex children; a
            `display: block` here would strand them and the rail would render as
            six full-width rows with the icons detached from their labels.
          */}
          <ConsoleNav
            activeHref={activeHref}
            orientation="vertical"
            className="hidden md:flex"
          />

          <div className="mt-auto hidden px-6 py-6 md:block">
            {/* The same word as the nav entry and the page it links to. A
                surface that calls one thing three names is one the reader has
                to keep translating. */}
            <p className={LABEL}>Channels</p>

            <Suspense fallback={<LegendFallback />}>
              <ChannelLegend channels={channels} />
            </Suspense>

            <div className="mt-5 border-t border-border pt-4">
              <p
                className="truncate font-mono text-meta text-muted-foreground"
                title={userEmail}
              >
                {userEmail}
              </p>
              {/* Sign out and the theme control share a row: one is the only
                  account action, the other the only display setting, and
                  neither earns a section of its own. */}
              <div className="mt-2 flex items-center gap-2">
                <form action={signOut}>
                  <button
                    type="submit"
                    className={buttonClass({
                      variant: 'ghost',
                      size: 'sm',
                      className: '-ml-2 h-7 px-2',
                    })}
                  >
                    <LogOut className="size-3" aria-hidden />
                    Sign out
                  </button>
                </form>
                <ThemeToggle className="ml-auto" />
              </div>
            </div>
          </div>
        </aside>

        {/* The page: `PageFrame`, or a route's `loading.tsx` while it arrives. */}
        {children}

        {/*
          Last child, so on a phone — where the frame is a column — it is the
          bottom row, and the content above it shrinks to fit rather than
          scrolling under it. `md:hidden` keeps it from becoming a third column
          once the frame turns into a row.
        */}
        <ConsoleNav
          activeHref={activeHref}
          orientation="horizontal"
          className="flex md:hidden"
        />
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
    <ul className="mt-3 space-y-2.5">
      {CHANNELS.map(({ type, label, dotClass }) => {
        // Read from the database, not hardcoded. This said "Not connected"
        // beside a channel that WAS connected, which is worse than showing
        // nothing: it sends you looking for a broken connection instead of the
        // actual problem.
        const connected = rows.filter((c) => c.type === type);
        const anyError = connected.some((c) => c.status === 'error');

        return (
          <li key={type} className="flex items-center gap-2 text-row">
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                connected.length === 0 ? 'bg-faint' : dotClass,
              )}
              aria-hidden
            />
            <span className={connected.length > 0 ? '' : 'text-muted-foreground'}>
              {label}
            </span>
            <span
              className={cn(
                'ml-auto font-mono text-label uppercase',
                anyError ? 'text-destructive' : 'text-muted-foreground',
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
                connected.length === 0 && 'bg-faint',
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
    <ul className="mt-3 animate-pulse space-y-2.5" aria-hidden>
      {CHANNELS.map(({ type }) => (
        <li key={type} className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-faint" />
          <span className="h-3 w-16 rounded bg-faint/60" />
          <span className="ml-auto h-3 w-12 rounded bg-faint/40" />
        </li>
      ))}
    </ul>
  );
}

function LampsFallback() {
  return (
    <span className="flex animate-pulse items-center gap-1.5" aria-hidden>
      {CHANNELS.map(({ type }) => (
        <span key={type} className="size-1.5 rounded-full bg-faint" />
      ))}
    </span>
  );
}

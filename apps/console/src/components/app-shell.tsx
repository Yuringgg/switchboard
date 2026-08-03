import { LogOut } from 'lucide-react';
import { Suspense, type ReactNode } from 'react';

import { Brand } from '@/components/brand';
import { ConsoleNav } from '@/components/console-nav';
import { Live, LiveStatus, SCROLLER_ID } from '@/components/live';
import { ThemeToggle } from '@/components/theme-toggle';
import { signOut } from '@/lib/auth-actions';
import { CHANNELS, type ChannelRow } from '@/lib/channels';
import { buttonClass, LABEL } from '@/lib/ui';
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
        <aside className="flex shrink-0 flex-col border-b border-border bg-panel md:w-60 md:overflow-y-auto md:border-r md:border-b-0">
          <div className="flex items-center gap-2.5 px-4 py-3 md:px-5 md:py-5">
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

          <div className="mt-auto hidden px-5 py-5 md:block">
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

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-border bg-panel">
            <div className="mx-auto flex w-full max-w-4xl items-center gap-4 px-5 py-3.5 md:px-8 md:py-4">
              <div className="min-w-0">
                <h1 className="truncate text-heading font-semibold">{title}</h1>
                {description && (
                  <p className="mt-0.5 hidden truncate text-note text-muted-foreground sm:block">
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

            `tabIndex={-1}` makes it the skip link's landing point, and gives a
            keyboard user something to focus before pressing Page Down — a
            scroll container that cannot take focus cannot be scrolled from the
            keyboard alone. `live.tsx` also hands focus here when the
            new-messages pill is dismissed, which is why it is worth naming:
            focus landing on an unlabelled <main> announces only "main".
          */}
          <main
            id={SCROLLER_ID}
            tabIndex={-1}
            aria-label={title}
            className="min-h-0 flex-1 overflow-y-auto outline-none"
          >
            <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-5 py-6 md:px-8 md:py-8">
              {children}
            </div>
          </main>
        </div>

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

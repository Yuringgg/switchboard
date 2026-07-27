'use client';

import { ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { createClient } from '@/lib/supabase/client';
import { newMessagesLabel } from '@/lib/timeline';
import { cn } from '@/lib/utils';

/**
 * Live updates for the console.
 *
 * ── Which of the brief's two options this is, and why ────────────────────────
 *
 * A Realtime INSERT payload carries the `messages` row and nothing else. The
 * timeline shows a sender *name*, which comes from a PostgREST embed on
 * `contact_identities` — so the payload alone cannot render a complete row.
 *
 * This is option (b): subscribe, and let the server re-render. When a row
 * arrives we call `router.refresh()`, which re-runs the page's server
 * component and streams the new list back through the same query, the same
 * join and the same markup as a normal load. Option (a) — fetching each new
 * sender client-side — is more of a demo, but it is a second rendering path
 * for the same row, and the first time the two disagree the timeline is
 * showing something the database does not say. One path is worth more here
 * than one saved round trip.
 *
 * `router.refresh()` is not a page reload: no navigation, no scroll jump, no
 * lost focus. React reconciles the new list into the existing DOM.
 *
 * ── Why the pill exists at all ───────────────────────────────────────────────
 *
 * If you are reading something further down, inserting a row above it moves
 * the text under your eyes. So the refresh is automatic only while you are at
 * the top of the list; below that, arrivals are counted and offered. Same
 * mechanism either way — the only difference is who decides when.
 *
 * ⚠ The payload is never read. It contains real message content, and
 * `docs/02-ARCHITECTURE.md` §6 says content is never logged or rendered
 * outside the timeline itself. All this listener needs is the fact that
 * something arrived.
 */

/** The element that scrolls. `AppShell` owns it; this module reads its offset. */
export const SCROLLER_ID = 'console-scroll';

/** How far from the top still counts as "watching the top". */
const AT_TOP_PX = 120;

/** Coalesce a burst — one notification can carry several new messages. */
const REFRESH_DEBOUNCE_MS = 250;

type Connection = 'connecting' | 'live' | 'offline';

interface LiveState {
  connection: Connection;
  pending: number;
  catchUp: () => void;
}

const LiveContext = createContext<LiveState>({
  connection: 'connecting',
  pending: 0,
  catchUp: () => {},
});

export function Live({ userId, children }: { userId: string; children: ReactNode }) {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection>('connecting');
  const [pending, setPending] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
  }, [router]);

  const catchUp = useCallback(() => {
    document.getElementById(SCROLLER_ID)?.scrollTo({ top: 0, behavior: 'smooth' });
    setPending(0);
    router.refresh();
  }, [router]);

  useEffect(() => {
    // The authenticated browser client: publishable key + the user's session,
    // so RLS scopes the subscription exactly as it scopes a query (ADR-013).
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      // Hand the socket the current access token before subscribing. Without
      // this the channel can open before the session has been read from the
      // cookie, and Realtime rejects an unauthenticated subscription to an
      // RLS-protected table.
      await supabase.realtime.setAuth();
      if (cancelled) return;

      channel = supabase
        .channel('timeline-messages')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            // RLS is the boundary; this filter is only so the socket is not
            // asked to evaluate policies for rows that are obviously not ours.
            filter: `owner_id=eq.${userId}`,
          },
          () => {
            const scroller = document.getElementById(SCROLLER_ID);
            const atTop = !scroller || scroller.scrollTop < AT_TOP_PX;

            if (atTop) refreshSoon();
            else setPending((n) => n + 1);
          },
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') setConnection('live');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setConnection('offline');
          }
        });
    })();

    return () => {
      cancelled = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, refreshSoon]);

  return (
    <LiveContext.Provider value={{ connection, pending, catchUp }}>
      {children}
    </LiveContext.Provider>
  );
}

const CONNECTION_LABEL: Record<Connection, string> = {
  connecting: 'Connecting',
  live: 'Live',
  offline: 'Offline',
};

/**
 * Whether the board is actually listening.
 *
 * Worth the pixels: without it, "no new messages" and "the socket died twenty
 * minutes ago" look exactly the same — which is the failure this project has
 * already paid for once, in the empty state.
 */
export function LiveStatus({ className }: { className?: string }) {
  const { connection } = useContext(LiveContext);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase',
        connection === 'offline' ? 'text-muted-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          connection === 'live' && 'animate-lamp bg-live',
          connection === 'connecting' && 'bg-muted-foreground/40',
          connection === 'offline' && 'bg-muted-foreground/40 ring-1 ring-border',
        )}
        aria-hidden
      />
      {CONNECTION_LABEL[connection]}
    </span>
  );
}

/**
 * Sits in the scroll flow but takes no height, so the list does not shift when
 * it appears and disappear-jump when it goes.
 */
export function NewMessages() {
  const { pending, catchUp } = useContext(LiveContext);

  if (pending === 0) return null;

  return (
    <div
      className="pointer-events-none sticky top-0 z-20 flex h-0 justify-center"
      role="status"
    >
      <button
        type="button"
        onClick={catchUp}
        className="animate-arrive pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-panel px-3.5 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="size-1.5 shrink-0 rounded-full bg-live" aria-hidden />
        {newMessagesLabel(pending)}
        <ArrowUp className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </div>
  );
}

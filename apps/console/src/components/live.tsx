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
 *
 * ── ⚠ AUTO-SYNC, ADDED 2026-08-06, AND WHY THE SOCKET WAS NOT ENOUGH ─────────
 *
 * Ms. Maria, 2026-08-05: *"try mong tanggalin yung need to go back and forth or
 * refresh the page para lang mag-sync yung email… add ng auto sync function…
 * automatic na siya mag-lo-load rather than having to refresh the site."*
 *
 * The console already claimed to do this, and the claim was conditional in a
 * way nothing on screen admitted. Realtime is a WebSocket, and a WebSocket
 * dies: a laptop sleeps, wifi changes, a phone backgrounds the tab, Supabase
 * cycles a node. When it did, this component set `offline`, **stopped**, and
 * told the reader to reload the page — which is precisely the manual refresh
 * she was asking to be rid of, dressed up as a status indicator.
 *
 * Three things now stand behind the socket, in increasing order of how often
 * they actually fire:
 *
 *   1. **Reconnection.** A dropped channel is torn down and re-subscribed on a
 *      capped exponential backoff, indefinitely. The socket coming back is the
 *      normal outcome and needs no human.
 *   2. **A poll.** While the socket is not subscribed, the list is re-fetched
 *      every `POLL_SYNCING_MS`; while it *is*, the same poll runs far more
 *      slowly as a safety net against the one failure a socket cannot report —
 *      a subscription that is open and silently delivering nothing.
 *   3. **Coming back to the tab.** Returning to a backgrounded tab refreshes
 *      immediately. This is the one that matters in practice: the complaint
 *      came from switching to the console and finding it stale, and every
 *      browser throttles timers in hidden tabs, so a timer alone cannot fix it.
 *
 * ⚠ **Every one of those paths respects the at-the-top rule.** Refreshing
 * while somebody is reading further down inserts rows above their eyes, which
 * is the whole reason the pill exists. A poll that fires mid-list does nothing
 * and waits; nothing is lost, because the next scroll to the top refreshes.
 */

/** The element that scrolls. `AppShell` owns it; this module reads its offset. */
export const SCROLLER_ID = 'console-scroll';

/** How far from the top still counts as "watching the top". */
const AT_TOP_PX = 120;

/** Coalesce a burst — one notification can carry several new messages. */
const REFRESH_DEBOUNCE_MS = 250;

/**
 * The safety-net poll, while the socket is healthy.
 *
 * Deliberately slow. With a working subscription this should never be the thing
 * that finds a message, and it exists only for the failure a socket cannot
 * report: still subscribed, delivering nothing. One request a minute against a
 * query the timeline already makes on every navigation is not a load worth
 * optimising away, and being wrong about "you are up to date" is expensive.
 */
const POLL_LIVE_MS = 60_000;

/**
 * The poll while the socket is down — this is the sync, not a net.
 *
 * 20s is the compromise: fast enough that a message during a demo shows up
 * before anyone reaches for F5, slow enough that a long outage does not turn
 * into a request every few seconds to a database in Singapore.
 */
const POLL_SYNCING_MS = 20_000;

/** First reconnection attempt, doubling to `RETRY_MAX_MS`. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * ⚠ Three states, and `offline` is gone.
 *
 * It used to be the third, rendered in red, reading *"Not receiving updates.
 * Reload the page to reconnect."* Both halves of that stopped being true with
 * auto-sync: the console IS still receiving updates, and reloading is exactly
 * what nobody should have to do. A red fault light over a console that is
 * working correctly is the same class of lie as the silent failure it replaced,
 * pointing the other way.
 *
 * `syncing` is the honest third state — the live connection has dropped, the
 * console is polling instead and retrying the connection in the background.
 * It has to remain visibly distinct from `live`, because "no new messages" and
 * "the socket died twenty minutes ago" must never look identical; that is a
 * rule this component was written to enforce and it still holds. The
 * distinction is now carried by the label and by a lamp that does not blink,
 * rather than by a colour that claims something is broken.
 */
type Connection = 'connecting' | 'live' | 'syncing';

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

/** Whether an arriving row may be inserted without moving what is being read. */
function atTop(): boolean {
  const scroller = document.getElementById(SCROLLER_ID);
  return !scroller || scroller.scrollTop < AT_TOP_PX;
}

export function Live({ userId, children }: { userId: string; children: ReactNode }) {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection>('connecting');
  const [pending, setPending] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
  }, [router]);

  /**
   * A refresh nobody asked for — from the poll or from returning to the tab.
   *
   * ⚠ Silent by design: it does NOT touch `pending`. The pill counts arrivals
   * the socket actually reported, and a poll has no idea whether anything came
   * in. Incrementing it here would put "1 new message" over a list that has not
   * changed, which teaches a reader to stop believing the pill — the one piece
   * of this UI whose whole value is being believed.
   *
   * ⚠ Skipped entirely when the reader is scrolled down. Nothing is lost:
   * arriving rows are still counted by the subscription, and the next return to
   * the top refreshes.
   */
  const syncIfSafe = useCallback(() => {
    if (typeof document === 'undefined' || document.hidden) return;
    if (!atTop()) return;
    router.refresh();
  }, [router]);

  const catchUp = useCallback(() => {
    const scroller = document.getElementById(SCROLLER_ID);
    scroller?.scrollTo({ top: 0, behavior: 'smooth' });

    /*
     * Move focus before the pill unmounts.
     *
     * Clearing `pending` removes the button that was just activated, and focus
     * on a removed element falls back to <body> — so a keyboard user who
     * pressed Enter on "3 new messages" lands nowhere, and their next Tab
     * starts again from the skip link at the top of the document. Handing
     * focus to the scroller puts them at the messages they asked to see:
     * `j` continues from the first row, Tab enters the list, and a screen
     * reader announces the region by its label rather than going silent.
     *
     * `preventScroll` so this cannot fight the smooth scroll above.
     */
    scroller?.focus({ preventScroll: true });

    setPending(0);
    router.refresh();
  }, [router]);

  /*
   * ── The subscription, and its own reconnection ──────────────────────────────
   *
   * ⚠ `connect()` re-enters itself on failure. It used to subscribe once and,
   * on `CHANNEL_ERROR`, set a red status and stop — so every transient drop
   * (a laptop sleeping, wifi changing, a Supabase node cycling) was permanent
   * until somebody reloaded. That is the manual refresh Ms. Maria asked to be
   * rid of, arriving by a different route.
   *
   * The channel is torn down before each retry. Re-subscribing a channel that
   * is already in an errored state does not recover it, and leaving the old one
   * attached leaks a socket per attempt — which on a 30-second backoff is slow
   * enough that nobody would ever catch it in a session.
   */
  useEffect(() => {
    // The authenticated browser client: publishable key + the user's session,
    // so RLS scopes the subscription exactly as it scopes a query (ADR-013).
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let cancelled = false;

    const teardown = () => {
      if (channel) {
        const stale = channel;
        channel = null;
        void supabase.removeChannel(stale);
      }
    };

    const retry = () => {
      if (cancelled) return;
      teardown();

      // Capped exponential backoff, and it never gives up. A console left open
      // overnight through a router reboot should be live again in the morning
      // without anybody touching it.
      const wait = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
      attempt += 1;
      retryTimer = setTimeout(() => void connect(), wait);
    };

    const connect = async () => {
      if (cancelled) return;

      // Hand the socket the current access token before subscribing. Without
      // this the channel can open before the session has been read from the
      // cookie, and Realtime rejects an unauthenticated subscription to an
      // RLS-protected table. On a *re*connect it also matters more: the token
      // may have been refreshed since the last attempt.
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
            if (atTop()) refreshSoon();
            else setPending((n) => n + 1);
          },
        )
        .subscribe((status) => {
          if (cancelled) return;

          if (status === 'SUBSCRIBED') {
            attempt = 0;
            setConnection('live');
            /*
             * ⚠ Refresh on every (re)connection, not only the first.
             *
             * Anything that arrived while the socket was down was never
             * announced to anyone — the subscription cannot replay it. Without
             * this, reconnecting restores the "Live" lamp over a list that is
             * silently missing messages, which is a worse state than the
             * outage: it says up to date and is not.
             */
            syncIfSafe();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setConnection('syncing');
            retry();
          } else if (status === 'CLOSED') {
            // Only meaningful if we did not close it ourselves; `cancelled`
            // above covers unmount, so reaching here means the server or the
            // network closed it.
            setConnection('syncing');
            retry();
          }
        });
    };

    void connect();

    return () => {
      cancelled = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (retryTimer) clearTimeout(retryTimer);
      teardown();
    };
  }, [userId, refreshSoon, syncIfSafe]);

  /*
   * ── The poll ────────────────────────────────────────────────────────────────
   *
   * Fast while the socket is down, slow while it is up. Re-created whenever
   * `connection` changes, which is what switches the interval between the two.
   *
   * ⚠ `connecting` is deliberately not polled. It lasts a moment on first load,
   * during which the page has just been server-rendered — a refresh there would
   * re-fetch data that is one round trip old.
   */
  useEffect(() => {
    if (connection === 'connecting') return;

    const every = connection === 'live' ? POLL_LIVE_MS : POLL_SYNCING_MS;
    const timer = setInterval(syncIfSafe, every);

    return () => clearInterval(timer);
  }, [connection, syncIfSafe]);

  /*
   * ── Coming back to the tab ──────────────────────────────────────────────────
   *
   * ⚠ This is the one that actually answers the complaint, and no timer can
   * replace it: every browser throttles or suspends intervals in a hidden tab,
   * so a console left in a background tab for an hour is stale the instant you
   * look at it — which is exactly the moment somebody reaches for reload.
   *
   * Both events, because they are not the same thing. `visibilitychange` fires
   * for a tab switch; `focus` fires for returning to the window from another
   * application, which on a laptop is at least as common and does not
   * necessarily change visibility.
   */
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) syncIfSafe();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', syncIfSafe);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', syncIfSafe);
    };
  }, [syncIfSafe]);

  return (
    <LiveContext.Provider value={{ connection, pending, catchUp }}>
      {children}
    </LiveContext.Provider>
  );
}

const CONNECTION: Record<
  Connection,
  { label: string; text: string; lamp: string; title: string }
> = {
  connecting: {
    label: 'Connecting',
    text: 'text-muted-foreground',
    lamp: 'bg-faint',
    title: 'Opening the live connection.',
  },
  live: {
    label: 'Live',
    text: 'text-muted-foreground',
    lamp: 'animate-lamp bg-live',
    title: 'New messages will appear here on their own.',
  },
  /*
   * ⚠ Not red, and this overturns a decision recorded in this file.
   *
   * The third state was `offline`, in `--destructive`, saying "Reload the page
   * to reconnect". That was the right call when a dropped socket really did
   * mean the console had stopped — and it is wrong now that it does not. The
   * board is still being refreshed on a timer and the connection is being
   * retried in the background, so a red fault light would be claiming a failure
   * that is not happening, and telling the reader to do the one thing this
   * change exists to make unnecessary.
   *
   * ⚠ It must still be clearly distinguishable from `live`, because "no new
   * messages" and "the socket died twenty minutes ago" looking identical is the
   * defect this indicator was built to prevent. Two carriers, neither of them
   * colour: a different word, and a lamp that does not blink. The blink is what
   * `--live` means in this product — a socket held open — and a poll is not
   * that.
   */
  syncing: {
    label: 'Syncing',
    text: 'text-muted-foreground',
    lamp: 'bg-live/55',
    title:
      'The live connection dropped. Checking for new messages on a timer and ' +
      'reconnecting in the background — you do not need to reload.',
  },
};

/**
 * Whether the board is actually listening.
 *
 * Worth the pixels: without it, "no new messages" and "the socket died twenty
 * minutes ago" look exactly the same — which is the failure this project has
 * already paid for once, in the empty state.
 *
 * ⚠ The three states must not be styled alike. An earlier version read
 * `connection === 'offline' ? 'text-muted-foreground' : 'text-muted-foreground'`
 * — the same value on both branches — so a dead socket differed from a healthy
 * one by a 6px dot losing its animation, which is exactly the collapse the
 * paragraph above says this component exists to prevent. Each state now carries
 * its own word as well as its own lamp; see the note on `syncing` in
 * `CONNECTION` for why that state is no longer red.
 *
 * `aria-live="polite"` because a screen-reader user has no other way to learn
 * the board stopped listening. ⚠ Auto-sync makes this fire more often than it
 * used to — a flapping connection now announces every transition rather than
 * dying once — but the states are only three and the announcement is two
 * words. Worth watching if reconnection ever gets more aggressive than the
 * capped backoff above.
 */
export function LiveStatus({ className }: { className?: string }) {
  const { connection } = useContext(LiveContext);
  const { label, text, lamp, title } = CONNECTION[connection];

  return (
    <span
      aria-live="polite"
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-label uppercase',
        text,
        className,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', lamp)} aria-hidden />
      {label}
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
        className="focus-ring animate-arrive pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-panel px-3.5 py-1.5 text-note font-medium shadow-sm transition-colors hover:bg-accent"
      >
        <span className="animate-lamp size-1.5 shrink-0 rounded-full bg-live" aria-hidden />
        {newMessagesLabel(pending)}
        <ArrowUp className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </div>
  );
}

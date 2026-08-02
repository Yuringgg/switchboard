import { SearchX, Telescope } from 'lucide-react';
import Link from 'next/link';

import { MessageRow } from '@/components/message-row';
import { CHANNELS, type ChannelRow } from '@/lib/channels';
import { highlightSegments, type SearchResult } from '@/lib/search';
import { channelChangePoints } from '@/lib/timeline';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

export const PAGE_SIZE = 25;

/**
 * Ranked search results.
 *
 * ── Why this is not the timeline ─────────────────────────────────────────────
 *
 * The timeline groups by day, because on a chronological record the day is the
 * organising fact. Results are ordered by *relevance*, so a day heading over
 * them would be a heading over one row, then another over one row — structure
 * that carries no information and costs a third of the vertical space. Each row
 * carries its own date instead (`showDate`).
 *
 * The channel label still follows `channelChangePoints`, exactly as in the
 * timeline: naming the line only when it changes. That rule was written for a
 * chronological list but it is if anything more useful here, because a ranked
 * list has no other continuity — and with a single channel connected it still
 * collapses to one label at the top rather than fifty saying "Gmail".
 */
export function SearchResults({
  results,
  channels,
  query,
  truncated,
  page,
  pageHref,
}: {
  results: SearchResult[];
  channels: ChannelRow[];
  query: string;
  /** More results exist beyond this page. */
  truncated: boolean;
  page: number;
  /** Builds the URL for another page, preserving every current filter. */
  pageHref: (page: number) => string;
}) {
  const channelTypeById = new Map(channels.map((c) => [c.id, c.type]));
  const changePoints = channelChangePoints(results, channelTypeById);

  return (
    <div>
      <ul>
        {results.map((result, index) => {
          const channelType = channelTypeById.get(result.channel_id);
          const channel = CHANNELS.find((c) => c.type === channelType);

          return (
            <MessageRow
              key={result.id}
              message={result}
              channelLabel={channel?.label ?? null}
              dotClass={channel?.dotClass ?? 'bg-faint'}
              showChannel={changePoints.has(result.id)}
              isLast={index === results.length - 1}
              snippet={result.snippet ? highlightSegments(result.snippet) : null}
              showDate
            />
          );
        })}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <p className={LABEL}>
          {/*
            "25 results on this page" rather than a total. An exact total means
            counting every matching row on every search, and this console has
            no page where that number would change a decision. Saying which
            page you are on is honest and costs nothing — silently showing
            twenty-five of ninety is the failure mode the timeline's own
            truncation notice exists to avoid.
          */}
          {results.length} result{results.length === 1 ? '' : 's'}
          {page > 1 && ` · page ${page}`}
        </p>

        <div className="ml-auto flex items-center gap-2">
          {page > 1 && (
            <Link
              href={pageHref(page - 1)}
              className={buttonClass({ variant: 'subtle', size: 'sm' })}
              // Real links, so a result page is a real place in browser
              // history — Back works, and so does opening a page in a new tab.
              rel="prev"
            >
              Previous
            </Link>
          )}
          {truncated && (
            <Link
              href={pageHref(page + 1)}
              className={buttonClass({ variant: 'subtle', size: 'sm' })}
              rel="next"
            >
              More results
            </Link>
          )}
        </div>
      </div>

      {/* Announced rather than only rendered: a screen-reader user submitting
          the form gets no indication the page below it changed otherwise. */}
      <p className="sr-only" role="status">
        {query
          ? `${results.length} results for ${query}`
          : `${results.length} messages match the filters`}
      </p>
    </div>
  );
}

/**
 * Nothing matched.
 *
 * Distinct from `SearchPrompt` below for the same reason the timeline's two
 * empty states are distinct: one means *you have not asked yet*, the other
 * means *the answer is no*. Collapsing them into a single "nothing here" cost
 * this project a debugging session once, on the timeline, and the lesson
 * generalises.
 *
 * It also says what to try, because the 'simple' text-search config does not
 * stem — "deadline" finds "deadlines" only through the trailing-prefix match,
 * so a plural typed in full genuinely can miss.
 */
export function SearchEmpty({
  query,
  filtered,
}: {
  query: string;
  filtered: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <span
        className="flex size-12 items-center justify-center rounded-xl border border-border bg-panel"
        aria-hidden
      >
        <SearchX className="size-5 text-muted-foreground" />
      </span>

      <h2 className="mt-4 text-heading font-semibold">No matches</h2>

      <p className="mt-2 max-w-[38ch] text-row text-balance text-muted-foreground">
        {query ? (
          <>
            Nothing in your messages contains{' '}
            <span className="font-mono text-foreground">{query}</span>
            {filtered && ' within the filters you have set'}.
          </>
        ) : (
          'No messages fall inside these filters.'
        )}
      </p>

      {filtered && (
        <Link href="/search" className={buttonClass({ variant: 'subtle', className: 'mt-5' })}>
          Clear filters
        </Link>
      )}
    </div>
  );
}

/**
 * Before anything has been asked.
 *
 * Carries the query grammar, because it is genuinely not guessable and this is
 * the only moment the reader is looking at an empty results area with nothing
 * else to read. Every one of these three is a real capability of
 * `websearch_to_tsquery`, verified against the live database — not a wish list.
 */
export function SearchPrompt() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <span
        className="flex size-12 items-center justify-center rounded-xl border border-border bg-panel"
        aria-hidden
      >
        <Telescope className="size-5 text-muted-foreground" />
      </span>

      <h2 className="mt-4 text-heading font-semibold">Search every channel at once</h2>

      <p className="mt-2 max-w-[40ch] text-row text-balance text-muted-foreground">
        One query across every connected account — email and chat in the same
        list, ranked by how well they match rather than by when they arrived.
      </p>

      <dl className="mt-6 grid gap-x-4 gap-y-2 text-left text-note sm:grid-cols-[auto_1fr]">
        <Hint syntax="&quot;exact phrase&quot;">these words, in this order</Hint>
        <Hint syntax="invoice or receipt">either word</Hint>
        <Hint syntax="meeting -cancelled">the first, not the second</Hint>
      </dl>
    </div>
  );
}

function Hint({ syntax, children }: { syntax: string; children: string }) {
  return (
    <>
      <dt className="font-mono text-meta text-foreground">{syntax}</dt>
      <dd className={cn('text-muted-foreground', 'sm:pt-px')}>{children}</dd>
    </>
  );
}

/** Same geometry as a result row, so nothing jumps when the results land. */
export function SearchSkeleton() {
  return (
    <div aria-hidden>
      <ul className="animate-pulse">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="relative flex gap-3.5">
            <span className="relative flex w-2 shrink-0 justify-center">
              <span
                className={cn('absolute top-0 w-px bg-border', i === 4 ? 'h-5' : 'bottom-0')}
              />
              <span className="absolute top-[9px] size-[7px] rounded-full bg-faint ring-[3px] ring-background" />
            </span>

            <div className="flex flex-1 gap-2.5 pb-4 pt-1">
              <span className="mt-0.5 size-5 shrink-0 rounded-md bg-faint/50" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="h-3 w-32 rounded bg-faint/60" />
                  <span className="ml-auto h-3 w-14 rounded bg-faint/40" />
                </div>
                <span className="mt-2 block h-3.5 w-3/4 rounded bg-faint/60" />
                <span className="mt-1.5 block h-3 w-5/6 rounded bg-faint/40" />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <span className="sr-only">Searching</span>
    </div>
  );
}

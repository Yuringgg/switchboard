import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AppShell } from '@/components/app-shell';
import { Callout } from '@/components/callout';
import { SearchForm } from '@/components/search-form';
import {
  PAGE_SIZE,
  SearchEmpty,
  SearchPrompt,
  SearchResults,
  SearchSkeleton,
} from '@/components/search-results';
import { fetchChannels, type ChannelRow } from '@/lib/channels';
import { hasFilters, searchMessages, type SearchResult } from '@/lib/search';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Search · Switchboard' };

/**
 * Cross-channel search (US-4).
 *
 * The whole state of this screen is in the URL — query, channel filters, date
 * bounds, page. That is what makes a search a link you can send someone, and
 * it is why the form is a real GET form rather than client state.
 *
 * ⚠ Searching runs through `search_messages`, a SECURITY INVOKER function, so
 * RLS scopes it to the signed-in user exactly as it scopes a table query. There
 * is no `owner_id` anywhere in this file for that reason — passing a tenant key
 * from the client is the one thing this system never does.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    channel?: string | string[];
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;

  const supabase = await createClient();

  // Checked here as well as in `proxy.ts`: this page renders message content,
  // and it must not do so for an unauthenticated request even if the route
  // gate is ever misconfigured.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/search');

  const query = (params.q ?? '').slice(0, 200);
  // A repeated `?channel=` param arrives as an array; a single one as a string.
  const channelIds = params.channel
    ? Array.isArray(params.channel)
      ? params.channel
      : [params.channel]
    : [];
  const from = params.from ?? '';
  const to = params.to ?? '';

  // Clamped rather than trusted: `?page=-4` would become a negative OFFSET,
  // which Postgres rejects with an error that reads as a broken search.
  const page = Math.max(1, Math.min(400, Number.parseInt(params.page ?? '1', 10) || 1));

  const filtered = hasFilters({ channelIds, from, to });
  const asked = Boolean(query.trim()) || filtered;

  const channels = fetchChannels(supabase);

  /*
   * Only run the query when something was actually asked. With no query and no
   * filters this RPC would return the newest 25 messages ranked at 0 — which is
   * the timeline, rendered worse, on a page that has not been asked a question.
   * Not awaited: the shell streams ahead of it.
   */
  const results = asked
    ? searchMessages(supabase, {
        query,
        channelIds,
        from: from || null,
        to: to || null,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
    : null;

  /** Another page of the same search — every filter preserved, page swapped. */
  const pageHref = (next: number) => {
    const search = new URLSearchParams();
    if (query) search.set('q', query);
    for (const id of channelIds) search.append('channel', id);
    if (from) search.set('from', from);
    if (to) search.set('to', to);
    if (next > 1) search.set('page', String(next));
    return `/search?${search.toString()}`;
  };

  return (
    <AppShell
      title="Search"
      description="One query, every channel, ranked by relevance."
      userEmail={user.email ?? 'Signed in'}
      userId={user.id}
      activeHref="/search"
      channels={channels}
    >
      <Suspense fallback={null}>
        <SearchControls
          channels={channels}
          query={query}
          selectedChannels={channelIds}
          from={from}
          to={to}
        />
      </Suspense>

      {results ? (
        <Suspense key={`${query}:${channelIds.join()}:${from}:${to}:${page}`} fallback={<SearchSkeleton />}>
          <ResultSection
            results={results}
            channels={channels}
            query={query}
            filtered={filtered}
            page={page}
            pageHref={pageHref}
          />
        </Suspense>
      ) : (
        <SearchPrompt />
      )}
    </AppShell>
  );
}

/**
 * The form needs the channel list to render its filter chips, and that list is
 * a promise. Isolated in its own async component so awaiting it does not hold
 * up the results below — the two are independent queries.
 */
async function SearchControls({
  channels,
  query,
  selectedChannels,
  from,
  to,
}: {
  channels: Promise<{ channels: ChannelRow[]; error: string | null }>;
  query: string;
  selectedChannels: string[];
  from: string;
  to: string;
}) {
  const { channels: rows } = await channels;

  return (
    <SearchForm
      query={query}
      channels={rows}
      selectedChannels={selectedChannels}
      from={from}
      to={to}
    />
  );
}

async function ResultSection({
  results,
  channels,
  query,
  filtered,
  page,
  pageHref,
}: {
  results: Promise<{
    results: SearchResult[];
    truncated: boolean;
    error: string | null;
  }>;
  channels: Promise<{ channels: ChannelRow[]; error: string | null }>;
  query: string;
  filtered: boolean;
  page: number;
  pageHref: (page: number) => string;
}) {
  const [{ results: rows, truncated, error }, { channels: channelRows }] =
    await Promise.all([results, channels]);

  if (error) {
    return (
      <Callout tone="error" role="alert">
        Could not search: {error}
      </Callout>
    );
  }

  if (rows.length === 0) {
    return <SearchEmpty query={query} filtered={filtered} />;
  }

  return (
    <SearchResults
      results={rows}
      channels={channelRows}
      query={query}
      truncated={truncated}
      page={page}
      pageHref={pageHref}
    />
  );
}

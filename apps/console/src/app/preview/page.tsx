import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AppShell } from '@/components/app-shell';
import { AttentionEmpty, AttentionList } from '@/components/attention-list';
import { ChannelList, ChannelListSkeleton } from '@/components/channel-list';
import { SearchForm } from '@/components/search-form';
import {
  SearchEmpty,
  SearchPrompt,
  SearchResults,
  SearchSkeleton,
} from '@/components/search-results';
import { Timeline, TimelineEmpty, TimelineSkeleton } from '@/components/timeline';
import type { AttentionItem } from '@/lib/attention';
import type { ChannelRow } from '@/lib/channels';
import type { SearchResult } from '@/lib/search';
import type { TimelineMessage } from '@/lib/timeline';

/** Not a real user. Realtime is scoped to it and will simply match nothing. */
const PREVIEW_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Design preview. **Development only.**
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Every screen worth designing in this console is behind a login and needs
 * real mail to render at all, so the only way to look at the timeline used to
 * be: sign in, then wait for someone to email you. That makes the visual work
 * unreviewable — you cannot judge density, hierarchy or the day dividers
 * against twelve messages you did not choose, and you certainly cannot check
 * what two interleaved channels look like before WhatsApp exists.
 *
 * This renders the real components — same `AppShell`, same `Timeline`, same
 * tokens — over fixture rows, so a change can be seen before it is shipped.
 * It is a workbench, not a product surface.
 *
 * ── The guards, and why there are two ────────────────────────────────────────
 *
 * `notFound()` on anything but `NODE_ENV === 'development'` means the route
 * does not exist in the Vercel build at all. That is the guard that matters:
 * Next inlines `NODE_ENV` at build time, so this is resolved before deploy
 * rather than evaluated per request.
 *
 * It is also listed in `PUBLIC_PATHS` in `src/proxy.ts` — necessarily, since a
 * preview you must sign in to see does not solve the problem it exists for.
 * That entry carries the same environment check, so the two cannot disagree.
 *
 * ⚠ Every message below is invented. Nothing here reads the database, and
 * nothing here may ever be pointed at real rows — the whole point is that this
 * is the one screen in the console with no tenant behind it.
 */
export const metadata: Metadata = { title: 'Preview · Switchboard' };

const CHANNELS: ChannelRow[] = [
  {
    id: 'ch-gmail',
    type: 'gmail',
    display_name: 'yuri@example.com',
    status: 'active',
    last_error: null,
    created_at: '2026-07-20T00:00:00Z',
  },
  {
    id: 'ch-whatsapp',
    type: 'whatsapp',
    display_name: '+63 900 000 0000',
    status: 'active',
    last_error: null,
    created_at: '2026-07-22T00:00:00Z',
  },
];

/**
 * Written to exercise the cases that actually break a layout, not to look
 * tidy: a subject long enough to truncate, an empty body, a self-sent message,
 * a sender with no display name, a run of one channel interrupted by the
 * other, and a day boundary in the middle of a thread.
 */
function fixtures(): TimelineMessage[] {
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

  return [
    {
      id: 'm1',
      direction: 'inbound',
      subject: 'Re: Landing page copy — one more pass before Thursday',
      body_text:
        'Hi Yuri,\n\nThanks for the revised deck. Two things before we sign off:\n\n1. The hero line still reads a bit long on mobile — can we cut it to under ten words?\n2. Legal wants the disclaimer moved above the fold.\n\nCan we do 3pm Thursday to go through both? I only need half an hour.\n\nMaria',
      sent_at: at(14),
      channel_id: 'ch-gmail',
      sender: { external_id: 'maria@iozera.com', display_name: 'Maria Santos' },
      /*
       * Phase 4A. This exact string is what `llama-3.1-8b-instant` actually
       * returned for this body when the eval set was run on 2026-08-02 — not
       * an invented sample. A fixture that flatters the model teaches nothing
       * about how the real thing reads at `text-note` in mono.
       */
      summary: {
        text:
          'Maria wants to discuss two changes to the landing page copy: cutting the hero line to under ten words and moving the disclaimer above the fold, and schedules a meeting for 3pm Thursday or Friday morning.',
        model: 'llama-3.1-8b-instant',
      },
    },
    {
      id: 'm2',
      direction: 'inbound',
      subject: null,
      body_text: 'Sige, sending the files na — nasa drive na lahat. Salamat!',
      sent_at: at(38),
      channel_id: 'ch-whatsapp',
      sender: { external_id: '+639170000001', display_name: 'Fatima R.' },
    },
    {
      id: 'm3',
      direction: 'outbound',
      subject: 'Weekly status — ingest pipeline is live',
      body_text:
        'Quick update: mail now reaches the console within a few seconds of arriving, with no refresh. Next up is WhatsApp.',
      sent_at: at(96),
      channel_id: 'ch-gmail',
      sender: { external_id: 'yuri@example.com', display_name: 'Yuri' },
    },
    {
      id: 'm4',
      direction: 'inbound',
      subject: 'Invoice 2026-118',
      body_text: '',
      sent_at: at(150),
      channel_id: 'ch-gmail',
      sender: { external_id: 'billing@vendor.example', display_name: null },
    },
    {
      /*
       * A photo with no caption — no subject AND no body, which is the one
       * combination that renders the "Empty message" fallback. It became a
       * reachable state in Phase 2: WhatsApp media carries no text of its own,
       * and `normalize` deliberately does not invent an "[image]" placeholder
       * (see packages/adapters/whatsapp/src/normalize.ts, decision 3). Until
       * Phase 3 stores attachments there is genuinely nothing else to show, so
       * this is the row that has to be judged rather than assumed.
       */
      id: 'm4b',
      direction: 'inbound',
      subject: null,
      body_text: '',
      sent_at: at(120),
      channel_id: 'ch-whatsapp',
      sender: { external_id: '+639170000001', display_name: 'Fatima R.' },
    },
    {
      // A reaction: stored as a message, and its whole body is one emoji.
      id: 'm4c',
      direction: 'inbound',
      subject: null,
      body_text: '👍',
      sent_at: at(132),
      channel_id: 'ch-whatsapp',
      sender: { external_id: '+639170000002', display_name: 'Ram' },
    },
    {
      id: 'm5',
      direction: 'inbound',
      subject: 'Notes from the client call',
      body_text:
        'Recap of what they asked for:\n\n— Ship the reporting view first, dashboard can wait\n— They want CSV export, not a PDF\n— Budget review moved to the 12th\n\nI said we would confirm the date by Friday.',
      sent_at: at(60 * 26),
      channel_id: 'ch-gmail',
      sender: { external_id: 'dan@client.example', display_name: 'Dan Whitfield' },
    },
    {
      id: 'm6',
      direction: 'inbound',
      subject: null,
      body_text: 'Nasa office ka ba bukas? Dadaan sana ako around 10.',
      sent_at: at(60 * 29),
      channel_id: 'ch-whatsapp',
      sender: { external_id: '+639170000002', display_name: 'Ram' },
    },
  ];
}

/**
 * A channel in trouble. The renewal sweep writes `last_error` when a Gmail
 * watch fails to renew, and `/channels` is the only screen it ever surfaces
 * on — so it is the state most worth being able to look at, and the one least
 * likely to be around when you want to.
 */
const CHANNELS_WITH_ERROR: ChannelRow[] = [
  {
    ...CHANNELS[0]!,
    status: 'error',
    last_error:
      'Gmail rejected the refresh token (invalid_grant). Reconnect the account to restore ingestion.',
  },
  CHANNELS[1]!,
];

/**
 * Search results over the same fixtures.
 *
 * The snippets carry the real STX/ETX delimiters `ts_headline` emits, because
 * the thing worth looking at here is what a highlighted run looks like at
 * `text-row` against `bg-live/20` — in both schemes — and a fixture that fakes
 * the shape would not answer that. Written as `\u` escapes for the same reason
 * `lib/search.ts` does: as literal control characters they are invisible and a
 * stray edit silently deletes them.
 *
 * Deliberately includes a result whose fragments do NOT start at the beginning
 * of the body, which is the normal case and the one that shows whether the two
 * `FragmentDelimiter` ellipses read as intended.
 */
/** Wraps a run the way `ts_headline` does. Escapes, not literal control
 *  characters: those are invisible in an editor and a stray edit deletes them
 *  silently. Must match `chr(2)`/`chr(3)` in migration 0007. */
const hit = (text: string) => `\u0002${text}\u0003`;
function searchFixtures(): SearchResult[] {
  const rows = fixtures();

  const withSnippet = (
    message: TimelineMessage,
    snippet: string,
    rank: number,
  ): SearchResult => ({ ...message, snippet, rank });

  return [
    withSnippet(
      rows[0]!,
      'can we cut it to under ten words? … Can we do 3pm ' + hit('Thursday') + ' to go through both? I only need half',
      0.87,
    ),
    withSnippet(
      rows[6]!,
      'Budget review moved to the 12th — I said we would confirm the date by ' + hit('Friday') + '',
      0.41,
    ),
    withSnippet(
      rows[1]!,
      'Sige, sending the ' + hit('files') + ' na — nasa drive na lahat. Salamat!',
      0.12,
    ),
  ];
}

/**
 * Attention-queue fixtures (US-9).
 *
 * Written to exercise what actually varies on this screen rather than to look
 * tidy: an item already past its time, one starting soon, one with **no date at
 * all** (the common case for an action item), one already confirmed onto a
 * calendar, a Taglish quote, and a long title that has to wrap.
 *
 * ⚠ The quotes are the point. Every row shows the sentence it came from, so a
 * fixture whose quote is a neat one-liner would flatter a layout that has to
 * survive a two-line one out of a real mail.
 */
function attentionFixtures(): AttentionItem[] {
  const now = Date.now();
  const at = (hoursFromNow: number) =>
    new Date(now + hoursFromNow * 3_600_000).toISOString();

  const message = (
    id: string,
    subject: string | null,
    channel: string,
    name: string,
    ref: string,
    hoursAgo: number,
  ) => ({
    id,
    subject,
    sentAt: new Date(now - hoursAgo * 3_600_000).toISOString(),
    channelId: channel,
    senderName: name,
    senderRef: ref,
  });

  return [
    {
      id: 'x1',
      kind: 'meeting',
      title: 'Project sync with Ms. Maria',
      quote:
        'Confirming our project sync on Friday 7 August 2026 at 3:00 PM, at the iOzera office. Agenda: Switchboard demo and Phase 5 scope.',
      startsAt: at(30),
      dueAt: null,
      location: 'iOzera office',
      participants: ['Ms. Maria'],
      confidence: 0.95,
      model: 'llama-3.1-8b-instant',
      calendarEventId: null,
      confirmedAt: null,
      message: message('m1', 'Project sync with Ms. Maria', 'ch-gmail', 'Maria Santos', 'maria@iozera.com', 20),
    },
    {
      id: 'x2',
      kind: 'action_item',
      title: 'Review the Phase 5 scope before Monday',
      quote: 'Can you review the Phase 5 scope before then?',
      startsAt: null,
      dueAt: at(-6),
      location: null,
      participants: [],
      confidence: 0.8,
      model: 'llama-3.1-8b-instant',
      calendarEventId: null,
      confirmedAt: null,
      message: message('m1', 'Project sync with Ms. Maria', 'ch-gmail', 'Maria Santos', 'maria@iozera.com', 20),
    },
    {
      id: 'x3',
      kind: 'commitment',
      title: 'Send the files on Drive',
      quote: 'Sige, sending the files na — nasa drive na lahat. Salamat!',
      startsAt: null,
      dueAt: null,
      location: null,
      participants: [],
      confidence: 0.6,
      model: 'llama-3.1-8b-instant',
      calendarEventId: null,
      confirmedAt: null,
      message: message('m2', null, 'ch-whatsapp', 'Fatima R.', '+639170000001', 3),
    },
    {
      id: 'x4',
      kind: 'meeting',
      title: 'Standup',
      quote: 'Standup moved to 9am tomorrow, same link.',
      startsAt: at(11),
      dueAt: null,
      location: null,
      participants: [],
      confidence: 0.9,
      model: 'llama-3.1-8b-instant',
      calendarEventId: 'sb0000000000000000000000000000000a',
      confirmedAt: new Date(now - 3_600_000).toISOString(),
      message: message('m3', 'Standup', 'ch-gmail', 'Luis', 'luis@iozera.com', 26),
    },
    {
      id: 'x5',
      kind: 'question',
      title: 'Which invoice number covers the July retainer?',
      quote:
        'Kailangan po namin ng confirmation bago mag Friday kasi may cutoff ang accounting team namin — alin pong invoice ang para sa July retainer?',
      startsAt: null,
      dueAt: null,
      location: null,
      participants: [],
      confidence: 0.55,
      model: 'llama-3.1-8b-instant',
      calendarEventId: null,
      confirmedAt: null,
      message: message('m4', 'Follow up: invoice', 'ch-gmail', 'Accounting', 'ar@vendor.example', 50),
    },
  ];
}

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; screen?: string }>;
}) {
  if (process.env.NODE_ENV !== 'development') notFound();

  const { state = 'messages', screen = 'timeline' } = await searchParams;

  const rows =
    state === 'unconnected'
      ? []
      : state === 'error'
        ? CHANNELS_WITH_ERROR
        : CHANNELS;

  const channels = Promise.resolve({ channels: rows, error: null });

  if (screen === 'channels') {
    return (
      <AppShell
        title="Channels"
        description="Connect an account and its messages flow into the timeline."
        userEmail="preview@switchboard.local"
        userId={PREVIEW_USER_ID}
        activeHref="/channels"
        channels={channels}
      >
        <Suspense fallback={<ChannelListSkeleton />}>
          {state === 'loading' ? (
            <ChannelListSkeleton />
          ) : (
            <ChannelList rows={rows} error={null} />
          )}
        </Suspense>
      </AppShell>
    );
  }

  if (screen === 'attention') {
    /*
     * ⚠ The two empty states here are the reason this screen is in the preview
     * at all. "Nothing has been read yet" and "nothing needs your attention"
     * look similar and mean opposite things — one is a pipeline that has not
     * run, the other is a pipeline that ran and found nothing. This console has
     * already paid a full debugging session for two empty states that
     * converged (the timeline's), and they are otherwise impossible to look at
     * side by side, because reaching either needs a particular real corpus.
     */
    const items =
      state === 'empty' || state === 'unread' ? [] : attentionFixtures();

    return (
      <AppShell
        title="Needs attention"
        description="Meetings, commitments and requests found in your messages."
        userEmail="preview@switchboard.local"
        userId={PREVIEW_USER_ID}
        activeHref="/attention"
        channels={channels}
      >
        {items.length === 0 ? (
          <AttentionEmpty extracted={state !== 'unread'} />
        ) : (
          <AttentionList items={items} channels={rows} now={new Date()} />
        )}
      </AppShell>
    );
  }

  if (screen === 'search') {
    const results = searchFixtures();

    return (
      <AppShell
        title="Search"
        description="One query, every channel, ranked by relevance."
        userEmail="preview@switchboard.local"
        userId={PREVIEW_USER_ID}
        activeHref="/search"
        channels={channels}
      >
        <SearchForm
          query={state === 'prompt' ? '' : 'thursday'}
          channels={rows}
          selectedChannels={state === 'filtered' ? [rows[0]?.id ?? ''] : []}
          from={state === 'filtered' ? '2026-07-01' : ''}
          to=""
        />

        {state === 'prompt' ? (
          <SearchPrompt />
        ) : state === 'loading' ? (
          <SearchSkeleton />
        ) : state === 'empty' ? (
          <SearchEmpty query="jakarta office" filtered />
        ) : (
          <SearchResults
            results={results}
            channels={rows}
            query="thursday"
            // So the pager can be looked at without 26 matching messages.
            truncated
            page={1}
            pageHref={(page) => `/preview?screen=search&page=${page}`}
          />
        )}
      </AppShell>
    );
  }

  const messages = state === 'messages' || state === 'error' ? fixtures() : [];
  const channelTypeById = new Map(rows.map((c) => [c.id, c.type]));

  return (
    <AppShell
      title="Timeline"
      description="Every message, every channel, in order."
      userEmail="preview@switchboard.local"
      userId={PREVIEW_USER_ID}
      activeHref="/"
      channels={channels}
    >
      <Suspense fallback={<TimelineSkeleton />}>
        {state === 'loading' ? (
          <TimelineSkeleton />
        ) : messages.length > 0 ? (
          <Timeline
            messages={messages}
            channelTypeById={channelTypeById}
            // So the "Latest N messages" footer can be looked at without
            // needing 51 real messages in the database.
            truncated={state === 'messages'}
          />
        ) : (
          <TimelineEmpty connectedTypes={rows.map((c) => c.type)} />
        )}
      </Suspense>
    </AppShell>
  );
}

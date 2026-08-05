import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AppShell } from '@/components/app-shell';
import { AssistantPanel } from '@/components/assistant-panel';
import { AttentionBoard, AttentionEmpty } from '@/components/attention-board';
import { ChannelList, ChannelListSkeleton } from '@/components/channel-list';
import { ContactList, ContactsEmpty } from '@/components/contact-list';
import { MeetingProposal } from '@/components/meeting-proposal';
import { SearchForm } from '@/components/search-form';
import {
  SearchEmpty,
  SearchPrompt,
  SearchResults,
  SearchSkeleton,
} from '@/components/search-results';
import { Timeline, TimelineEmpty, TimelineSkeleton } from '@/components/timeline';
import { TimelineFilter } from '@/components/timeline-filter';
import type { AssistantAnswer } from '@/lib/assistant';
import type { AttentionItem } from '@/lib/attention';
import type { ChannelRow } from '@/lib/channels';
import type { ContactSummary } from '@/lib/contacts';
import type { ConfirmResult } from '@/lib/proposals';
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
      status: 'not_started',
      statusChangedAt: null,
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
      status: 'in_progress',
      statusChangedAt: new Date(now - 7_200_000).toISOString(),
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
      status: 'not_started',
      statusChangedAt: null,
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
      /*
       * ⚠ On the calendar and NOT done, on purpose. Migration 0012 argues that
       * `confirmed_at` must not be read as completion — a meeting booked for
       * tomorrow is squarely in progress — and this is the fixture that makes
       * the claim visible rather than leaving it in a comment.
       */
      status: 'in_progress',
      statusChangedAt: new Date(now - 5_400_000).toISOString(),
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
      status: 'done',
      statusChangedAt: new Date(now - 1_800_000).toISOString(),
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

/**
 * Contact fixtures (US-5).
 *
 * ⚠ **The first row is the whole reason this preview exists.** With only Gmail
 * connected, every real contact has exactly one handle, so the merge — one
 * person, an email address AND a phone number — cannot be seen anywhere in the
 * running console. This is the only way to look at it before a WhatsApp number
 * is provisioned, and it is step 5 of the demo sequence.
 *
 * `merged: false` renders the state the real data is in today, so the two can
 * be compared side by side.
 */
function contactFixtures(merged: boolean): ContactSummary[] {
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  return [
    {
      id: 'c1',
      displayName: 'Maria Santos',
      identities: merged
        ? [
            { id: 'i1', channelType: 'gmail', externalId: 'maria@iozera.com', displayName: 'Maria Santos' },
            { id: 'i2', channelType: 'whatsapp', externalId: '+639170000042', displayName: 'Maria' },
          ]
        : [{ id: 'i1', channelType: 'gmail', externalId: 'maria@iozera.com', displayName: 'Maria Santos' }],
      messageCount: merged ? 23 : 14,
      lastMessageAt: day(0),
    },
    {
      id: 'c2',
      // No display name from the provider — the list falls back to the handle,
      // and `initials()` takes a phone number's LAST two digits because every
      // number in this corpus starts +63 9.
      displayName: '+63 917 000 0001',
      identities: [
        { id: 'i3', channelType: 'whatsapp', externalId: '+639170000001', displayName: null },
      ],
      messageCount: 6,
      lastMessageAt: day(1),
    },
    {
      id: 'c3',
      displayName: 'A vendor with a very long organisation name that has to truncate somewhere',
      identities: [
        { id: 'i4', channelType: 'gmail', externalId: 'accounts-receivable@vendor.example.com', displayName: null },
      ],
      messageCount: 2,
      lastMessageAt: day(9),
    },
    {
      id: 'c4',
      // Zero messages is a real state: a contact row exists the moment an
      // identity resolves. Sorted last rather than hidden, because a list that
      // omitted it would disagree with the count above it.
      displayName: 'Fatima R.',
      identities: [
        { id: 'i5', channelType: 'gmail', externalId: 'fatima@iozera.com', displayName: 'Fatima R.' },
      ],
      messageCount: 0,
      lastMessageAt: null,
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

  if (screen === 'contacts') {
    /*
     * ⚠ The fixture that matters is the one with TWO identities.
     *
     * With only Gmail connected, every real contact has exactly one handle and
     * the merge — the entire reason this screen exists — is invisible. This is
     * the only way to see what one person with an email address *and* a phone
     * number looks like before WhatsApp is provisioned, which is step 5 of the
     * demo sequence.
     */
    return (
      <AppShell
        title="Contacts"
        description="One person, however many handles they have."
        userEmail="preview@switchboard.local"
        userId={PREVIEW_USER_ID}
        activeHref="/contacts"
        channels={channels}
      >
        {state === 'empty' ? (
          <ContactsEmpty connected />
        ) : state === 'unconnected' ? (
          <ContactsEmpty connected={false} />
        ) : (
          <ContactList contacts={contactFixtures(state !== 'single')} />
        )}
      </AppShell>
    );
  }

  if (screen === 'proposal') {
    /*
     * ⚠ The CONFIRMED state is the reason this is in the preview.
     *
     * On 2026-08-03 Yuri clicked "Add to Google Calendar", the event was
     * created, and the card kept showing an editable form with a live button —
     * so it read as though nothing had happened. The fix was `revalidatePath`
     * in the server action, but the state it reveals could not be looked at
     * anywhere: reaching it in the running console means confirming a real
     * meeting onto a real calendar, which is not something to do to inspect a
     * layout.
     *
     * `?state=confirmed` renders it directly. The action is a no-op here — this
     * harness never touches a database and must never touch a calendar.
     */
    async function noop(): Promise<ConfirmResult> {
      'use server';
      return { ok: false, message: 'The preview never creates anything.' };
    }

    const [proposal] = attentionFixtures();
    const confirmed = state === 'confirmed';

    return (
      <AppShell
        title="Message"
        description="One message, in full."
        userEmail="preview@switchboard.local"
        userId={PREVIEW_USER_ID}
        activeHref="/"
        channels={channels}
      >
        <MeetingProposal
          item={
            confirmed
              ? {
                  ...proposal!,
                  calendarEventId: 'sb0dc86caf477f4632a0b10f9f50776ba4',
                  confirmedAt: new Date().toISOString(),
                }
              : proposal!
          }
          action={noop}
        />
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
          <AttentionBoard items={items} channels={rows} now={new Date()} />
        )}
      </AppShell>
    );
  }

  if (screen === 'assistant') {
    /*
     * ⚠ Here for the figure above the composer, which has four states and no
     * other way to be looked at.
     *
     * Reaching them in the running console means spending real questions out of
     * an allowance of roughly thirty a day, shared by every tenant — and two of
     * the four (a refusal, and the provider being unavailable) cannot be
     * summoned on demand at all. `?state=refused` and `?state=error` render
     * them directly.
     *
     * The action is a no-op. This harness must never reach Groq, the worker's
     * `/embed`, or the database.
     */
    const rowsForCitation = fixtures();

    const ANSWERS: Record<string, AssistantAnswer> = {
      answered: {
        answer:
          'Maria asked for two changes to the landing page copy before Thursday: the hero line cut to under ten words, and the disclaimer moved above the fold [1]. She proposed 3pm Thursday to go through both.',
        citations: [
          {
            messageId: rowsForCitation[0]!.id,
            subject: rowsForCitation[0]!.subject,
            senderName: 'Maria Santos',
            sentAt: rowsForCitation[0]!.sent_at,
            excerpt:
              'The hero line still reads a bit long on mobile — can we cut it to under ten words? Legal wants the disclaimer moved above the fold.',
          },
        ],
        refused: false,
        error: null,
      },
      refused: {
        answer: 'I could not find anything in your messages about that.',
        citations: [],
        refused: true,
        error: null,
      },
      error: {
        answer: '',
        citations: [],
        refused: false,
        error:
          "You have used up today's assistant allowance. It refills gradually — try again later.",
      },
    };

    /**
     * Returns the canned answer for whichever `?state=` is on the URL, so
     * asking anything walks the panel through the real sequence — idle →
     * thinking → the state under review — rather than jumping to it. No prop
     * on the production component, and no code path that only exists here.
     *
     * The pause is deliberate: the figure's reading animation is the state
     * hardest to catch, and a real turn takes a few seconds anyway.
     */
    async function answerFromFixture(): Promise<AssistantAnswer> {
      'use server';
      await new Promise((resolve) => setTimeout(resolve, 2200));
      return ANSWERS[state] ?? ANSWERS.answered!;
    }

    return (
      <AppShell
        title="Assistant"
        description="Ask about your messages. Every answer cites the ones it used."
        userEmail="preview@switchboard.local"
        userId={PREVIEW_USER_ID}
        activeHref="/assistant"
        channels={channels}
      >
        <AssistantPanel
          action={answerFromFixture}
          suggestions={[
            'Did any deployment or build fail?',
            'What kinds of roles have I been sent job alerts about?',
            'Did I receive any money or payments?',
            'Do I have any upcoming meetings?',
          ]}
        />
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
      {/*
        The channel filter (Ms. Maria, 2026-08-05).

        ⚠ Rendered here with `selected={[]}` and NOT wired to anything. This
        harness has no database and no URL state — submitting it navigates to
        `/` and lands on the real console. It is here so the control can be
        LOOKED at without a login, which is the only reason /preview exists, and
        because the real one lives on a route that redirects an unauthenticated
        visitor to the landing page.

        WhatsApp renders as "not connected" here exactly as it does in
        production, because the fixture channel list mirrors the real one.
      */}
      <TimelineFilter
        selected={[]}
        connectedTypes={[...new Set(rows.map((c) => c.type))]}
      />

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
          <TimelineEmpty
            connectedTypes={rows.map((c) => c.type)}
            // `?state=filtered` shows the third empty state — narrowed to a
            // line that is not connected — which is otherwise unreachable
            // without actually connecting WhatsApp.
            filteredTo={state === 'filtered' ? ['whatsapp'] : []}
          />
        )}
      </Suspense>
    </AppShell>
  );
}

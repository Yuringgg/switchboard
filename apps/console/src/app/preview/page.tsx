import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AppShell } from '@/components/app-shell';
import { Timeline, TimelineEmpty, TimelineSkeleton } from '@/components/timeline';
import type { ChannelRow } from '@/lib/channels';
import type { TimelineMessage } from '@/lib/timeline';

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

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.NODE_ENV !== 'development') notFound();

  const { state = 'messages' } = await searchParams;

  const messages = state === 'messages' ? fixtures() : [];
  const rows = state === 'unconnected' ? [] : CHANNELS;

  const channels = Promise.resolve({ channels: rows, error: null });
  const channelTypeById = new Map(rows.map((c) => [c.id, c.type]));

  return (
    <AppShell
      title="Timeline"
      description="Every message, every channel, in order."
      userEmail="preview@switchboard.local"
      userId="00000000-0000-0000-0000-000000000000"
      activeHref="/"
      channels={channels}
    >
      <Suspense fallback={<TimelineSkeleton />}>
        {state === 'loading' ? (
          <TimelineSkeleton />
        ) : messages.length > 0 ? (
          <Timeline messages={messages} channelTypeById={channelTypeById} />
        ) : (
          <TimelineEmpty connectedTypes={rows.map((c) => c.type)} />
        )}
      </Suspense>
    </AppShell>
  );
}

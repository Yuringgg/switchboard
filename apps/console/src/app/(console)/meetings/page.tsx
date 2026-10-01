import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Callout } from '@/components/callout';
import { MeetingsPanel } from '@/components/meetings-panel';
import { PageFrame } from '@/components/page-frame';
import { fetchBotSessions } from '@/lib/meetings/sessions';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Meetings · Switchboard' };

/**
 * Sending a notetaker into a meeting (Phase 7A).
 *
 * ── Why this page exists ────────────────────────────────────────────────────
 *
 * `/api/meetings/bot` shipped on 2026-09-20 and worked from the first real
 * call. Until now the only way to reach it was a `fetch` typed into the browser
 * console, which meant the feature existed for exactly one person and could not
 * be demonstrated to anybody.
 *
 * ⚠ Read the RA 4200 note in `components/meetings-panel.tsx` before changing
 * the form. The consent checkbox is the gate that the DevTools friction used to
 * provide by accident, and it is the most important thing on this screen.
 *
 * ⚠ Nothing here is awaited before the page renders except the session list,
 * which is small and indexed by owner. The sidebar and its channel legend are
 * the layout's (`app/(console)/layout.tsx`), not this page's.
 */
export default async function MeetingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?next=/meetings');

  const { sessions, error } = await fetchBotSessions(supabase);

  return (
    <PageFrame
      title="Meetings"
      description="Send a notetaker into a call, and see what it did."
    >
      {error && (
        <Callout tone="error" role="alert" className="mb-5">
          Could not load the notetakers you have sent: {error}
        </Callout>
      )}

      <MeetingsPanel sessions={sessions} />
    </PageFrame>
  );
}

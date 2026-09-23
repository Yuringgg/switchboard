import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { Callout } from '@/components/callout';
import { MeetingsPanel } from '@/components/meetings-panel';
import { fetchChannels } from '@/lib/channels';
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
 * ⚠ Nothing here is awaited before the shell renders except the session list,
 * which is small and indexed by owner. `channels` is passed down unawaited for
 * the same reason every other page does it — the frame does not depend on it.
 */
export default async function MeetingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?next=/meetings');

  const channels = fetchChannels(supabase);
  const { sessions, error } = await fetchBotSessions(supabase);

  return (
    <AppShell
      title="Meetings"
      description="Send a notetaker into a call, and see what it did."
      userEmail={user.email ?? 'Signed in'}
      userId={user.id}
      activeHref="/meetings"
      channels={channels}
    >
      {error && (
        <Callout tone="error" role="alert" className="mb-5">
          Could not load the notetakers you have sent: {error}
        </Callout>
      )}

      <MeetingsPanel sessions={sessions} />
    </AppShell>
  );
}

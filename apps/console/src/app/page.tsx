import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { NoMessagesYet } from '@/components/empty-state';
import { createClient } from '@/lib/supabase/server';

export default async function TimelinePage() {
  const supabase = await createClient();

  // Middleware already gates this route. Checked again here on purpose: the
  // page should not render a console for an unauthenticated request even if
  // middleware is ever misconfigured or bypassed. Auth checks are cheap;
  // rendering someone's inbox to the wrong person is not.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  /*
   * ⚠ WHEN THIS QUERIES `messages`, DO NOT FILTER BY DIRECTION.
   *
   * Phase 1's done-condition is "send yourself an email and it appears in the
   * deployed console" — and a message you send yourself is `outbound`, because
   * direction is decided by the From address and you are the sender.
   *
   * `docs/06-OPEN-QUESTIONS.md` R12 frames the product around messages received
   * from other people, which makes `where direction = 'inbound'` look like the
   * obviously correct query. It would make the demo email invisible, and the
   * pipeline would read as broken when it is working perfectly.
   *
   * Render both directions. Distinguish them visually if useful; never filter.
   */
  return (
    <AppShell
      title="Timeline"
      description="Every message, every channel, in order."
      userEmail={user.email ?? 'Signed in'}
      activeHref="/"
    >
      <NoMessagesYet />
    </AppShell>
  );
}

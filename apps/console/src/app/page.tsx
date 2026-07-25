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

  return (
    <AppShell
      title="Timeline"
      description="Every message, every channel, in order."
      userEmail={user.email ?? 'Signed in'}
    >
      <NoMessagesYet />
    </AppShell>
  );
}

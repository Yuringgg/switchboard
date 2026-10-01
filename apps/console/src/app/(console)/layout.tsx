import type { ReactNode } from 'react';

import { ConsoleFrame } from '@/components/console-frame';
import { fetchChannels } from '@/lib/channels';
import { createClient } from '@/lib/supabase/server';

/**
 * The signed-in console's frame, rendered ONCE and kept while you move between
 * pages. ADR-031, and the note at the top of `components/console-frame.tsx`.
 *
 * `(console)` is a route group: the parentheses keep it out of the URL, so
 * `/files` is still `/files`.
 *
 * ⚠ With no user this renders the page bare instead of redirecting. Every page
 * here already redirects on its own — to `/login?next=<itself>`, or `/` to
 * `/welcome` — and a redirect thrown here would race those and lose the `next`.
 * The proxy turns signed-out requests away before they get this far anyway;
 * this is the third line, not the first.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return children;

  return (
    <ConsoleFrame
      userEmail={user.email ?? 'Signed in'}
      userId={user.id}
      channels={fetchChannels(supabase)}
    >
      {children}
    </ConsoleFrame>
  );
}

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { VoiceLab } from '@/components/voice-lab';
import { fetchChannels } from '@/lib/channels';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Voice lab · Switchboard' };

/**
 * Voice V0. **Development only.**
 *
 * ── What it is ──────────────────────────────────────────────────────────────
 *
 * A workbench, in the same spirit as `/preview`. It records a clip, sends it to
 * Groq Whisper, and prints the text with the numbers beside it. Nothing more.
 *
 * It exists to answer three questions before V1 gets built on top of them:
 * what the browser actually records, whether Groq takes that blob unconverted,
 * and whether the round trip fits the latency budget in
 * `correspondence/2026-09-10-voice-integration-plan.md` §2.
 *
 * ── Why it is gated twice ───────────────────────────────────────────────────
 *
 * `notFound()` on anything but development means the route is not in the Vercel
 * build at all — Next inlines `NODE_ENV` at build time, so this resolves before
 * deploy rather than per request.
 *
 * ⚠ It is NOT in `PUBLIC_PATHS`, and that is the difference from `/preview`.
 * `/preview` reads nothing and can be public; this one calls a route that
 * spends real Groq quota, so it needs a real session. The proxy redirects to
 * /login on its own, and `/api/voice/transcribe` checks the session again for
 * itself.
 */
export default async function VoiceLabPage() {
  if (process.env.NODE_ENV !== 'development') notFound();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/voice-lab');

  const channels = fetchChannels(supabase);

  return (
    <AppShell
      title="Voice lab"
      description="Record a clip, send it to Whisper, read the text and the timings. Development only."
      userEmail={user.email ?? 'Signed in'}
      userId={user.id}
      activeHref="/voice-lab"
      channels={channels}
    >
      <VoiceLab />
    </AppShell>
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { AssistantPanel } from '@/components/assistant-panel';
import { askAssistant, type AssistantAnswer } from '@/lib/assistant';
import { CHANNEL_META, fetchChannels } from '@/lib/channels';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Assistant · Switchboard' };

/**
 * The assistant (US-6) — the feature Ms. Maria described first:
 *
 * > *"What you get is an assistant — an online assistant — where you can ask
 * > things like 'from the messages I've received, do I have any upcoming
 * > meetings?'"*
 *
 * ⚠ Every claim it makes is cited, and an answer that cites nothing is
 * presented as a refusal. `docs/01-PRODUCT-SPEC.md` §7 makes that a success
 * criterion, and ADR-016 explains why the refusal lives in the prompt rather
 * than in a similarity threshold.
 */
export default async function AssistantPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/assistant');

  const channels = fetchChannels(supabase);

  /**
   * The server action.
   *
   * Defined here rather than in a separate file so it closes over nothing but
   * the request — it builds its own client, so the session it uses is the
   * caller's and RLS scopes retrieval to them. There is no user id passed
   * anywhere in this flow.
   */
  async function ask(
    _previous: AssistantAnswer | null,
    formData: FormData,
  ): Promise<AssistantAnswer> {
    'use server';

    const client = await createClient();
    const {
      data: { user: caller },
    } = await client.auth.getUser();

    // Checked again inside the action: a server action is its own endpoint and
    // does not inherit the page's guard.
    if (!caller) {
      return {
        answer: '',
        citations: [],
        refused: false,
        error: 'Your session expired. Reload the page and sign in again.',
      };
    }

    const { channels: rows } = await fetchChannels(client);
    const labels = new Map(
      rows.map((channel) => [
        channel.id,
        CHANNEL_META[channel.type as keyof typeof CHANNEL_META]?.label ?? channel.type,
      ]),
    );

    return askAssistant(client, String(formData.get('question') ?? ''), labels);
  }

  return (
    <AppShell
      title="Assistant"
      description="Ask about your messages. Every answer cites the ones it used."
      userEmail={user.email ?? 'Signed in'}
      userId={user.id}
      activeHref="/assistant"
      channels={channels}
    >
      <AssistantPanel action={ask} suggestions={SUGGESTIONS} />
    </AppShell>
  );
}

/**
 * Starter questions.
 *
 * Deliberately questions this corpus can actually answer — the first one is Ms.
 * Maria's own example. A suggestion that returns a refusal would teach a new
 * user that the feature is broken, on their first interaction with it.
 */
const SUGGESTIONS = [
  'Do I have any upcoming meetings?',
  'What have I been asked to do this week?',
  'Did any deployment or build fail?',
  'Any job applications or interviews?',
];

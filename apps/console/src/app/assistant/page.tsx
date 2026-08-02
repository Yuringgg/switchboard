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
 * Deliberately questions this corpus can actually answer. A suggestion that
 * returns a refusal teaches a new user that the feature is broken, on their
 * first interaction with it.
 *
 * ⚠ **Reordered on 2026-08-02, after measuring rather than assuming.** The first
 * two used to be *"Do I have any upcoming meetings?"* and *"What have I been
 * asked to do this week?"*, and `apps/worker/scripts/probe-context.ts` shows
 * both currently refuse — the first because every meeting in the corpus is six
 * days old, the second because retrieval has no notion of *importance* and
 * returns newsletters. So the two suggestions most likely to be clicked first
 * were the two guaranteed to disappoint.
 *
 * The ones below are measured to answer with citations. Ms. Maria's own example
 * question stays — it is the demo question and it must be on this screen — but
 * it sits last until Phase 5 extraction backs it, or until the mailbox contains
 * a genuinely future-dated meeting. See ADR-017 and `docs/06-OPEN-QUESTIONS.md`
 * Q9.
 */
const SUGGESTIONS = [
  'Did any deployment or build fail?',
  'What kinds of roles have I been sent job alerts about?',
  'Did I receive any money or payments?',
  'Do I have any upcoming meetings?',
];

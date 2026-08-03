import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { Callout } from '@/components/callout';
import { MergeContact } from '@/components/merge-contact';
import { MessageRow } from '@/components/message-row';
import { CHANNELS, CHANNEL_META, fetchChannels } from '@/lib/channels';
import { fetchContactDetail, fetchContacts } from '@/lib/contacts';
import { mergeContacts, suggestMerges, type MergeResult } from '@/lib/merge';
import { createClient } from '@/lib/supabase/server';
import { channelChangePoints } from '@/lib/timeline';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Contact · Switchboard' };

/**
 * One contact, and every conversation they appear in (US-5).
 *
 * ⚠ **The history is CONVERSATIONS, not "messages they sent".** `messages`
 * records a sender and no recipients (`docs/02-ARCHITECTURE.md` §3), so
 * filtering to their own messages would show one side of every thread and drop
 * the reader's replies — a monologue. US-5 asks for *"every conversation I've
 * had with that person, across all channels, merged"*, and that is what this
 * resolves through their identities.
 *
 * ⚠ A contact that is not yours and one that does not exist are the same
 * `notFound()`. RLS makes them indistinguishable and that is correct — the same
 * rule ADR-018 settled for `/messages/[id]`.
 */
export default async function ContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Checked here as well as in `proxy.ts`: this page renders private message
  // content and must not do so for an unauthenticated request even if the route
  // gate is ever misconfigured.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/contacts/${id}`);

  const channels = fetchChannels(supabase);
  const { contact, messages, error } = await fetchContactDetail(supabase, id);

  if (!contact && !error) notFound();

  const { channels: channelRows } = await channels;
  const channelTypeById = new Map(channelRows.map((c) => [c.id, c.type]));
  const changePoints = channelChangePoints(messages, channelTypeById);

  // For the merge control. Only names and ids — no identities, no messages.
  const { contacts: allContacts } = contact
    ? await fetchContacts(supabase)
    : { contacts: [] };

  const candidates = allContacts
    .filter((c) => c.id !== contact?.id)
    .map((c) => ({ id: c.id, displayName: c.displayName }));

  const suggestions = contact
    ? suggestMerges({ id: contact.id, displayName: contact.displayName }, candidates)
    : [];

  /**
   * The merge server action (Q3).
   *
   * ⚠ Manual only, and the UI proposes rather than decides. Same-name-across-
   * channels is weak evidence: two different Marias exist, and auto-merging the
   * wrong two corrupts data in a way that is tedious to unwind.
   *
   * Defined here so it closes over nothing but the request — it builds its own
   * client, so RLS decides whether either contact is the caller's.
   */
  async function merge(
    _previous: MergeResult | null,
    formData: FormData,
  ): Promise<MergeResult> {
    'use server';

    const client = await createClient();
    const {
      data: { user: caller },
    } = await client.auth.getUser();

    // A server action is its own endpoint and does not inherit the page's guard.
    if (!caller) {
      return { ok: false, message: 'Your session expired. Reload the page and sign in again.' };
    }

    const targetId = String(formData.get('targetId') ?? '');
    const result = await mergeContacts(client, {
      sourceId: String(formData.get('sourceId') ?? ''),
      targetId,
    });

    /*
     * ⚠ On success this contact NO LONGER EXISTS — it was folded into the
     * other one. Staying on its page would leave a screen describing a row that
     * has been deleted, and a refresh would 404.
     *
     * So go to the surviving contact, where both sets of handles are now listed
     * under one name. That is also better feedback than a sentence: the thing
     * the merge was for is visible on arrival. Same class of bug as the
     * calendar card keeping its stale props — a server action returns a value
     * without refetching anything unless it is told to.
     */
    if (result.ok) {
      revalidatePath('/contacts');
      redirect(`/contacts/${targetId}`);
    }

    return result;
  }

  return (
    <AppShell
      title={contact?.displayName ?? 'Contact'}
      description="Every conversation with this person, across every channel."
      userEmail={user.email ?? 'Signed in'}
      userId={user.id}
      activeHref="/contacts"
      channels={channels}
    >
      <Link
        href="/contacts"
        className={cn(
          LABEL,
          'focus-ring -mx-1 mb-5 inline-flex items-center gap-1.5 rounded px-1 py-0.5',
          'text-muted-foreground transition-colors hover:text-foreground',
        )}
      >
        <ArrowLeft className="size-3" aria-hidden />
        Contacts
      </Link>

      {error ? (
        <Callout tone="error" role="alert">
          Could not load that contact: {error}
        </Callout>
      ) : (
        contact && (
          <div>
            {/*
              ── The identities ────────────────────────────────────────────────
              The reason this screen exists. One person, listed once, with every
              handle they are known by underneath — and each handle names its
              channel in words, never by the dot alone (WCAG 1.4.1, and the
              red/green pair is the worst possible one for it).
            */}
            <section>
              <h2 className="text-heading font-semibold text-balance">
                {contact.displayName}
              </h2>

              <ul className={cn(LABEL, 'mt-2 grid gap-1')}>
                {contact.identities.map((identity) => {
                  const meta =
                    CHANNEL_META[identity.channelType as keyof typeof CHANNEL_META];
                  return (
                    <li key={identity.id} className="flex items-center gap-1.5">
                      <span
                        className={cn('size-1 rounded-full', meta?.dotClass ?? 'bg-faint')}
                        aria-hidden
                      />
                      {meta?.label ?? identity.channelType}
                      <span aria-hidden>·</span>
                      <span className="normal-case">{identity.externalId}</span>
                    </li>
                  );
                })}
              </ul>

              {contact.identities.length === 1 && (
                /*
                 * ⚠ Said out loud rather than left to look like a bug.
                 *
                 * With one channel connected every contact has one identity, and
                 * a "merged view" showing one handle reads as a feature that does
                 * not work. Naming the reason is the difference between an
                 * unfinished screen and an honest one — and it is the sentence
                 * to have ready if anyone asks during a demo.
                 */
                <p className={cn(LABEL, 'mt-2 max-w-[60ch] normal-case')}>
                  One handle so far. A second appears here automatically when the same
                  person writes from another connected channel.
                </p>
              )}

              {/*
                ⚠ Manual merge, and the control starts CLOSED. Q3: auto-merging
                on a matching display name corrupts data in a way that is
                tedious to unwind, because two different Marias exist. The
                suggestions rank; the person decides; nothing is preselected.
              */}
              <MergeContact
                subject={{ id: contact.id, displayName: contact.displayName }}
                candidates={candidates}
                suggestions={suggestions}
                action={merge}
              />
            </section>

            <section className="mt-7">
              <p className={cn(LABEL, 'mb-2')}>
                {messages.length === 0
                  ? 'No messages'
                  : `${messages.length} message${messages.length === 1 ? '' : 's'}`}
                {messages.length === 50 && ' · newest 50'}
              </p>

              {messages.length === 0 ? (
                <p className="border-t border-border py-8 text-center text-note text-muted-foreground">
                  Nothing has arrived from this contact yet.
                </p>
              ) : (
                <ul className="border-t border-border">
                  {messages.map((message, index) => {
                    const channelType = channelTypeById.get(message.channel_id);
                    const channel = CHANNELS.find((c) => c.type === channelType);

                    return (
                      /*
                        The SAME `MessageRow` the timeline and search use. One
                        rendering path for a message row is what stops three
                        screens drifting apart — and it means the summary, the
                        open-on-click behaviour and the channel labelling all
                        come for free and stay correct.
                      */
                      <MessageRow
                        key={message.id}
                        message={message}
                        channelLabel={channel?.label ?? null}
                        dotClass={channel?.dotClass ?? 'bg-faint'}
                        showChannel={changePoints.has(message.id)}
                        isLast={index === messages.length - 1}
                        showDate
                      />
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )
      )}
    </AppShell>
  );
}

import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { MeetingProposal } from '@/components/meeting-proposal';
import { fetchMessageExtractions, KIND_LABEL } from '@/lib/attention';
import { CHANNEL_META, fetchChannels } from '@/lib/channels';
import { confirmMeeting, type ConfirmResult } from '@/lib/proposals';
import { createClient } from '@/lib/supabase/server';
import { fetchMessage } from '@/lib/timeline';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Message · Switchboard' };

/**
 * One message, in full — the citation target (US-6).
 *
 * ── Why this route exists, and why not a jump into the timeline ─────────────
 *
 * `docs/02-ARCHITECTURE.md` §4 step 6 originally specified citations as chips
 * that *"jump to the message in the timeline"*. That cannot work reliably: the
 * timeline is capped at the newest 50 messages, so a citation to anything older
 * would scroll to nothing. **A citation that silently fails to resolve is worse
 * than no link at all** — it is precisely the "invented source" impression
 * ADR-007 exists to prevent, arriving through the UI instead of the model.
 *
 * A route resolves any message regardless of age, survives being opened in a new
 * tab, and is what the note on `BODY_LIMIT` already anticipated: *"When Phase 3
 * adds a message route, that route reads the whole body and this ceiling stays
 * where it is: it bounds the list, not the record."* Phase 5 needs it too —
 * ADR-010 requires the source message shown beside every meeting proposal.
 *
 * ⚠ This is a **second place message bodies render**, and the rule in
 * `message-row.tsx` said there was exactly one. That rule is amended rather than
 * quietly broken: its intent — private content is not scattered across the app —
 * holds, because this is one deliberate, RLS-scoped, signed-in route whose whole
 * purpose is showing one message to the person who owns it. See
 * `docs/05-DECISIONS.md` ADR-017.
 *
 * ⚠ A message belonging to someone else and a message that does not exist are
 * both `notFound()`. RLS makes them indistinguishable here, and that is correct:
 * telling a stranger which ids exist in another tenant's mailbox is a leak, even
 * without the content.
 */
export default async function MessagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Middleware already gates this route. Checked again on purpose: a page should
  // not render private mail for an unauthenticated request even if middleware is
  // ever misconfigured.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/messages/${id}`);

  const channels = fetchChannels(supabase);
  const { message, error } = await fetchMessage(supabase, id);

  if (!message && !error) notFound();

  // Phase 5 (US-7b, ADR-010). Fetched only once the message resolved, so a
  // `notFound()` costs one query rather than two.
  const { items: extractions } = message
    ? await fetchMessageExtractions(supabase, id)
    : { items: [] };

  /**
   * The server action.
   *
   * Defined here so it closes over nothing but the request — it builds its own
   * client, so the session it uses is the caller's and RLS decides whether the
   * proposal is theirs. No user id is passed anywhere in this flow.
   *
   * ⚠⚠ This is the ONLY path in Switchboard that writes to the outside world,
   * and it runs only from a form a person submitted on this screen, with the
   * source message rendered below it. ADR-010: propose, never assert.
   */
  async function confirm(
    _previous: ConfirmResult | null,
    formData: FormData,
  ): Promise<ConfirmResult> {
    'use server';

    const client = await createClient();
    const {
      data: { user: caller },
    } = await client.auth.getUser();

    // Checked again inside the action: a server action is its own endpoint and
    // does not inherit the page's guard.
    if (!caller) {
      return { ok: false, message: 'Your session expired. Reload the page and sign in again.' };
    }

    const result = await confirmMeeting(client, {
      extractionId: String(formData.get('extractionId') ?? ''),
      title: String(formData.get('title') ?? ''),
      startsAtLocal: String(formData.get('startsAtLocal') ?? ''),
      endsAtLocal: String(formData.get('endsAtLocal') ?? ''),
      location: String(formData.get('location') ?? ''),
    });

    /*
     * ⚠ Re-render the page, or the card keeps its stale props.
     *
     * `MeetingProposal` collapses to "On your calendar" when the row carries a
     * `calendar_event_id` — but a server action returns a value without
     * refetching anything, so without this the form stays editable and the
     * button stays live after a SUCCESSFUL confirm. Reported by Yuri on
     * 2026-08-03 as "I clicked Add to Google Calendar, nothing happened": the
     * event really was created, and the only acknowledgement was one line of
     * small text below a button that still looked ready to press.
     *
     * That is precisely the state the component's own docstring says must not
     * exist — "a button that looks live and then says 'already done' teaches
     * people to click it twice". The idempotency guards make a second click
     * harmless, but harmless is not the same as legible.
     */
    if (result.ok) revalidatePath(`/messages/${id}`);

    return result;
  }

  const rows = (await channels).channels;
  const channelType = rows.find((channel) => channel.id === message?.channel_id)?.type;
  const channel = channelType
    ? CHANNEL_META[channelType as keyof typeof CHANNEL_META]
    : undefined;

  const outbound = message?.direction === 'outbound';
  const name = outbound ? 'You' : (message?.sender?.display_name ?? null);
  const address = message?.sender?.external_id ?? null;

  return (
    <AppShell
      title="Message"
      description="One message, in full."
      userEmail={user.email ?? 'Signed in'}
      userId={user.id}
      activeHref="/"
      channels={channels}
    >
      <Link
        href="/"
        className={cn(
          LABEL,
          'focus-ring -mx-1 mb-5 inline-flex items-center gap-1.5 rounded px-1 py-0.5',
          'text-muted-foreground transition-colors hover:text-foreground',
        )}
      >
        <ArrowLeft className="size-3" aria-hidden />
        Timeline
      </Link>

      {error ? (
        <p className="text-row text-muted-foreground">
          Could not load that message: {error}
        </p>
      ) : (
        message && (
          <article>
            {/*
              Channel and time in the machine voice, sender in the human one —
              the two-register split the whole console is built on.
            */}
            <p className={cn(LABEL, 'mb-2 flex flex-wrap items-center gap-1.5')}>
              {channel && (
                <span className={cn('size-1 rounded-full', channel.dotClass)} aria-hidden />
              )}
              {channel?.label ?? 'Unknown channel'} · {formatFullTimestamp(message.sent_at)}
            </p>

            <h2 className="text-heading font-semibold text-balance">
              {message.subject ?? (
                <span className="text-muted-foreground italic">No subject</span>
              )}
            </h2>

            <p className="mt-1.5 text-row">
              <span className="font-medium">{name ?? address ?? 'Unknown sender'}</span>
              {address && name && (
                <span className="ml-2 font-mono text-meta text-muted-foreground">
                  {address}
                </span>
              )}
              {outbound && <span className={cn(LABEL, 'ml-2')}>sent</span>}
            </p>

            {/*
              ── The AI summary (Phase 4A, ADR-015) ──────────────────────────
              Same three rules as the opened timeline row, and for the same
              reasons: above the body and never in place of it, in the mono
              machine voice, labelled with the model that wrote it. The original
              is always one glance below — the defence that still holds if a
              prompt injection ever succeeds, because a reader can compare.
            */}
            {message.summary && (
              <div className="mt-5 border-l-2 border-border pl-3">
                <p className={cn(LABEL, 'mb-1')}>
                  Summary · generated by{' '}
                  <span className="normal-case">{message.summary.model}</span>
                </p>
                <p className="max-w-[62ch] font-mono text-note text-muted-foreground">
                  {message.summary.text}
                </p>
              </div>
            )}

            {/*
              ⚠ The WHOLE body, not `bodyForDisplay`. The 4,000-character ceiling
              exists because the timeline serialises fifty bodies into one page;
              here there is exactly one, and it is the one that was asked for.
              Truncating the record view would make a citation resolve to a
              partial quote, which is the opposite of what a citation is for.

              `whitespace-pre-wrap` and never `dangerouslySetInnerHTML`: every
              body in this table was written by somebody else.
            */}
            {/*
              ── Phase 5 proposals (US-7, US-7b, ADR-010) ────────────────────
              ⚠ ABOVE the body, deliberately. ADR-010 requires the source
              message shown beside every proposal, and "beside" means the
              reader can see both without hunting: the proposal states what the
              model read, the body immediately below is what it read it from.
              Putting proposals under a newsletter's worth of text would make
              the evidence something you scroll past to reach.
            */}
            {extractions
              .filter((item) => item.kind === 'meeting')
              .map((item) => (
                <MeetingProposal key={item.id} item={item} action={confirm} />
              ))}

            {/*
              The other kinds are shown but not actionable — there is nothing to
              write them to. They belong here anyway: this is the record view,
              and a commitment found in this message is part of the record.
            */}
            {extractions.some((item) => item.kind !== 'meeting') && (
              <section className="mt-6">
                <p className={cn(LABEL, 'mb-2')}>Also found in this message</p>
                <ul className="grid gap-2">
                  {extractions
                    .filter((item) => item.kind !== 'meeting')
                    .map((item) => (
                      <li key={item.id} className="rounded-md border border-border px-3 py-2">
                        <p className={LABEL}>{KIND_LABEL[item.kind]}</p>
                        <p className="mt-0.5 text-row">{item.title}</p>
                      </li>
                    ))}
                </ul>
              </section>
            )}

            <div className="mt-6 border-t border-border pt-5">
              {message.body_text.trim() ? (
                <p className="max-w-[68ch] text-row whitespace-pre-wrap">
                  {message.body_text}
                </p>
              ) : (
                /*
                  '' is a legal, meaningful value — normalize looked and there
                  was nothing, which is what an attachment-only mail or a bare
                  calendar invite produces. docs/02-ARCHITECTURE.md §2.
                */
                <p className="text-row text-muted-foreground italic">
                  No text in this message — it may carry only attachments.
                </p>
              )}
            </div>
          </article>
        )
      )}
    </AppShell>
  );
}

function formatFullTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

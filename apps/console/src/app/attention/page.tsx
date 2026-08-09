import { Archive as ArchiveIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AppShell } from '@/components/app-shell';
import { ArchiveButton } from '@/components/attention-archive';
import { AttentionBoard, AttentionEmpty } from '@/components/attention-board';
import { Callout } from '@/components/callout';
import {
  fetchAttention,
  KIND_LABEL,
  STATUS_LABEL,
  type AttentionItem,
} from '@/lib/attention';
import { CHANNEL_META, fetchChannels, type ChannelRow } from '@/lib/channels';
import { createClient } from '@/lib/supabase/server';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Needs attention · Switchboard' };

/**
 * "Needs attention" (US-9) — Phase 5.
 *
 * ⭐ **This screen is the answer to a question the assistant could not answer**,
 * and that is not a coincidence. ADR-017 measured *"summarise what needs my
 * attention"* and found the model was never shown a single one of the real
 * problems: semantic search returns prose that *sounds* urgent, because
 * importance is not a direction in embedding space. The fix was never a prompt.
 * It was extracting structure on the way in, which is what this reads.
 *
 * ⚠ Every row is a **proposal** (ADR-010). Nothing here has been acted on, and
 * nothing here has touched a calendar.
 */
export default async function AttentionPage({
  searchParams,
}: {
  /** `?archived=1` shows what has been taken off the board. Migration 0013. */
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === '1';

  const supabase = await createClient();

  // Checked here as well as in `proxy.ts`: this page renders quoted message
  // content, and it must not do so for an unauthenticated request even if the
  // route gate is ever misconfigured.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/attention');

  const channels = fetchChannels(supabase);
  // Not awaited: the shell streams ahead of the queue behind the Suspense
  // boundary below, exactly as the timeline does.
  const attention = fetchAttention(supabase, {
    scope: showArchived ? 'archived' : 'board',
  });
  /*
   * ⚠ A second query, and it runs even on the board view.
   *
   * That is the whole reason archiving is safe to offer without a confirmation
   * step: the count is always on screen and always a link, so nothing a person
   * archives can become invisible. Paying one small indexed read per page load
   * for "the way back is never hidden" is the right trade.
   */
  const archivedCount = showArchived
    ? null
    : fetchAttention(supabase, { scope: 'archived' });

  return (
    <AppShell
      title={showArchived ? 'Archived' : 'Needs attention'}
      description={
        showArchived
          ? 'Cards you have taken off the board. Nothing here has been deleted.'
          : 'Meetings, commitments and requests found in your messages, as a board.'
      }
      userEmail={user.email ?? 'Signed in'}
      userId={user.id}
      activeHref="/attention"
      channels={channels}
      // The only screen laid out across rather than down — see AppShell.
      width="wide"
    >
      <Suspense fallback={<QueueSkeleton />}>
        <Queue
          attention={attention}
          channels={channels}
          archivedCount={archivedCount}
          showArchived={showArchived}
        />
      </Suspense>
    </AppShell>
  );
}

async function Queue({
  attention,
  channels,
  archivedCount,
  showArchived,
}: {
  attention: ReturnType<typeof fetchAttention>;
  channels: Promise<{ channels: ChannelRow[]; error: string | null }>;
  archivedCount: ReturnType<typeof fetchAttention> | null;
  showArchived: boolean;
}) {
  const [{ items, error }, { channels: rows }, archived] = await Promise.all([
    attention,
    channels,
    archivedCount ?? Promise.resolve(null),
  ]);

  if (error) {
    return (
      <Callout tone="error" role="alert">
        Could not load the queue: {error}
      </Callout>
    );
  }

  if (showArchived) {
    return <ArchivedList items={items} channels={rows} />;
  }

  if (items.length === 0) {
    /*
     * ⚠ Two different empty states, and telling them apart needs a second fact
     * this query does not have: whether extraction has run at all.
     *
     * `message_extraction_runs` holds it, but that table is worker-only and
     * carries no console-facing query — and adding one for a single sentence is
     * more surface than the sentence is worth. So the distinction is drawn from
     * what IS in hand: a console with no channel connected has nothing to read,
     * and a console with a channel has been read and found nothing.
     *
     * That is honest for every state this system can actually be in, because
     * extraction runs automatically on ingest. If it ever becomes possible to
     * have messages that have not been through the pass, this needs the real
     * count — see `AttentionEmpty`.
     */
    return (
      <>
        <AttentionEmpty extracted={rows.length > 0} />
        <ArchivedLink count={archived?.items.length ?? 0} />
      </>
    );
  }

  // ONE instant for the whole page, so the overdue boundary cannot fall between
  // two cards of the same render.
  const now = new Date();

  /*
   * ⚠ Counted over OUTSTANDING work only.
   *
   * Every finished item is eventually "already passed" — a commitment due last
   * Tuesday that you completed last Tuesday still has a date in the past. A
   * count over the whole board would therefore climb as the person cleared
   * work, which is exactly backwards, and it would put a red number above a
   * board that is going well.
   */
  const overdue = items.filter((item) => {
    if (item.status === 'done') return false;
    const when = item.startsAt ?? item.dueAt;
    return when !== null && new Date(when).getTime() < now.getTime();
  }).length;

  const done = items.filter((item) => item.status === 'done').length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className={LABEL}>
          {items.length} item{items.length === 1 ? '' : 's'}
          {overdue > 0 && ` · ${overdue} already passed`}
          {done > 0 && ` · ${done} done`}
        </p>

        {/* ⚠ Always on screen when anything is archived. This is what makes
            archiving safe to offer with no confirmation step — the way back is
            never hidden. */}
        <ArchivedLink count={archived?.items.length ?? 0} className="ml-auto" />
      </div>

      <AttentionBoard items={items} channels={rows} now={now} />

      {/*
        ⚠ Said out loud, on the screen, rather than assumed.

        Every row here is a model's reading of somebody's mail. The console
        naming the model is the same honesty ADR-015 required of summaries —
        "generated by llama-3.1-8b-instant" is a more truthful claim than "AI",
        and it is why `extractions.model` is recorded per row (ADR-006).
      */}
      <p className={cn(LABEL, 'mt-8 max-w-[62ch] normal-case')}>
        Each card was read out of a message by{' '}
        <span className="font-mono">{items[0]?.model ?? 'a model'}</span> and quotes the
        sentence it came from. Which column a card is in is yours — nothing moves
        itself, and nothing here has been added to your calendar.
      </p>
    </div>
  );
}

/** The way back. Rendered only when there is something to go back to. */
function ArchivedLink({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null;

  return (
    <Link
      href="/attention?archived=1"
      className={cn(
        LABEL,
        'focus-ring shrink-0 rounded underline underline-offset-2 hover:text-foreground',
        className,
      )}
    >
      {count} archived
    </Link>
  );
}

/**
 * What has been taken off the board.
 *
 * ── ⚠ A list, not a fourth column ────────────────────────────────────────────
 *
 * Archiving exists because the board accumulates; putting the archive on the
 * board as a fourth column would accumulate in exactly the same place and solve
 * nothing. It is a separate view, one click away, and one click back.
 *
 * ⚠ Every card keeps its quote here too. These rows still hold real message
 * content, and "archived" is not a reason to stop showing the sentence a claim
 * came from — if anything it matters more, because this is the view somebody
 * scans to decide whether something was cleared by mistake.
 */
function ArchivedList({
  items,
  channels,
}: {
  items: AttentionItem[];
  channels: ChannelRow[];
}) {
  if (items.length === 0) {
    return (
      <div className="border-t border-border py-12 text-center">
        <ArchiveIcon className="mx-auto size-5 text-faint" aria-hidden />
        <p className="mt-3 text-row font-medium">Nothing archived</p>
        <p className="mx-auto mt-1 max-w-[46ch] text-note text-muted-foreground">
          Cards you take off the board land here. Nothing is ever deleted — the
          extraction pass will not re-read a message it has already been
          through, so a removed card could not come back.
        </p>
        <Link href="/attention" className={cn(buttonClass({ variant: 'subtle' }), 'mt-5')}>
          Back to the board
        </Link>
      </div>
    );
  }

  const channelTypeById = new Map(channels.map((c) => [c.id, c.type]));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className={LABEL}>
          {items.length} archived card{items.length === 1 ? '' : 's'}
        </p>
        <Link
          href="/attention"
          className={cn(
            LABEL,
            'focus-ring ml-auto rounded underline underline-offset-2 hover:text-foreground',
          )}
        >
          Back to the board
        </Link>
      </div>

      <ul className="space-y-2.5">
        {items.map((item) => {
          const channel = channelTypeById.get(item.message.channelId);
          const meta = channel
            ? CHANNEL_META[channel as keyof typeof CHANNEL_META]
            : undefined;

          return (
            <li
              key={item.id}
              className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border border-border bg-panel p-3.5"
            >
              <div className="min-w-0 flex-1">
                <p className={cn(LABEL, 'flex flex-wrap items-center gap-x-2 gap-y-1')}>
                  <span className="text-foreground">{KIND_LABEL[item.kind]}</span>
                  {meta && (
                    <>
                      <span aria-hidden>·</span>
                      <span
                        className={cn('size-1 rounded-full', meta.dotClass)}
                        aria-hidden
                      />
                      <span>{meta.label}</span>
                    </>
                  )}
                  <span aria-hidden>·</span>
                  {/* Which column it will go back to, so Restore is not a
                      surprise. `status` is untouched by archiving precisely so
                      this is knowable. */}
                  <span>returns to {STATUS_LABEL[item.status].toLowerCase()}</span>
                </p>

                <p className="mt-1.5 text-row font-medium text-pretty [overflow-wrap:anywhere]">
                  {item.title}
                </p>

                <blockquote className="mt-2 border-l-2 border-border pl-3 text-note text-muted-foreground text-pretty [overflow-wrap:anywhere]">
                  {item.quote}
                </blockquote>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/messages/${item.message.id}`}
                  prefetch={false}
                  className={cn(
                    LABEL,
                    'focus-ring rounded underline underline-offset-2 hover:text-foreground',
                  )}
                >
                  Open message
                </Link>
                <ArchiveButton id={item.id} title={item.title} archived />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Matches the shape of a loaded board so the page does not jump when it lands.
 *
 * ⚠ Three columns, not a stack of rows. It was the latter until the board
 * landed, and a skeleton whose geometry does not match what replaces it
 * produces exactly the visible jump the streaming boundary exists to avoid —
 * which is worse than no skeleton, because it reads as the page loading twice.
 */
function QueueSkeleton() {
  return (
    <div className="grid gap-x-5 gap-y-8 md:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((column) => (
        <div key={column}>
          <div className="flex items-baseline gap-2 border-b border-border pb-2.5">
            <span className="h-2.5 w-20 rounded bg-faint/60" />
            <span className="ml-auto h-2.5 w-4 rounded bg-faint/40" />
          </div>

          <div className="mt-3 animate-pulse space-y-2.5">
            {[0, 1].map((card) => (
              <div
                key={card}
                className="rounded-lg border border-border bg-panel p-3.5"
              >
                <span className="block h-2.5 w-16 rounded bg-faint/60" />
                <span className="mt-2.5 block h-3 w-3/4 rounded bg-faint/60" />
                <span className="mt-2.5 block h-2.5 w-full rounded bg-faint/40" />
                <span className="mt-1.5 block h-2.5 w-2/3 rounded bg-faint/40" />
              </div>
            ))}
          </div>
        </div>
      ))}

      <span className="sr-only">Loading the board</span>
    </div>
  );
}

import Link from 'next/link';

import { KIND_LABEL } from '@/lib/attention';
import { RELATIONSHIP_LABEL, type ContactBrief as Brief, type FactSource } from '@/lib/brief';
import { CHANNEL_META } from '@/lib/channels';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The brief at the top of `/contacts/[id]`: who this person is, what is open
 * with them, and where they talk to you. Data and its rules are in `lib/brief.ts`.
 *
 * Three rules from the rest of the console, applied here:
 *
 * 1. **Every fact shows the sentence it came from** (PRODUCT.md, principle 3).
 *    "Client" with no quote is a claim the reader cannot check. The quote sits
 *    directly under the fact, not behind a disclosure.
 * 2. **Two states that mean opposite things never look the same**
 *    (principle 2). "Nothing has been read yet" and "it was read and says
 *    nothing" get different sentences.
 * 3. **The model is named, never "AI"** — the same label summaries carry.
 */
export function ContactBrief({
  name,
  brief,
  channelTypeById,
}: {
  name: string;
  brief: Brief;
  channelTypeById: Record<string, string>;
}) {
  const { facts } = brief;
  const firstName = name.split(/\s+/)[0] || name;
  const anyFact = Object.values(facts).some(Boolean);
  const nothingRead = brief.total > 0 && brief.unread === brief.total;

  return (
    <section aria-labelledby="brief-heading" className="mt-7 rounded-xl border border-border bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="brief-heading" className={cn(LABEL, 'text-foreground')}>
          Brief
        </h2>
        {brief.models.length > 0 && (
          <p className={LABEL}>
            read from their conversations by <span className="normal-case">{brief.models.join(', ')}</span>
          </p>
        )}
      </div>

      {/*
        ⚠ Said before the facts, not after. A brief built from half of
        somebody's messages looks complete; the count is what says it is not.
      */}
      {brief.unread > 0 && (
        <p className={cn(LABEL, 'mt-2 normal-case leading-relaxed text-pretty')}>
          {nothingRead
            ? `None of the ${brief.total} messages in these conversations has been read by the extraction pass yet. This fills in as they are.`
            : `${brief.unread} of ${brief.total} messages in these conversations have not been read by the extraction pass yet. This fills in as they are.`}
        </p>
      )}

      {/* ── Who they are ─────────────────────────────────────────────────── */}
      {anyFact ? (
        /*
         * Grouped by the sentence they came from. One line — "I head procurement
         * at Acme, the sign-off is mine" — routinely yields a company, a role and
         * a decision-maker at once, and printing that quote three times reads
         * like three pieces of evidence when there is one.
         */
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {groupBySource(facts).map((group) => (
            <div key={group.source.extractionId} className="min-w-0">
              <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
                {group.items.map((item) => (
                  <div key={item.label} className="contents">
                    <dt className={LABEL}>{item.label}</dt>
                    <dd className="text-row font-medium [overflow-wrap:anywhere]">{item.value}</dd>
                  </div>
                ))}
              </dl>
              <Quote text={group.source.quote} />
              <SourceLink messageId={group.source.messageId} sentAt={group.source.sentAt} />
            </div>
          ))}
        </div>
      ) : (
        !nothingRead && (
          <p className="mt-4 text-note text-muted-foreground text-pretty">
            Nothing read so far says who {firstName} is — no company, role or relationship
            named in these conversations.
          </p>
        )
      )}

      {/* ── What is open ─────────────────────────────────────────────────── */}
      <h3 className={cn(LABEL, 'mt-6')}>Open with {firstName}</h3>
      {brief.open.length === 0 ? (
        <p className="mt-2 text-note text-muted-foreground">
          {nothingRead ? 'Not known until these conversations have been read.' : `Nothing open with ${firstName}.`}
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {brief.open.map((item) => (
            <li key={item.id} className="min-w-0 rounded-lg border border-border bg-background/60 p-3">
              <p className={cn(LABEL, 'flex flex-wrap items-baseline gap-x-2 gap-y-0.5')}>
                <span className="text-foreground">{KIND_LABEL[item.kind]}</span>
                {item.when ? <span>{formatWhen(item.when)}</span> : <span>no date given</span>}
                {item.owedBy && <span>· {item.owedBy === 'me' ? 'you owe this' : `${firstName} owes this`}</span>}
                {item.status === 'in_progress' && <span>· in progress</span>}
              </p>
              <p className="mt-1 text-row font-medium text-pretty [overflow-wrap:anywhere]">{item.title}</p>
              <Quote text={item.quote} />
              <SourceLink messageId={item.messageId} />
            </li>
          ))}
        </ul>
      )}

      {/* ── Where they talk ──────────────────────────────────────────────── */}
      {brief.lines.length > 0 && (
        <>
          <h3 className={cn(LABEL, 'mt-6')}>Where {firstName} writes</h3>
          <ul className="mt-2 grid gap-1.5">
            {brief.lines.map((line) => {
              const type = channelTypeById[line.channelId];
              const meta = type ? CHANNEL_META[type as keyof typeof CHANNEL_META] : undefined;
              return (
                <li key={line.channelId} className={cn(LABEL, 'flex flex-wrap items-center gap-x-2')}>
                  <span className={cn('size-1.5 rounded-full', meta?.dotClass ?? 'bg-faint')} aria-hidden />
                  {/* Named in words, never by the dot alone (WCAG 1.4.1). */}
                  <span className="text-foreground">{meta?.label ?? 'Unknown line'}</span>
                  <span>
                    · {line.count} message{line.count === 1 ? '' : 's'} · last {formatDay(line.lastAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/*
        ── Also mentioned ──────────────────────────────────────────────────
        ⚠ Rows in these conversations whose title names somebody else. Shown,
        so nothing the model found is hidden; NOT rolled up into the facts
        above, because pinning another person's company on this one is the
        confident wrong fact `lib/brief.ts` exists to prevent.
      */}
      {brief.others.length > 0 && (
        <details className="mt-6">
          <summary className={cn(LABEL, 'focus-ring cursor-pointer rounded hover:text-foreground')}>
            Also mentioned in these conversations · {brief.others.length}
          </summary>
          <ul className="mt-2 space-y-2">
            {brief.others.map((other) => (
              <li key={other.source.extractionId} className="min-w-0">
                <p className="text-note font-medium text-pretty [overflow-wrap:anywhere]">{other.source.title}</p>
                <Quote text={other.source.quote} />
                <SourceLink messageId={other.source.messageId} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The facts, grouped by the extraction that states them, in display order. */
function groupBySource(facts: Brief['facts']) {
  const entries: { label: string; value: string; source: FactSource }[] = [];
  if (facts.company) entries.push({ label: 'Company', value: facts.company.value, source: facts.company.source });
  if (facts.role) entries.push({ label: 'Role', value: facts.role.value, source: facts.role.source });
  if (facts.relationship) {
    entries.push({
      label: 'Relationship',
      value: RELATIONSHIP_LABEL[facts.relationship.value],
      source: facts.relationship.source,
    });
  }
  if (facts.decisionMaker) {
    entries.push({
      label: 'Decides',
      // ⚠ "false" is as useful as "true" (packages/ai/src/extract.ts): somebody
      // who has to check with their manager is not the person to ask for a yes.
      value: facts.decisionMaker.value ? 'Makes the call' : 'Checks with someone else',
      source: facts.decisionMaker.source,
    });
  }

  const groups: { source: FactSource; items: { label: string; value: string }[] }[] = [];
  for (const entry of entries) {
    const group = groups.find((g) => g.source.extractionId === entry.source.extractionId);
    if (group) group.items.push({ label: entry.label, value: entry.value });
    else groups.push({ source: entry.source, items: [{ label: entry.label, value: entry.value }] });
  }
  return groups;
}

/**
 * The sentence, verbatim, in the human voice. Never truncated — a quote cut
 * short is a quote whose meaning cannot be checked (the board's rule).
 */
function Quote({ text }: { text: string }) {
  return (
    <blockquote className="mt-1.5 border-l-2 border-border pl-3 text-note text-muted-foreground text-pretty [overflow-wrap:anywhere]">
      {text}
    </blockquote>
  );
}

function SourceLink({ messageId, sentAt }: { messageId: string; sentAt?: string }) {
  return (
    <p className={cn(LABEL, 'mt-1.5')}>
      {sentAt && <span>{formatDay(sentAt)} · </span>}
      {/* `prefetch={false}`: a private message body the reader has not asked for. */}
      <Link
        href={`/messages/${messageId}`}
        prefetch={false}
        className="focus-ring rounded underline underline-offset-2 hover:text-foreground"
      >
        Open message
      </Link>
    </p>
  );
}

/** Manila, like every other date in the console — PH is UTC+8 with no DST. */
function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

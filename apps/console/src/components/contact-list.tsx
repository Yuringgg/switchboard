import { Users } from 'lucide-react';
import Link from 'next/link';

import { CHANNEL_META } from '@/lib/channels';
import type { ContactSummary } from '@/lib/contacts';
import { phraseClue } from '@/lib/tell-apart';
import { initials } from '@/lib/timeline';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The contact list (US-5).
 *
 * A component rather than markup inside the route, for the same reason
 * `search-results.tsx` and `attention-list.tsx` are: `/preview` renders it over
 * fixtures, and a preview that reimplements the screen it is previewing drifts
 * from it within one edit.
 *
 * ── The line this screen exists for ──────────────────────────────────────────
 *
 * `docs/01-PRODUCT-SPEC.md` §1: *"the same client is a phone number in one app
 * and an email address in another, with no link between them."* That link is
 * `contact_identities`, and the handles listed under each name are it. ⚠ **Do
 * not collapse them into one line per contact** — the plural is the feature.
 */
export function ContactList({ contacts }: { contacts: ContactSummary[] }) {
  return (
    <div>
      <p className={cn(LABEL, 'mb-3')}>
        {contacts.length} contact{contacts.length === 1 ? '' : 's'}
      </p>

      <ul className="border-t border-border">
        {contacts.map((contact) => (
          <li key={contact.id} className="border-b border-border">
            <Link
              href={`/contacts/${contact.id}`}
              // ⚠ The detail page renders private message bodies and the reader
              // has not asked for them yet. Same rule as the assistant's
              // citation chips (ADR-018).
              prefetch={false}
              className="focus-ring flex items-start gap-3 px-1 py-3 transition-colors hover:bg-accent"
            >
              {/*
                Monochrome, and a rounded SQUARE. This console spends colour on
                exactly two meanings — which channel, and whether the board is
                live — and a hue per contact would make all three read as
                decoration. Square because a channel dot sits nearby, and two
                round things adjacent read as one repeated element.
              */}
              <span
                aria-hidden
                className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-accent font-mono text-label text-muted-foreground"
              >
                {initials(contact.displayName, contact.identities[0]?.externalId ?? null)}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-row font-medium">
                  {contact.displayName}
                </span>

                <span
                  className={cn(LABEL, 'mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5')}
                >
                  {contact.identities.map((identity) => {
                    const meta =
                      CHANNEL_META[identity.channelType as keyof typeof CHANNEL_META];
                    return (
                      <span key={identity.id} className="inline-flex items-center gap-1">
                        <span
                          className={cn('size-1 rounded-full', meta?.dotClass ?? 'bg-faint')}
                          aria-hidden
                        />
                        {/* ⚠ The channel is NAMED, never carried by the dot
                            alone. Gmail red against WhatsApp green is the
                            red/green confusion pair, and "which line did this
                            come in on" is the question this product exists to
                            answer. WCAG 1.4.1. */}
                        <span className="normal-case">
                          {meta?.label ?? identity.channelType} · {identity.externalId}
                        </span>
                      </span>
                    );
                  })}
                </span>

                {contact.sameName && <SameName name={contact.displayName} {...contact.sameName} />}
              </span>

              <span className={cn(LABEL, 'shrink-0 text-right')}>
                {contact.messageCount} msg{contact.messageCount === 1 ? '' : 's'}
                {contact.lastMessageAt && (
                  <span className="block normal-case">{formatDay(contact.lastMessageAt)}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "1 of 3 named Maria · at Acme" — shown only when the name is shared.
 *
 * Ms. Maria's research task 4. The handles above already differ, but an
 * address is not how anyone remembers a person; a company, a topic or a note
 * is. The clue is the same one Uriel says aloud (`lib/tell-apart.ts`), so the
 * screen and the voice never describe the same person two different ways.
 *
 * ⚠ When nothing tells them apart, it SAYS so and names the fix, rather than
 * showing a clue that is technically unique and useless.
 */
function SameName({
  name,
  count,
  clue,
}: NonNullable<ContactSummary['sameName']> & { name: string }) {
  const phrase = clue
    ? phraseClue(clue, {
        channelLabel: (type) => CHANNEL_META[type as keyof typeof CHANNEL_META]?.label ?? type,
        day: (iso) => `on ${formatDay(iso)}`,
      })
    : null;

  return (
    // ⚠ The count stays at LABEL's muted colour, not `text-faint`: it carries
    // information, and at 10px faint text measured unreadable in dark mode.
    <span className={cn(LABEL, 'mt-1 block truncate normal-case')}>
      1 of {count} named {name}
      <span aria-hidden className="text-faint">
        {' · '}
      </span>
      {phrase ? (
        <span className="text-foreground/80">{phrase}</span>
      ) : (
        <span>nothing tells these apart yet — add a note</span>
      )}
    </span>
  );
}

/**
 * ⚠ Two empty states, and they must never converge.
 *
 * A contact row is created the moment a message resolves an identity, so "no
 * contacts" with a channel connected means *no mail has arrived*, and without
 * one it means *nothing is plugged in*. A screen that reads the same either way
 * cost this project a full debugging session on the timeline; this is the same
 * rule, applied before it costs anything.
 */
export function ContactsEmpty({ connected }: { connected: boolean }) {
  return (
    <div className="border-t border-border py-12 text-center">
      <Users className="mx-auto size-5 text-faint" aria-hidden />
      <p className="mt-3 text-row font-medium">
        {connected ? 'No contacts yet' : 'No channels connected'}
      </p>
      <p className="mx-auto mt-1 max-w-[46ch] text-note text-muted-foreground">
        {connected
          ? 'A contact appears here as soon as a message arrives from someone. Nothing has arrived yet.'
          : 'Connect a channel and the people who write to you appear here automatically.'}
      </p>
      {!connected && (
        <Link
          href="/channels"
          className={cn(LABEL, 'focus-ring mt-3 inline-block rounded underline underline-offset-2')}
        >
          Connect a channel
        </Link>
      )}
    </div>
  );
}

export function ContactsSkeleton() {
  return (
    <div className="border-t border-border" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border py-3">
          <div className="size-7 rounded-md bg-faint" />
          <div className="flex-1">
            <div className="h-3 w-40 rounded bg-faint" />
            <div className="mt-1.5 h-2.5 w-56 rounded bg-faint" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** PH is UTC+8 with no DST, so a fixed zone is correct rather than a shortcut. */
function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

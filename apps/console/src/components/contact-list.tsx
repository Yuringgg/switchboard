import { Users } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

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

      {/*
        Cards, in the attention board's style (2026-10-04, Yuri's request): a
        ring and a soft shadow, a lift on hover, an entrance down the list.
        `.board-card` in globals.css is shared by both screens.

        Two across from a tablet up, so a long address book scans in half the
        height; one on a phone.
      */}
      <ul className="grid gap-2.5 md:grid-cols-2">
        {contacts.map((contact, index) => (
          <li
            key={contact.id}
            style={{ '--i': index } as CSSProperties}
            className="board-card card-enter min-w-0 rounded-xl bg-panel"
          >
            <Link
              href={`/contacts/${contact.id}`}
              // ⚠ The detail page renders private message bodies and the reader
              // has not asked for them yet. Same rule as the assistant's
              // citation chips (ADR-018).
              prefetch={false}
              className="focus-ring flex h-full items-start gap-3 rounded-xl p-3.5"
            >
              {/*
                Monochrome: this console spends colour on which channel and
                whether the board is live, and a hue per contact would make all
                three read as decoration. Round, like the board's avatars, now
                that the channels sit in tags below rather than as bare dots
                beside it.
              */}
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-label font-bold text-muted-foreground"
              >
                {initials(contact.displayName, contact.identities[0]?.externalId ?? null)}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-row font-semibold">
                    {contact.displayName}
                  </span>
                  <span className="shrink-0 font-mono text-label text-muted-foreground tabular-nums">
                    {contact.messageCount} msg{contact.messageCount === 1 ? '' : 's'}
                    {contact.lastMessageAt && ` · ${formatDay(contact.lastMessageAt)}`}
                  </span>
                </span>

                {contact.sameName && <SameName name={contact.displayName} {...contact.sameName} />}

                {/*
                  ⚠ One tag per handle — the plural is the feature (see above).
                  The channel is NAMED, never carried by the dot alone: Gmail red
                  against WhatsApp green is the red/green confusion pair. WCAG
                  1.4.1.
                */}
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {contact.identities.map((identity) => {
                    const meta =
                      CHANNEL_META[identity.channelType as keyof typeof CHANNEL_META];
                    return (
                      <span
                        key={identity.id}
                        className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-label text-muted-foreground"
                      >
                        <span
                          className={cn('size-1.5 shrink-0 rounded-full', meta?.dotClass ?? 'bg-faint')}
                          aria-hidden
                        />
                        <span className="shrink-0 font-medium text-foreground/80">
                          {meta?.label ?? identity.channelType}
                        </span>
                        <span className="min-w-0 truncate font-mono">{identity.externalId}</span>
                      </span>
                    );
                  })}
                </span>
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
    // ⚠ And it WRAPS. In a card two-across, a truncated line cut the clue to
    // "Operatio…" — and the clue is the only thing on the card that tells this
    // Maria from the other three.
    <span className={cn(LABEL, 'mt-1 block normal-case text-pretty')}>
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

/** The same cards, two across, so the list lands where its outline was. */
export function ContactsSkeleton() {
  return (
    <div aria-hidden>
      <span className="mb-3 block h-2.5 w-20 rounded bg-faint/50" />
      <div className="grid animate-pulse gap-2.5 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-xl bg-panel p-3.5 shadow-[0_0_0_1px_var(--border)]"
          >
            <div className="size-8 shrink-0 rounded-full bg-faint/60" />
            <div className="min-w-0 flex-1">
              <div className="flex gap-2">
                <div className="h-3.5 w-32 rounded bg-faint/60" />
                <div className="ml-auto h-2.5 w-16 rounded bg-faint/40" />
              </div>
              <div className="mt-3 h-5 w-48 rounded-md bg-faint/40" />
            </div>
          </div>
        ))}
      </div>
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

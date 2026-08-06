import type { Metadata } from 'next';
import Link from 'next/link';

import { Brand } from '@/components/brand';
import { PatchField } from '@/components/marketing/patch-field';
import { ThemeToggle } from '@/components/theme-toggle';
import { createClient } from '@/lib/supabase/server';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Switchboard — Gmail and WhatsApp on one board',
  description:
    'Switchboard patches Gmail and WhatsApp into a single ordered timeline, reads ' +
    'every message as it arrives, and shows you which ones want something from you.',
};

/**
 * The landing page.
 *
 * ── Why this route exists ────────────────────────────────────────────────────
 *
 * Ms. Maria asked for it on 2026-08-05: *"for landing page, you can be as
 * creative as you want"*. Until now the first screen a stranger saw was a login
 * form for an account they did not have, which answers none of the questions
 * somebody arriving at a URL actually has. `proxy.ts` now sends an
 * unauthenticated request for `/` here rather than to `/login`.
 *
 * ── ⚠ This is the one `brand` surface in the app ─────────────────────────────
 *
 * Everywhere else, design serves a task and the rules are the product register's
 * — fixed type scale, familiar affordances, motion that conveys state and
 * nothing else. Here design IS the product: this page has one job, which is to
 * make somebody understand what a switchboard is for before they scroll. So it
 * is allowed the fluid `--text-hero` step, a long scroll with one idea per
 * fold, and an animated figure. `PRODUCT.md` records that split; do not carry
 * these liberties back into the console.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────────
 *
 * No scroll-triggered reveals, no counters, no client JavaScript beyond the
 * theme toggle that was already there. Everything is rendered and legible on
 * first paint. The one moving thing is the patch field, and it is a diagram.
 *
 * ⚠ This page scrolls the document, unlike every other screen in the product.
 * The console's "the frame does not scroll, the record does" rule is a fact
 * about `AppShell`, which this route deliberately does not use — a marketing
 * page inside a fixed-height instrument frame would trap its own content.
 */
export default async function WelcomePage() {
  /*
   * Read once, only to point the button at the right place. A person who is
   * already signed in and lands here should be offered the console, not a login
   * form — and this is the same `getUser()` every other route makes, so it
   * costs nothing new.
   */
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#what-it-does"
        className="focus-ring sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to what it does
      </a>

      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-5 md:px-10">
          <Brand size="lg" />
          <div className="ml-auto flex items-center gap-2.5">
            <ThemeToggle size="md" />
            <Link
              href={user ? '/' : '/login'}
              className={buttonClass({ variant: 'subtle' })}
            >
              {user ? 'Open the console' : 'Sign in'}
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/*
          ── Hero ─────────────────────────────────────────────────────────────

          ⚠ The figure lives INSIDE the hero, not in a band below it.

          It was its own full-bleed section at first, which looked tidier in the
          markup and was wrong on a laptop: measured on Yuri's screen, the
          diagram did not start until y≈930 in a 1010px viewport, so the first
          thing anybody saw was a wall of type with the one moving thing hidden
          below the fold. The whole reason this page has an animation is that it
          explains the product faster than the paragraph does — it has to be on
          the first screen or it may as well not exist.

          Everything above it is therefore on a tighter rhythm than a marketing
          hero would normally take, and the figure is capped at `max-w-4xl` so
          its 2.24:1 box stays under ~400px tall.
        */}
        <section className="mx-auto max-w-6xl px-5 pt-10 pb-6 md:px-10 md:pt-14">
          {/*
            Colour in the fold, and the product's own vocabulary. The page was
            monochrome type down to the figure, which is what "looks dull" was
            describing — and these two dots are the one distinction the whole
            console exists to draw, so they belong in the first sentence.
          */}
          <p className={cn(LABEL, 'flex flex-wrap items-center gap-x-2.5 gap-y-1')}>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-channel-gmail" aria-hidden />
              Gmail
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-channel-whatsapp" aria-hidden />
              WhatsApp
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <span className="animate-lamp size-1.5 rounded-full bg-live" aria-hidden />
              One board
            </span>
          </p>

          {/*
            ⚠ The measure is on the H1 ITSELF, not on a wrapper.
            `ch` resolves against the element's own font, so `max-w-[16ch]` on a
            surrounding div is 16 characters of 16px BODY text — about 140px —
            and it strangled the hero into three lines inside 174px of a 375px
            phone. Measured, not spotted: it looks entirely reasonable in the
            markup, and on a desktop the container is wide enough that nothing
            is visibly wrong.
          */}
          <h1 className="mt-5 max-w-[16ch] text-hero font-semibold text-balance">
            Stop checking two apps.
          </h1>

          <p className="mt-5 max-w-[58ch] text-lg leading-relaxed text-muted-foreground text-pretty">
            Switchboard patches Gmail and WhatsApp into a single ordered
            timeline, reads every message as it lands, and tells you which ones
            want something from you.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href={user ? '/' : '/signup'} className={buttonClass()}>
              {user ? 'Open the console' : 'Create an account'}
            </Link>
            <Link
              href="#what-it-does"
              className={buttonClass({ variant: 'subtle' })}
            >
              See what it does
            </Link>
          </div>

          <PatchField className="mt-10 max-w-4xl md:mt-12" />

          <p className={cn(LABEL, 'mt-6 max-w-[70ch] normal-case')}>
            Two lines in, one jack field, one record out — and every row still
            carries the line it arrived on.
          </p>
        </section>

        {/* ── The problem, in one paragraph ────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 py-20 md:px-10 md:py-28">
          <p className="max-w-[38ch] text-3xl leading-snug font-medium text-balance md:text-4xl">
            A client answers on WhatsApp. Their team replies by email.
          </p>
          <p className="mt-6 max-w-[58ch] text-lg leading-relaxed text-muted-foreground text-pretty">
            Two apps, two orderings, and the one thing you actually need —{' '}
            <span className="text-foreground">
              what happened, in the order it happened
            </span>{' '}
            — exists in neither of them. You end up reconstructing it in your
            head, every morning, from two scroll positions.
          </p>
        </section>

        {/* ── What it does ─────────────────────────────────────────────────── */}
        <section
          id="what-it-does"
          className="scroll-mt-8 border-t border-border"
        >
          <div className="mx-auto max-w-6xl px-5 md:px-10">
            <h2 className="pt-16 text-3xl font-semibold text-balance md:pt-24 md:text-4xl">
              Four things, and it does them on its own
            </h2>

            {/*
              A spec sheet, not a card grid. Identical icon-heading-paragraph
              cards repeated four times is the shape every generated landing
              page arrives in; hairline-separated rows are what a piece of
              equipment's documentation actually looks like, and they let each
              entry be as long as it needs to be.
            */}
            <dl className="mt-12 md:mt-16">
              {CAPABILITIES.map((item, index) => (
                <div
                  key={item.title}
                  className={cn(
                    'grid gap-x-10 gap-y-3 border-t border-border py-8 md:grid-cols-[14rem_1fr] md:py-10',
                    index === CAPABILITIES.length - 1 && 'border-b',
                  )}
                >
                  <dt className="text-xl font-medium text-balance md:text-2xl">
                    {item.title}
                  </dt>
                  <dd className="max-w-[64ch] leading-relaxed text-muted-foreground text-pretty">
                    {item.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── The board ────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 py-20 md:px-10 md:py-28">
          <h2 className="max-w-[24ch] text-3xl font-semibold text-balance md:text-4xl">
            What wants an answer, as work rather than as a list
          </h2>
          <p className="mt-5 max-w-[60ch] leading-relaxed text-muted-foreground text-pretty">
            Every card is something a model found in a real message, and every
            card shows the sentence it found it in. Move it across as you deal
            with it.
          </p>

          <BoardFigure />
        </section>

        {/* ── How a message gets here ──────────────────────────────────────── */}
        <section className="border-t border-border bg-panel/60">
          <div className="mx-auto max-w-6xl px-5 py-20 md:px-10 md:py-28">
            <h2 className="max-w-[22ch] text-3xl font-semibold text-balance md:text-4xl">
              How a message gets from an app to this screen
            </h2>

            {/*
              ⚠ These are numbered because they are genuinely a sequence — each
              step consumes the previous one's output and the order is the
              information. Numbering sections that are not a sequence is the
              scaffolding habit this project's design notes call out; this one
              earns it.
            */}
            <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:mt-16 md:grid-cols-2 lg:grid-cols-4">
              {PIPELINE.map((step, index) => (
                <li key={step.title} className="bg-background p-6 md:p-7">
                  <p className={cn(LABEL, 'text-foreground')}>
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <h3 className="mt-4 font-medium">{step.title}</h3>
                  <p className="mt-2 text-note leading-relaxed text-muted-foreground text-pretty">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/*
          ⚠ "Four things it will not do" stood here and was CUT on Yuri's
          instruction, 2026-08-06.

          Recorded rather than silently deleted, because it was a deliberate
          piece of the argument and not filler: a page that states its own
          limits — never sends, never books a calendar unasked, never answers
          without a citation, never crosses tenants — is making the product's
          real case, and those four guarantees are the ones a mentor reading
          this for a defence would ask about.

          The guarantees themselves are untouched. They are still enforced in
          code, still recorded in `PRODUCT.md`, and still stated in the console
          beside the features they constrain. Only the marketing section is
          gone. Do not re-add it without asking, and do not read its absence as
          the constraints having been relaxed.
        */}

        {/* ── The one call to action ───────────────────────────────────────── */}
        <section className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-5 py-20 md:flex-row md:items-center md:px-10 md:py-24">
            <div>
              <h2 className="max-w-[18ch] text-3xl font-semibold text-balance md:text-4xl">
                Connect one channel and watch it fill up.
              </h2>
              <p className="mt-4 max-w-[52ch] leading-relaxed text-muted-foreground text-pretty">
                Gmail takes one click and a Google consent screen. Nothing is
                read until you grant it, and nothing is sent, ever.
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-3 md:ml-auto">
              <Link href={user ? '/' : '/signup'} className={buttonClass()}>
                {user ? 'Open the console' : 'Create an account'}
              </Link>
              {!user && (
                <Link
                  href="/login"
                  className={buttonClass({ variant: 'subtle' })}
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-8 md:px-10">
          <Brand />
          <p className={cn(LABEL, 'normal-case')}>
            An OJT project at iOzera. Built by Yuri, mentored by Ms. Maria.
          </p>
        </div>
      </footer>
    </div>
  );
}

const CAPABILITIES = [
  {
    title: 'One ordered timeline',
    body:
      'Every message from every connected channel, newest first, each one still ' +
      'marked with the line it came in on — named in words as well as coloured, ' +
      'because the two channel colours are red and green and that is the one ' +
      'question this thing exists to answer. New mail appears on its own. ' +
      'Nothing needs a refresh.',
  },
  {
    title: 'A summary on anything long',
    body:
      'Written the moment the message lands, shown above the sender’s own words ' +
      'and never in place of them, and labelled with the model that wrote it. ' +
      'Short messages are deliberately left alone — paraphrasing a one-line chat ' +
      'message is no shorter and less true.',
  },
  {
    title: 'A board of what wants an answer',
    body:
      'Meetings, commitments, requests and open questions are pulled out of the ' +
      'text as they arrive and set out as work: not started, in progress, done. ' +
      'Every card quotes the exact sentence it came from, so a claim you did not ' +
      'make is one you can immediately catch.',
  },
  {
    title: 'An assistant that will refuse',
    body:
      'Ask it anything about the corpus and it answers with citations you can ' +
      'open, or it tells you it cannot. An answer that cites nothing is shown as ' +
      'a refusal on purpose — a confident paragraph with no source behind it is ' +
      'worse than no answer at all.',
  },
];

const PIPELINE = [
  {
    title: 'It arrives',
    body:
      'Google pushes a notification within seconds of a mail landing, and Meta ' +
      'posts a webhook for WhatsApp. Nothing sits in a loop polling a mailbox.',
  },
  {
    title: 'It is normalised',
    body:
      'Gmail and WhatsApp are structurally different. Both become one canonical ' +
      'message — same fields, same shape — before anything stores or reads them.',
  },
  {
    title: 'It is read',
    body:
      'Summarised, embedded so it can be searched by meaning, and scanned for ' +
      'meetings and commitments. Any of the three can fail without losing the ' +
      'message itself.',
  },
  {
    title: 'It is on screen',
    body:
      'The new row is pushed to the console over a live connection scoped, by ' +
      'the database itself, to the one account allowed to see it.',
  },
];

/**
 * A small, honest picture of the attention board.
 *
 * ⚠ Built out of the console's real tokens and the real column names rather
 * than a screenshot: a screenshot of a live console would put a real person's
 * mail on a public page, which `docs/02-ARCHITECTURE.md` §6 does not allow
 * anywhere. The cards below are invented and read as invented.
 *
 * `aria-hidden`, because the section's own heading and paragraph already say
 * everything this conveys, and a screen reader walking three columns of
 * fictional card titles learns nothing from them.
 */
function BoardFigure() {
  return (
    <div
      aria-hidden
      className="mt-12 grid gap-4 md:mt-16 md:grid-cols-3"
    >
      {BOARD.map((column) => (
        <div
          key={column.name}
          className="rounded-xl border border-border bg-panel/60 p-4"
        >
          <p className={cn(LABEL, 'flex items-center gap-2')}>
            {column.name}
            <span className="font-mono text-meta">
              {String(column.cards.length).padStart(2, '0')}
            </span>
          </p>

          <div className="mt-3 space-y-2.5">
            {column.cards.map((card) => (
              <div
                key={card.title}
                className="rounded-lg border border-border bg-background p-3"
              >
                <p className={cn(LABEL, 'flex items-center gap-1.5')}>
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      card.channel === 'gmail'
                        ? 'bg-channel-gmail'
                        : 'bg-channel-whatsapp',
                    )}
                  />
                  {card.kind}
                </p>
                <p className="mt-1.5 text-row font-medium text-pretty">
                  {card.title}
                </p>
                <p className="mt-1.5 border-l-2 border-border pl-2.5 text-note text-muted-foreground text-pretty">
                  {card.quote}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const BOARD = [
  {
    name: 'Not started',
    cards: [
      {
        kind: 'Meeting',
        channel: 'gmail' as const,
        title: 'Project sync, Friday 3:00 pm',
        quote: '“Let’s do the sync on Friday at 3pm if that still works.”',
      },
      {
        kind: 'Question',
        channel: 'whatsapp' as const,
        title: 'Which invoice covers August?',
        quote: '“Yung invoice ba for August is the same one you sent last week?”',
      },
    ],
  },
  {
    name: 'In progress',
    cards: [
      {
        kind: 'Commitment',
        channel: 'gmail' as const,
        title: 'Send the revised quotation',
        quote: '“I’ll have the revised quotation over to you by Thursday.”',
      },
    ],
  },
  {
    name: 'Done',
    cards: [
      {
        kind: 'Action',
        channel: 'whatsapp' as const,
        title: 'Confirm the venue booking',
        quote: '“Pa-confirm na lang ng venue booking before Friday, thank you!”',
      },
    ],
  },
];

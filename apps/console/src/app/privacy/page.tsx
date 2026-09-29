import type { Metadata } from 'next';
import Link from 'next/link';

import { Brand } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { buttonClass, LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Privacy · Switchboard',
  description: 'What Switchboard reads, what it keeps, who else sees it, and how to have it deleted.',
};

/**
 * The privacy policy.
 *
 * ── Why it exists ────────────────────────────────────────────────────────────
 *
 * Google will not let the OAuth consent screen leave Testing without a privacy
 * policy link on the Branding page (seen 2026-09-28: "To publish your app, you
 * must complete your configuration on the Branding page"). Publishing is what
 * lets people connect Gmail without being added to a list by hand —
 * `docs/03-RESOURCES.md` §2.
 *
 * ── ⚠ Every sentence here is a claim about the running system ───────────────
 *
 * It was written from the code and the architecture doc, not from a template,
 * and it has to stay true. Add a processor (a new AI provider, a new channel),
 * start storing attachment files, or build a delete button, and this page
 * changes in the same commit. A privacy policy that describes a system that no
 * longer exists is worse than none.
 *
 * Public (`PUBLIC_PATHS` in `proxy.ts`), static, and reads no tenant data.
 */
export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-5 py-5 md:px-10">
          <Link href="/welcome" className="focus-ring rounded">
            <Brand size="lg" />
          </Link>
          <div className="ml-auto flex items-center gap-2.5">
            <ThemeToggle size="md" />
            <Link href="/login" className={buttonClass({ variant: 'subtle' })}>
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[68ch] px-5 py-12 md:py-16">
        <p className={LABEL}>Effective 29 September 2026</p>
        <h1 className="mt-2 text-heading font-semibold text-balance">Privacy policy</h1>
        <p className="mt-4 text-row text-muted-foreground">
          Switchboard is an on-the-job-training project at iOzera, built by Yuri. It brings
          your Gmail, WhatsApp and recorded meetings into one private timeline. It is not a
          commercial product. This page says, plainly, what it does with your data.
        </p>

        <Section title="What Switchboard reads">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Gmail</strong>, with read-only access (<code>gmail.readonly</code>). It
              reads the messages in your mailbox: sender, subject, date and text, and saves the
              files attached to them so they can be filed for you. Small images (logos,
              signatures), calendar invites and files over 25 MB are left out.
            </li>
            <li>
              <strong>Google Calendar</strong> (<code>calendar.events</code>). It creates an event{' '}
              <strong>only when you press the button to confirm one</strong>. It never edits or
              deletes an event, and it never writes on its own.
            </li>
            <li>
              <strong>WhatsApp</strong> messages sent to a business number you connect.
            </li>
            <li>
              <strong>Meetings</strong>, only when you send a notetaker into one yourself and
              confirm that everyone in it has agreed to be recorded.
            </li>
          </ul>
        </Section>

        <Section title="What it keeps, and where">
          <p>
            The messages above, their AI summaries, the meetings, tasks and details it picks out of
            them, and notes you write on contacts. They are stored in a Postgres database hosted
            by Supabase in Singapore. Each account can only ever read its own rows; the database
            enforces that for every table.
          </p>
          <p>
            Saved attachments are stored in a private Microsoft Azure storage account in Malaysia.
            Nothing in it is public: opening a file checks that it is yours and gives your browser
            a link that works for five minutes.
          </p>
          <p>
            Your Google access tokens are encrypted (AES-256-GCM) before they are stored. Your
            Google password is never seen or stored.
          </p>
          <p>
            Everything is kept until you ask for it to be deleted (below).
          </p>
        </Section>

        <Section title="Who else sees it">
          <p>To do its job, Switchboard sends some of your data to these services:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Groq</strong> runs the AI models. Message text is sent to it to write
              summaries, pick out meetings and tasks, and answer your questions about your
              messages. (A backup setting can send questions to Google Gemini instead; it is not
              the one in use.)
            </li>
            <li>
              <strong>Vapi</strong> runs the voice assistant. When you call it, your voice and the
              messages it reads out to you pass through Vapi and the speech services it uses.
            </li>
            <li>
              <strong>Recall.ai</strong> records and transcribes a meeting, only when you send a
              notetaker into it.
            </li>
            <li>
              <strong>Supabase</strong>, <strong>Vercel</strong> and <strong>Microsoft Azure</strong>{' '}
              host the database, the website, the background worker and your saved files. The
              search index is computed on that worker, not by an outside service.
            </li>
          </ul>
          <p>
            Switchboard does not sell your data, does not use it for advertising, and does not use
            it to train any AI model. The developer has administrator access to the database to run
            and repair the service, and does not read your messages for any other purpose.
          </p>
        </Section>

        <Section title="Google user data">
          <p>
            Switchboard&rsquo;s use and transfer of information received from Google APIs adheres
            to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="underline underline-offset-2"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. Gmail data is used only to show you your own
            messages and the features built on them.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            There is no delete button yet. Email{' '}
            <a href="mailto:leiruychua@gmail.com" className="underline underline-offset-2">
              leiruychua@gmail.com
            </a>{' '}
            from the address you signed up with, and your account, your connected channels and
            every message, file, summary and note stored for you will be deleted. You can also remove
            Switchboard&rsquo;s access to Google at any time from{' '}
            <a
              href="https://myaccount.google.com/permissions"
              className="underline underline-offset-2"
            >
              your Google Account
            </a>
            ; it then stops receiving new mail.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            Under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173) you may ask what
            data is held about you, have it corrected, or have it deleted. Write to the address
            above.
          </p>
        </Section>

        <p className={cn(LABEL, 'mt-12 normal-case')}>
          If this policy changes, the date at the top changes with it.
        </p>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-row font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-row text-muted-foreground [&_code]:text-[0.8em] [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

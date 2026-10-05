import { CheckCheck, Paperclip, Pause, Play, Video } from 'lucide-react';
import type { CSSProperties } from 'react';

import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * Columns of mail, chats and meeting lines drifting past — what a normal day
 * sends you from three apps that never talk to each other.
 *
 * Yuri's request, 2026-10-06: a 21st.dev vertical testimonial marquee, merged
 * with this product — "floating emails, meeting transcripts, WhatsApp
 * messages". The marquee mechanics are the snippet's (alternate columns up and
 * down, faded ends); the cards are this console's own, and the coloured tag
 * under some of them is the point: it is what Switchboard pulled onto the
 * board from that message.
 *
 * Used once, on `/welcome` under the problem paragraph. Yuri chose that spot
 * from four rendered candidates; beside the hero headline (straight or tilted)
 * and behind the sign-in panel were the three not taken.
 *
 * ── ⚠ Every message is invented, and reads as invented ───────────────────────
 *
 * Same rule as the landing page's board figure: a screenshot of a live console
 * would put a real person's mail on a public page, which
 * `docs/02-ARCHITECTURE.md` §6 does not allow anywhere. Names, companies and
 * numbers below are made up; phone numbers are masked the way a real one
 * would be.
 *
 * ── ⚠ No JavaScript, and nothing starts invisible ────────────────────────────
 *
 * The snippet faded its cards in from opacity 0 with `whileInView`. In a
 * headless render, a background tab or this project's browser pane that never
 * fires, and the section ships empty. Here the motion is CSS (`.marquee*` in
 * globals.css) moving cards that are already drawn. The pause control is a
 * checkbox read by `:has()`, so it needs no script either.
 *
 * `aria-hidden` on the columns: the cards are duplicated for the loop and are
 * wallpaper to a screen reader. Whatever surrounds this says what it shows.
 */

type Kind = 'meeting' | 'commitment' | 'action' | 'question';

type Email = {
  channel: 'gmail';
  from: string;
  org: string;
  subject: string;
  body: string;
  time: string;
  summary?: string;
  file?: string;
  pulled?: Kind;
};

type Chat = {
  channel: 'whatsapp';
  from: string;
  phone: string;
  body: string;
  time: string;
  pulled?: Kind;
};

type Meeting = {
  channel: 'meeting';
  title: string;
  lines: [stamp: string, speaker: string, said: string][];
  time: string;
  pulled?: Kind;
};

type Message = Email | Chat | Meeting;

const MESSAGES: Message[] = [
  {
    channel: 'gmail',
    from: 'Bea Santos',
    org: 'Halcyon Interiors',
    subject: 'Revised quotation — 3F fit-out',
    body: 'I’ll have the revised quotation over to you by Thursday, with the lighting moved to phase two.',
    time: '9:42',
    pulled: 'commitment',
  },
  {
    channel: 'whatsapp',
    from: 'Marco Reyes',
    phone: '+63 917 ••• 4821',
    body: 'Pa-confirm na lang ng venue booking before Friday, thank you!',
    time: '10:05',
    pulled: 'action',
  },
  {
    channel: 'meeting',
    title: 'Weekly sync · Northwind Logistics',
    lines: [
      ['12:04', 'Ana', 'Let’s move the launch to the 18th.'],
      ['12:19', 'Paolo', 'Okay, I’ll update the deck tonight.'],
    ],
    time: '14:00',
    pulled: 'commitment',
  },
  {
    channel: 'gmail',
    from: 'Accounts',
    org: 'Tala Foods',
    subject: 'Invoice INV-2207 for August',
    body: 'Attached is the August invoice. Kindly settle within 15 days of receipt.',
    time: '11:18',
    file: 'INV-2207.pdf',
  },
  {
    channel: 'whatsapp',
    from: 'Jill Cruz',
    phone: '+63 918 ••• 0367',
    body: 'Yung invoice ba for August is the same one you sent last week?',
    time: '11:31',
    pulled: 'question',
  },
  {
    channel: 'meeting',
    title: 'Kickoff · Bayani Studio',
    lines: [
      ['03:41', 'Rhea', 'Can we get the brand guide before the next call?'],
      ['03:55', 'You', 'Yes, I’ll send it on Monday.'],
    ],
    time: '15:30',
    pulled: 'commitment',
  },
  {
    channel: 'gmail',
    from: 'Carlo Mendoza',
    org: 'Tala Foods',
    subject: 'Project sync',
    body: 'Let’s do the sync on Friday at 3pm if that still works for your team.',
    time: '13:02',
    pulled: 'meeting',
  },
  {
    channel: 'whatsapp',
    from: 'Ate Lorna · Site',
    phone: '+63 927 ••• 5512',
    body: 'Dumating na yung tiles pero kulang ng 2 boxes. Pa-follow up sa supplier?',
    time: '13:47',
    pulled: 'action',
  },
  {
    channel: 'gmail',
    from: 'Rates desk',
    org: 'Northwind Logistics',
    subject: 'Q4 shipping rate advisory',
    body: 'Dear valued partner, in light of continued fuel surcharges and port congestion across…',
    summary: 'Rates rise 8% from 1 Nov. Book before 25 Oct to keep the old rate.',
    time: '8:15',
  },
  {
    channel: 'whatsapp',
    from: 'Paolo Lim',
    phone: '+63 905 ••• 2290',
    body: 'Sige, call tayo after lunch. 1:30 ok?',
    time: '12:10',
    pulled: 'meeting',
  },
  {
    channel: 'meeting',
    title: 'Client review · Halcyon Interiors',
    lines: [
      ['21:10', 'Bea', 'We’re fine with the layout, just not the budget.'],
      ['21:26', 'You', 'I’ll send two cheaper options by Wednesday.'],
    ],
    time: '16:00',
    pulled: 'commitment',
  },
  {
    channel: 'whatsapp',
    from: 'Mika Tan',
    phone: '+63 916 ••• 7731',
    body: 'Thank you po! Received na namin yung samples.',
    time: '16:42',
  },
];

const CHANNEL = {
  gmail: { label: 'Gmail', dot: 'bg-channel-gmail' },
  whatsapp: { label: 'WhatsApp', dot: 'bg-channel-whatsapp' },
  meeting: { label: 'Meeting', dot: 'bg-channel-meeting' },
} as const;

/** The board's own kind colours (`KIND_TAG` in attention-board.tsx). */
const KIND = {
  meeting: { label: 'Meeting', tone: 'bg-violet-500/12 text-violet-700 dark:text-violet-300' },
  commitment: { label: 'Commitment', tone: 'bg-amber-500/14 text-amber-700 dark:text-amber-300' },
  action: { label: 'Action', tone: 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-300' },
  question: { label: 'Question', tone: 'bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300' },
} as const;

/** Seconds for one full loop, per column, so neighbours drift out of step. */
const DURATIONS = [46, 58, 50, 62, 54];

export function MessageMarquee({
  columns = 3,
  pausable = false,
  className,
}: {
  /** How many columns at the widest. Below `md` at most two show, below `lg` three. */
  columns?: number;
  /** Show the pause control (WCAG 2.2.2: motion longer than 5s can be stopped). */
  pausable?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('marquee-wrap relative', className)}>
      <div aria-hidden className="marquee flex h-full gap-3 overflow-hidden">
        {Array.from({ length: columns }, (_, column) => (
          <div
            key={column}
            className={cn(
              'marquee__column min-w-0 flex-1',
              column >= 2 && 'hidden md:block',
              column >= 3 && 'md:hidden lg:block',
            )}
          >
            <div
              className="marquee__track"
              data-direction={column % 2 ? 'down' : 'up'}
              style={{ '--marquee-duration': `${DURATIONS[column % DURATIONS.length]}s` } as CSSProperties}
            >
              {/* Twice, for the seamless loop — see `.marquee__track`. */}
              {[0, 1].map((copy) => (
                <div key={copy} className="flex flex-col gap-3 pb-3">
                  {rotate(MESSAGES, column * 5).map((message, index) => (
                    <MessageCard key={index} message={message} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {pausable && (
        <label
          title="Pause the moving messages"
          className={cn(
            'focus-ring absolute right-2 bottom-2 z-10 grid size-8 cursor-pointer place-items-center rounded-full border border-border bg-background/80 text-muted-foreground backdrop-blur hover:text-foreground has-focus-visible:ring-[3px] has-focus-visible:ring-ring/45',
          )}
        >
          <input type="checkbox" className="marquee__pause peer sr-only" />
          <Pause className="size-3.5 peer-checked:hidden" aria-hidden />
          <Play className="hidden size-3.5 peer-checked:block" aria-hidden />
          <span className="sr-only">Pause the moving messages</span>
        </label>
      )}
    </div>
  );
}

/** A different starting card per column, so no two columns line up. */
function rotate<T>(items: T[], by: number): T[] {
  const shift = by % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

function MessageCard({ message }: { message: Message }) {
  const channel = CHANNEL[message.channel];

  return (
    <div className="board-card rounded-xl bg-panel p-3.5">
      <p className={cn(LABEL, 'flex items-center gap-1.5')}>
        <span className={cn('size-1.5 rounded-full', channel.dot)} />
        {channel.label}
        {message.channel === 'meeting' && <Video className="size-3" />}
        <span className="ml-auto font-mono tabular-nums">{message.time}</span>
      </p>

      {message.channel === 'gmail' && <EmailBody message={message} />}
      {message.channel === 'whatsapp' && <ChatBody message={message} />}
      {message.channel === 'meeting' && <MeetingBody message={message} />}

      {message.pulled && (
        <p className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className={cn(LABEL, 'whitespace-nowrap normal-case tracking-normal')}>
            On the board
          </span>
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 text-label font-semibold tracking-wide uppercase',
              KIND[message.pulled].tone,
            )}
          >
            {KIND[message.pulled].label}
          </span>
        </p>
      )}
    </div>
  );
}

function EmailBody({ message }: { message: Email }) {
  return (
    <>
      <p className="mt-2 text-row leading-snug">
        <span className="font-semibold">{message.from}</span>
        <span className="text-muted-foreground"> · {message.org}</span>
      </p>
      <p className="mt-0.5 text-note font-medium text-pretty">{message.subject}</p>

      {message.summary && (
        <p className="mt-2 rounded-lg bg-accent px-2.5 py-2 text-note text-pretty">
          <span className={cn(LABEL, 'mb-0.5 block')}>Summary</span>
          {message.summary}
        </p>
      )}

      <p className="mt-1.5 line-clamp-3 text-note text-muted-foreground text-pretty">
        {message.body}
      </p>

      {message.file && (
        <p className="mt-2 flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-meta text-muted-foreground">
          <Paperclip className="size-3 shrink-0" />
          <span className="min-w-0 truncate font-mono">{message.file}</span>
          <span className="ml-auto shrink-0">In Files</span>
        </p>
      )}
    </>
  );
}

function ChatBody({ message }: { message: Chat }) {
  return (
    <>
      <p className="mt-2 text-row leading-snug font-semibold">{message.from}</p>
      <p className="truncate font-mono text-meta text-muted-foreground">{message.phone}</p>
      <p className="mt-1.5 rounded-2xl rounded-tl-sm bg-channel-whatsapp/12 px-3 py-2 text-note text-pretty">
        {message.body}
        <span className="mt-0.5 flex items-center justify-end gap-1 font-mono text-meta text-muted-foreground">
          {message.time}
          <CheckCheck className="size-3.5 text-channel-whatsapp" />
        </span>
      </p>
    </>
  );
}

function MeetingBody({ message }: { message: Meeting }) {
  return (
    <>
      <p className="mt-2 text-row leading-snug font-semibold text-pretty">{message.title}</p>
      <p className="text-meta text-muted-foreground">Transcript</p>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1.5 border-l-2 border-channel-meeting/40 pl-2.5">
        {message.lines.map(([stamp, speaker, said]) => (
          <div key={stamp} className="contents">
            <dt className="font-mono text-meta text-muted-foreground tabular-nums">{stamp}</dt>
            <dd className="text-note text-pretty">
              <span className="font-semibold">{speaker}</span>{' '}
              <span className="text-muted-foreground">{said}</span>
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

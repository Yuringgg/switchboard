# apps/console

Next.js 16 (App Router) + Tailwind + shadcn/ui → **Vercel**.

Two things live here, and the boundary between them matters:

- **The console** — timeline, search, contacts, assistant. Talks to Supabase with
  the **anon key + user session**, so RLS applies and a user can only ever reach
  their own rows.
- **Ingest webhooks** — `app/api/webhooks/`. Serverless, per ADR-011, because a
  cold-starting container drops webhooks and providers eventually disable an
  endpoint that keeps timing out.

**Ingest does three things: verify the signature, insert a `raw_events` row,
return 200.** No parsing, no enrichment, no API calls. The temptation to "just do
a little normalization here" is exactly what the ingest/worker split exists to
prevent.

## Deploying to Vercel

Not yet done — it needs the dashboard. The Vercel MCP can read projects and
deployments but cannot create a git-connected project or set environment
variables, and there is no CLI login on this machine.

1. **Import** `Yuringgg/switchboard` at vercel.com/new.
2. Set **Root Directory** to `apps/console`. This is a pnpm workspace monorepo;
   without it Vercel builds the repository root and finds no Next.js app.
3. Add environment variables **before the first deploy**, for Production,
   Preview and Development:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://ytrkpcryztwgflmbhfdu.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from `apps/console/.env.local` |
   | `CRON_SECRET` | any long random string — the keepalive refuses to run in production without it |

   ⚠ If these are missing the build **fails**, and Next reports it as
   `Failed to collect page data for /login`. The real reason is on the
   `[cause]` line. That failure is intentional — better than deploying an app
   that 500s on every request.

4. Deploy. `vercel.json` registers the daily keepalive cron automatically.

**Do not add `SUPABASE_SERVICE_ROLE_KEY` here.** It bypasses RLS, and this app
ships code to a browser.

## Design

The console is a **piece of equipment**, and the name is the design: many lines
in, one operator's view out. Three rules carry that, and everything else is
downstream of them.

**Two voices.** Instrument Sans carries anything a *person* wrote — senders,
subjects, message bodies. IBM Plex Mono carries anything the *machine* knows —
timestamps, addresses, channel state, counts, the wordmark. On a monitoring
console the eye has to separate "what arrived" from "what the system is doing",
and a change of voice does that faster than a change of colour.

**A named type scale, not pixel values.** `--text-label` · `meta` · `note` ·
`row` · `subject` · `heading` · `display`, defined in `globals.css` and named
for the job rather than the size. Eight ad-hoc values had accumulated one
screen at a time, which is how a UI ends up looking *almost* right.

> ⚠ **Adding a step means editing two files.** tailwind-merge only knows stock
> Tailwind's groups, so it reads `text-subject` as a *colour* and drops it when
> `cn()` also sees `text-muted-foreground`. `lib/utils.ts` extends the
> `font-size` group to fix that, and a step missing from that list renders at
> the browser default of 16px with no error. It cost four elements once.

**Colour is never the only carrier.** The channel accents are Gmail red against
WhatsApp green — the worst possible pair for red/green colour blindness, and
"which line did this come in on" is the one question this product exists to
answer. So the timeline **names the channel in words wherever the line
changes** (`channelChangePoints`, `lib/timeline.ts`), the way a ledger prints a
column value only when it moves. One connected channel yields one label; two
interleaved yield one on nearly every row, which is exactly when it is needed.

There is also **no text tier below `--muted-foreground`**, which clears 4.5:1
on every surface. Quietness is expressed through size, letterspacing and case —
all free. `text-muted-foreground/60` is not: it lands near 2.3:1, and it was
carrying day counts, channel status and sender addresses.

`--faint` exists for hairlines, skeleton bars and an unlit lamp. **Nothing
legible may be set in it.**

### The timeline

**Keyboard.** `j` / `k` move, `Enter` opens a row, `g` returns to the top. It
moves real DOM **focus** rather than tracking a selection of its own — so Tab
still works, a screen reader announces the row it lands on, and there is no
second notion of "where you are" to drift out of sync with the browser's.

> ⚠ Never query rows with a bare `document.querySelectorAll`. React streams
> suspended content into a hidden `<div id="S:n">` at the end of `<body>`, so
> while the timeline sits behind `<Suspense>` the document holds a **second,
> invisible copy of every row** — 12 matches for 6 messages, measured. Scope to
> the scroller and filter on visibility; `components/timeline-keys.tsx` does
> both.

**Time.** Under an hour a row says "14m ago", because on a live board that is
the question; past an hour it hands back to the clock, since "5h ago" is vaguer
than 14:12 and the day heading already carries the date. One shared interval in
`lib/now.ts` drives every row — fifty rows with fifty timers wake the tab up
out of phase and update out of step with each other.

**Avatars are monochrome, and that is a decision.** A hue per contact is the
conventional build and it is wrong here: this interface spends colour on
exactly two meanings — which channel a message arrived on, and whether the
board is live — and that discipline is what lets a 7px dot carry the product's
central distinction. A third colour system with no meaning attached would make
all three read as decoration. The letters identify; they differ from one
another far more than pastel circles would. They are a rounded **square**
because there is already a circle 10px to the left, and two round things
adjacent read as one repeated element: round means signal, square means
identity. Your own messages invert. `initials()` handles the cases that matter
— see its note on why phone numbers take their **last** two digits.

**The list is capped at 50 and says so.** `fetchTimeline` asks for `limit + 1`
to learn whether more exist, which costs one row instead of a counting scan. A
console promising *every message, every channel, in order* must not silently
withhold one.

### Search

`/search` is one query across every channel, ranked by relevance rather than
recency. The SQL and its reasoning are in
`packages/db/migrations/0007_message_search.sql`; three things matter on this
side of the wire.

**The whole state is in the URL, and the form is a real `<form method="get">`.**
That makes a search a *link* — shareable, bookmarkable, survives a reload —
renders on the server, and works before hydration. The client enhancement is one
behaviour on top: changing a filter submits, because a checkbox needing a second
click on "Search" reads as broken. The text field deliberately does not
auto-submit per keystroke — that is one navigation to Singapore per character.

**Results are not the timeline.** No day headings: relevance order would put a
heading over one row, then another over one row. Each row carries its own date
instead (`showDate`). The channel label still follows `channelChangePoints`, so
one connected channel yields one label rather than fifty saying "Gmail".

> ⚠ **A snippet must never repeat the headline.** A message with no subject
> takes its headline from its opening line, and `ts_headline` fragments that
> same body — so a short chat message rendered the identical sentence twice,
> once large and once grey. `snippetRepeatsHeadline` catches it and the headline
> carries the marks instead. Found by measuring the preview harness; it is
> invisible in any fixture that happens to have a subject.

> ⚠ **Highlighting is elements, never HTML.** `ts_headline` defaults to `<b>`
> tags, and rendering those means putting a message body — written by somebody
> else — through `dangerouslySetInnerHTML`. The SQL delimits with STX/ETX
> instead, `highlightSegments` splits on them, and React escapes the text. A
> test pins it with an `<img onerror>` body.

Search results carry their **AI summary** since migration `0010`, so the same
message shows the same thing whichever screen you found it on. ⚠ That migration
has two traps and **both fail by hiding messages rather than erroring** —
`create or replace` cannot change a `RETURNS TABLE` so the function is dropped
and recreated (**and DROP takes the grants with it**), and the `kind` filter must
sit in the JOIN condition, because a WHERE on the right side of a LEFT join makes
it an inner join in effect.

### The message route

`/messages/[id]` renders **one message in full** — the assistant's citation
target (ADR-018) and the record view Phase 5's meeting proposals need beside
every extraction.

> ⚠ **This is the second place message bodies render**, and the enumerated list
> lives in `docs/02-ARCHITECTURE.md` §6. A third needs an amendment there, not a
> judgement call at the call site.

> ⚠ **It renders the WHOLE body, not `BODY_LIMIT`.** The 4,000-character ceiling
> bounds the *list* — every body in the timeline is serialised into the page
> whether or not its row is open — not the record. Truncating here would make a
> citation resolve to a partial quote, which is the opposite of the point.

> ⚠ **A message that is not yours and one that does not exist are the same
> `notFound()`.** RLS makes them indistinguishable, and that is correct rather
> than a limitation: confirming which ids exist in another tenant's mailbox is a
> leak even without the content.

### Contacts

`/contacts` is one row per person with **every handle they are known by**, and
`/contacts/[id]` is every conversation with them across every channel (US-5).
`docs/01-PRODUCT-SPEC.md` §1 names the problem it solves: *"the same client is a
phone number in one app and an email address in another, with no link between
them."*

> ⚠ **Identities are listed, never collapsed into the contact row.** The plural
> is the feature. With only Gmail connected every contact has one handle and the
> merge is invisible — that is the state of the data, not of the screen, and
> `/preview?screen=contacts` shows the merged version.

> ⚠ **The detail view is CONVERSATIONS, not "messages they sent".** `messages`
> records a sender and no recipients, so filtering to their own messages shows
> one side of every thread and drops your replies — a monologue. Their
> identities resolve to conversations, and every message in those is rendered
> through the same `MessageRow` the timeline and search use.

> ⚠ A `display_name` that **is** a phone number is not a name. WhatsApp supplies
> a profile name only when the sender set one, so the formatted number is
> common — and it has spaces, so `initials()`'s first-and-last-word rule turned
> every one of them into "+0". It now falls through to the last-two-digits rule.
> Found here, where a column of them is visible at once.

### Needs attention

`/attention` is the Phase 5 queue (US-9) — meetings, commitments, requests and
questions the worker pulled out of each message on the way in.

⭐ **It is the answer to a question the assistant could not answer**, and that is
not a coincidence. ADR-017 measured *"summarise what needs my attention"* and
found the model was never shown a single one of the real problems: semantic
search returns prose that *sounds* urgent, because importance is not a direction
in embedding space. The fix was never a prompt.

> ⚠ **The ordering is the feature, not presentation.** Overdue first
> (soonest-missed), then upcoming (soonest), then undated by newest message. A
> queue ordered by when the *message arrived* buries a meeting starting in an
> hour under six newsletters. `sortForAttention` is pure and tested.

> ⚠ **Confidence is a tiebreak, never a rank and never a filter.** It is the
> model's self-report, not a calibrated probability. Ranking by it puts a
> confidently-extracted newsletter above a hedged real meeting; filtering by it
> would be ADR-016's mistake in a new costume.

> ⚠ **Every row shows the verbatim sentence it came from**, on the row. ADR-010
> requires it, and `docs/02-ARCHITECTURE.md` §6 is amended to list this as the
> third place message content renders. A proposal without its quote is a claim
> the reader cannot check.

### Meeting proposals — the one place this app writes outward

On `/messages/[id]`, above the body, a meeting extraction renders as an editable
proposal (US-7b). **ADR-010 is absolute: never auto-create.** The worker writes
rows and stops; only a form submission reaches Google.

> ⚠ **`calendar_event_id` is checked before every insert** — and a
> **deterministic event id** backs it up. The primary guard has a real gap: the
> window between a successful `events.insert` and the database write recording
> it. A crash there leaves an event with nothing pointing at it, so the next
> Confirm sees null and creates a twin. A client-supplied id derived from the
> extraction id turns that into Google's `409 duplicate`, which is adopted
> rather than retried.

> ⚠ **Attendees are deliberately not sent.** Adding one makes Google email an
> invitation *from the user*. Participants go in the description instead.

> ⚠ **Times carry an explicit `+08:00`.** Without it Google uses the calendar's
> own timezone — a setting on the user's Google account this code cannot see —
> and every confirmed meeting lands eight hours out, silently. `lib/manila.ts`
> holds both conversions together because they are inverses that must agree.

### The assistant

`/assistant` asks one question at a time — single-turn, no history (Q2).

> ⚠ **An answer that cites nothing renders as a refusal.** That is a success
> criterion (`docs/01-PRODUCT-SPEC.md` §7), not a UI detail. Do not "improve" the
> assistant by letting it answer without citations.

> ⚠ **The suggestion chips must be questions the corpus can actually answer.** A
> suggestion that returns a refusal teaches a new user the feature is broken on
> their first interaction. Two of them were exactly that until 2026-08-02 —
> verify with `probe-context.ts` before changing the list, not by intuition.

### Theming

Three states — light, dark, and **system**, which is the default and is what
this console did before the control existed. The tokens switch on a `.dark`
class on `<html>`, not on `@media (prefers-color-scheme: dark)`: a media query
is a fact about the device and cannot be overridden from JavaScript, so a
stored preference is impossible while the tokens live inside one. The class is
also shadcn's convention, so `shadcn add` keeps working.

`lib/theme.ts` owns all of it — the store, the `.dark` write, and the
`THEME_INIT_SCRIPT` string that `app/layout.tsx` inlines.

> ⚠ **The init script must stay synchronous and stay in `<head>`.** It applies
> the stored preference before first paint; deferred or moved below `<body>`,
> the page renders light and then flips. It also sets `style.color-scheme`,
> which is what makes the browser paint its *own* surfaces dark — most visibly
> the scrollbar on the one scrolling column. And its fallback must keep
> matching `readStored()`: anything that is not `dark` or `light` follows the
> OS. When those two disagreed, a junk stored value painted light while the
> control showed "System" selected.

The control renders twice — sidebar footer on desktop, header cluster on
mobile, since the footer is `hidden` on a phone. That is why the state lives in
a module store read through `useSyncExternalStore` rather than in `useState`:
two copies with their own state disagree the moment a window crosses the
breakpoint.

### Seeing it — `/preview`

Every screen worth designing is behind a login and needs real mail to render,
so `pnpm dev` then <http://localhost:3100/preview> renders the real components
over fixture rows.

| URL | Shows |
|---|---|
| `/preview` | the timeline, two channels interleaved, with the truncation footer |
| `/preview?state=empty` | "Listening" — a channel is connected, nothing has arrived |
| `/preview?state=unconnected` | "No messages yet" + Connect. These two must never converge |
| `/preview?state=loading` | the streaming skeleton |
| `/preview?screen=channels` | the channel list |
| `/preview?screen=channels&state=error` | **a channel with `last_error` set** — the state the renewal sweep produces, which only ever surfaces here and is never around when you want to look at it |
| `/preview?screen=search` | ranked results, with real `ts_headline` delimiters so the highlight can be judged |
| `/preview?screen=search&state=prompt` | before anything is asked — carries the query grammar |
| `/preview?screen=search&state=empty` | **no matches.** Must never converge with the prompt state: one means *you have not asked*, the other means *the answer is no* |
| `/preview?screen=search&state=filtered` | the form with a channel and a date bound set |
| `/preview?screen=attention` | the Phase 5 queue — overdue, upcoming, undated, one already confirmed |
| `/preview?screen=attention&state=unread` | **"nothing has been read yet"** — the pass has not run |
| `/preview?screen=attention&state=empty` | **"nothing needs your attention"** — it ran and found nothing. These two must never converge |
| `/preview?screen=contacts` | **one person with a Gmail address AND a WhatsApp number** — the merge, which cannot be seen in the real data until Phase 2 |
| `/preview?screen=contacts&state=single` | the same list as the data actually is today: one handle each |
| `/preview?screen=contacts&state=empty` | "no contacts yet" — a channel is connected, nothing has arrived |
| `/preview?screen=contacts&state=unconnected` | "no channels connected". Must never converge with the above |

**Development only**, guarded twice — `notFound()` in the route and a
conditional entry in `PUBLIC_PATHS`, both keyed on `NODE_ENV`, which Next
inlines at build time. It reads nothing and constructs no Supabase client. If
that ever stops being true, delete it.

## State

Built in Phase 0: the app shell and the "no messages yet" empty state, rendering
light and dark, mobile and desktop. `pnpm dev` serves it on port 3100.

Auth is `/login` and `/signup` — **two routes, one primary action each**.

They were briefly one page with two submit buttons, where "Create an account"
was a second `formAction` on the sign-in form. It read as a link to a signup
page, so clicking it with empty fields produced the browser's required-field
tooltip and nothing else; you had to deduce that it wanted the fields above
filled in first. A control that reads as navigation should navigate. Splitting
them also lets the password field carry the right `autocomplete` per context —
`current-password` on sign-in, `new-password` on signup, which is what makes a
password manager offer to *generate* one rather than fill an existing one.

⚠ Both routes must stay in `PUBLIC_PATHS` in `src/proxy.ts`. Miss one and the
gate redirects it to `/login`, which for `/signup` is an infinite bounce.

Since built: `/search`, `/assistant`, `/channels`, `/messages/[id]`,
`/attention`, `/contacts` and `/contacts/[id]`. **Every nav item is `ready`
now** — nothing in `src/lib/nav.ts` is marked `soon`.

The shadcn/ui foundation is in place — `components.json`, the `cn` helper, and
the CSS variable theme — so `pnpm dlx shadcn@latest add <component>` works
without rework.

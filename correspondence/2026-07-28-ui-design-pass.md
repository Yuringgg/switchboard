# Design pass — the console

**2026-07-28.** Scope was `apps/console` only. No adapter, worker or ingest
code was touched. `pnpm check` green (183 tests, was 173), `next build` green.

---

## The direction, in one paragraph

The previous session had already found the right thesis and written it down in
comments — lamps, a panel, a machine voice against a human one, an amber hue
reserved for "the board is live". It was mostly present in the prose and barely
present in the pixels. **Nothing about that direction was replaced; it was
executed further and the broken parts were fixed.** The screen should read as a
piece of equipment, and the name is still the brief: many lines in, one
operator's view out.

---

## What was actually wrong

Four of these are defects rather than taste, and they are listed first.

**1. Channel identity rested on colour alone — and on the worst possible pair.**
A 7px dot was the only carrier, in Gmail red against WhatsApp green. That is
the classic red/green confusion, roughly 8% of men, and it was carrying the one
question this product exists to answer. WCAG 1.4.1.

*Fixed:* the timeline names the channel in words wherever the line changes, the
way a ledger prints a column value only when it moves. A single connected
channel yields one label at the top; two interleaved channels yield one on
nearly every row. A badge on all fifty rows would have been noise, and noise is
what gets skimmed past — so it would have failed in practice even where it
passed on paper.

**2. Text contrast failures.** `text-muted-foreground/60` and `/70` were
carrying day counts, channel status, sender addresses and the "soon" marker.
That lands near **2.3:1** against a 4.5:1 requirement.

*Fixed:* there is now no text tier below `--muted-foreground`, which clears
4.5:1 on every surface. Quietness comes from size, letterspacing and case
instead. Measured in the live DOM: **all 14 sampled elements pass AA in both
light and dark**, lowest 6.3:1.

**3. `live.tsx` could not report being offline.** The line read
`connection === 'offline' ? 'text-muted-foreground' : 'text-muted-foreground'`
— identical on both branches. A dead socket differed from a healthy one by a
6px dot losing its animation. That is precisely the collapse the component's
own docstring says it exists to prevent, and it is the same failure this
project already paid a debugging session for in the empty state.

*Fixed:* offline is now the only thing in the console outside a real error that
turns red, and it says what to do — "Not receiving updates. Reload the page to
reconnect." Also `aria-live="polite"`, because a screen-reader user had no way
to learn the board had stopped listening.

**4. The favicon 307'd to `/login`.** Not pre-existing — I introduced
`app/icon.tsx` and the route gate caught it, because Next's generated metadata
routes have no file extension and the matcher only excluded extensions. The
symptom would have been a blank tab icon on `/login` and `/signup`, the two
screens where nobody is signed in yet. `apple-icon` and `opengraph-image` are
named in the exclusion too so adding either later cannot reintroduce it.

---

## What changed by judgement rather than defect

**The type scale.** Eight ad-hoc values — 9.5, 10, 11, 12, 13, 13.5, 14, 15px —
became seven tokens named for their job. This is most of the difference between
a UI that looks *almost* right and one that looks deliberate.

> ⚠ **This bit me and it will bite the next person.** tailwind-merge only knows
> stock Tailwind's class groups, so it reads `text-subject` as a *colour* and
> keeps only the last one when `cn()` also sees `text-muted-foreground`. Four
> elements silently rendered at the browser default of 16px inside a 10px
> stencilled label, with no error, while identical classes written without
> `cn()` were fine. `lib/utils.ts` now extends the `font-size` group.
> **A token added to `globals.css` must be added there in the same commit.**

**Row hierarchy, and the thing I got wrong first.** Sender was set heavier than
subject while subject was set larger than sender — two signals pointing at
different words, so neither won. I first made the subject the headline outright,
then measured and realised **half this timeline has no subject at all**: email
has one, chat does not, and WhatsApp is the second channel by design. So every
chat row was rendering a 15px italic "No subject" where its actual words
belonged, pushing the words into the grey preview line — chat reading as a
degraded kind of email, on a screen whose whole premise is that both channels
are equal citizens of one record.

The headline is now *whatever the message leads with*: its subject if it has
one, its opening line if it does not. The "empty" fallback is consequently rare
and honest.

**Rows open.** A one-line preview with no way to read line two is a dead end on
a console built to answer "what did the client actually say". `fetchTimeline`
already selects `body_text`, so this costs no query, no route and no round trip
— it is the same data rendered fully, which is what keeps it out of Phase 3's
territory. Bodies are capped at 4,000 characters with the truncation *stated*
rather than implied by an ellipsis, because every body is serialized into the
page whether or not its row is open, and a real inbox contains newsletters.

**Mobile parity.** The `soon` marker was `hidden md:inline`, so on a phone
Contacts and Assistant looked like ordinary nav items that silently did
nothing — the desktop tooltip explaining them is not reachable by touch either.

**A skip link**, because reaching the timeline by keyboard meant tabbing past
the entire sidebar on every navigation, and the sidebar is the part that never
changes.

**Fewer repeated strings.** An eleven-word focus-ring class appeared at ten
call sites — the state right before one of them quietly loses it. It is now one
utility. Five button class strings became `buttonClass()`, deliberately a class
function rather than a component because the console's actions are split
between `<button>`, `<a>` and `<Link>`. Four copies of the alert block became
`<Callout>`, which keeps `role` a prop: `alert` interrupts a screen reader and
is right for a sign-in failure, `status` waits its turn and is right for
"connected".

---

## `/preview` — new, development only

Every screen worth designing is behind a login and needs real mail to render,
so the visual work was unreviewable: you cannot judge density or day dividers
against twelve messages you did not choose, and you certainly cannot see what
two interleaved channels look like before WhatsApp exists.

`localhost:3100/preview` renders the real components over fixture rows written
to exercise what actually breaks a layout — a subject long enough to truncate,
an empty body, a self-sent message, a sender with no display name, a run of one
channel interrupted by the other, a day boundary mid-thread, and Taglish.
`?state=empty` and `?state=unconnected` give the two empty states.

Guarded twice, both on `NODE_ENV`, which Next inlines at build time:
`notFound()` in the route and a conditional entry in `PUBLIC_PATHS`. **Verified
against a real production build — `/preview` answers 307, `/icon` 200.** It
reads nothing and constructs no Supabase client; if that ever stops being true,
delete it.

---

## Constraints from `2026-07-27-ux-brief.md`, all held

| Constraint | State |
|---|---|
| No `service_role` outside `app/api/webhooks/` | untouched; boundary test green |
| No direction filter on the timeline | untouched, comment intact, `sent` marker kept |
| The two empty states stay distinct | verified: "Listening" vs "No messages yet" + Connect |
| Migrations are hand-written SQL | no migration in this pass |
| Bodies render only in the timeline | the opened row is inside it; noted in the component |
| No scope creep into Phase 3 | no search, filters, contact pages or virtualization |
| Frame fixed, one scroller | verified in the DOM at 1280px and 375px: `MAIN#console-scroll`, alone |
| CSS-only mobile nav, no drawer state | unchanged |

---

## One proposal, deliberately not built

**A light/dark toggle.** `globals.css` records a considered decision to follow
the OS only, and `AGENTS.md` says not to change an architectural choice
silently — so this is the proposal rather than a commit.

The case for it is a demo case: being able to flip the theme on stage, under
whatever lighting the room has, is a visible "this is a finished product"
signal, and both palettes already exist and are AA-clean. The cost is real
though small — the `@custom-variant` swaps to shadcn's class-based form, and it
needs an inline script before paint or the first frame flashes the wrong theme.
Roughly an hour, and it is Yuri's call.

---

## Not addressed, and why

- **Contacts and Assistant** have no routes yet; the nav marks them `soon`.
- **Virtualized/infinite timeline** is Phase 3 and needs more than 12 rows to
  design against honestly.
- **`/channels` is verified by build and typecheck only.** It is behind a login
  and the preview harness does not cover it, so its visual result is the one
  thing in this pass I have not seen rendered. Worth a look when you next sign in.

---

## Verified, not assumed

Contrast, type scale, tab order, focus ring, expand behaviour and layout were
measured in the live DOM rather than eyeballed — this environment has no
screenshot capability, and measuring turned out to be the stricter check. It is
what caught the tailwind-merge bug, which no screenshot would have explained.

- 14/14 sampled elements pass WCAG AA in **both** schemes; channel lamp 4.77:1
  against the background, above the 3:1 non-text threshold
- Type scale resolves to 10/11/12/13.5/15/17px with intended tracking; the
  two-voice split holds (mono for machine facts, sans for human words)
- 375px: no page-level horizontal scroll, exactly one scroll container, `soon`
  visible, 32px touch targets
- `aria-expanded` toggles; `aria-controls` set only while the panel exists
- Focus ring renders on real keyboard focus (3px, `--ring` at 45%)
- Skip link is first in the tab order

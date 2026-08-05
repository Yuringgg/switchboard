# Ms. Maria's five changes — landing page, board, filter, light mode, auto-sync

**2026-08-06.** Everything Ms. Maria asked for in the 2026-08-05 meeting, built.
Scope was `apps/console` plus **one migration**. No adapter, worker or ingest
code was touched. **541 tests** (was 502), `tsc --noEmit`, `next build` and the
RLS boundary check all green.

---

## What she asked for, and where it landed

| Her words | What shipped |
|---|---|
| *"lagyan mo ng filter… Gmail lang or WhatsApp lang… para may option to see both"* | A channel filter on the timeline, in the URL |
| *"palitan yung UI ng need attention… kanban… not started, in progress, done… similar to Trello"* | `/attention` is a three-column board. Migration **0012** |
| *"pa-bright mode… squint ka muna"* | The light ramp rebuilt |
| *"halatang ginawa mo sa AI. Try to change the font, the spacing, the way you present it"* | Both typefaces replaced, the whole type scale re-cut |
| *"tanggalin yung need to refresh para lang mag-sync yung email… add ng auto sync"* | Reconnection, a poll, and refresh-on-focus |
| *"for landing page, you can be as creative as you want"* | `/welcome`, public, with an animated patch field |
| *"yung WhatsApp huwag muna masyadong pakialaman"* | Not touched |

⚠ **One instruction was NOT followed and Yuri needs to know.** She asked that the
landing page be **prototyped in Figma first**, explicitly so there is a design
artefact for the defence: *"mas okay if gawin mo siya via Figma rather than
generating from scratch… para ma-document yun for your defense."* This session
cannot drive Figma. The page was designed and built in code. **The Figma
prototype still owes to be made**, and it is documentation, not decoration — it
was the reason she gave for asking.

---

## ⚠ She was right about the fonts, and it was literally measurable

*"Halatang ginawa mo siya sa AI"* is the most useful note this project has had
on its UI, and the reason is not taste. The console was set in **Instrument Sans
and IBM Plex Mono**. Both of those sit on the reflex-reject list of
training-data defaults that `.agents/skills/impeccable/reference/brand.md`
maintains — the fonts a generator reaches for first, which is exactly why a
person who looks at a lot of generated work recognises them. She was reading a
real signal off the letterforms.

Replaced with **Archivo** (human voice — subjects, names, bodies) and **Martian
Mono** (machine voice — timestamps, addresses, counts, state, the wordmark). The
*split* is kept, because the split is not a default: it is the thing that lets
the eye separate "what arrived" from "what the system is doing" faster than a
colour change can.

Martian Mono is a wider face than Plex, which forced a second change: the
stencilled label's tracking came down from **0.16em to 0.1em** in the same
commit, and the mobile dock's label is now pinned at a literal 12px rather than
following the scale — six entries plus "Needs attention" fit a 375px phone
within two pixels, and one step up would have pushed an entry off the edge with
nothing saying so.

---

## ⚠ "Squint ka muna" was a defect, not a preference

Light mode's background was `oklch(0.994)` and its panel `oklch(0.972)`. **2.2%
of lightness apart.** The entire frame-versus-record idea this console is built
on — sidebar and header are the instrument, the message column is the record it
is showing — was carried by a step nobody can see on a laptop in daylight. Dark
mode never had the problem, because a light-on-dark step of the same size reads
far larger.

Measured in the live DOM, light scheme:

| | Before | After |
|---|---|---|
| background vs panel | 1.07:1 | **1.11:1** |
| hairline vs background | 1.31:1 | **1.39:1** |

⚠ Those numbers look small and they are the right size. A surface step past
about 1.15 stripes the console into panels, which is harder to read rather than
easier. What was wrong was not that the step was subtle; it was that it was
absent.

**Contrast, measured rather than eyeballed** — 10 text roles on the landing page,
both schemes, and every one clears AA:

```
light: worst 7.30:1   ·   dark: worst 7.45:1   ·   0 failing
```

⚠ **Measuring this console still needs `lab()` handling.** Computed colours come
back as CIE `lab()` and, on some elements, `oklab()`. An `rgb()` regex reads
L,a,b as R,G,B and reports ~1.2:1 for *everything*. WCAG luminance is the Y
channel; L\*→Y needs no colour-space adaptation.

---

## The landing page

`/welcome`, public, no client JavaScript beyond the theme toggle that was
already there. `proxy.ts` now sends an unauthenticated request for `/` here
instead of to `/login` — the first thing a stranger saw used to be a password
field for an account they did not have.

Eight sections, one idea per fold: hero, the patch field, the problem, four
capabilities as a spec sheet, the board, the pipeline, **four things it will not
do**, and one call to action. That seventh section is the one worth defending —
a landing page that names its own limits (never sends, never books a calendar
without you, never answers without a citation, never shows another tenant's
mail) is making the product's actual argument.

### ⚠ The patch field, and why none of it is JavaScript

The one moving thing. Two lines come in on the left, five signals travel down
five cords, each is patched through a jack in the middle with a lamp that lights
as it passes, and one ordered record comes out on the right — every row still
carrying the colour of the line it arrived on. It is the product diagram, and it
is the name: *many lines in, one operator's view out.*

Everything animates a property the style engine owns outright —
`stroke-dashoffset`, `opacity`, `transform`. No rAF, no motion library, no
scroll reveal, and **nothing is hidden until a class arrives**. Three reasons,
each of which has already cost this project time:

1. **A reveal that never fires ships a blank section.** Transitions pause in
   hidden tabs and in headless renderers. Gating a diagram on a scroll trigger
   is how it arrives at a defence panel empty.
2. **This project's browser pane does not composite.** rAF,
   `IntersectionObserver` and `ResizeObserver` deliver zero callbacks in it —
   which is why the WebGL figure on `/assistant` is still visually unverified
   two days later.
3. It costs nothing on the one page a stranger loads first.

**Verified by killing every animation and measuring the resting frame**, which
is exactly what a reader with `prefers-reduced-motion` sees: all five rows at
opacity 1 with no transform, all five lamps lit, both channel names visible, all
ten cord paths drawn. A finished picture, not a blank one.

⚠ **The dash arithmetic is not obvious and it fails by showing too much.** Every
cord carries `pathLength="100"` so one set of keyframes drives paths of
different real lengths at the same speed. The pattern is `14 200` — a 14-unit
dash and a **200**-unit gap. The obvious `14 100` does not work: its period is
114, so when the first dash is parked off the start of the path the *second*
repeat of the pattern is sitting in plain view at position 14. Full derivation
is on `@keyframes cord-signal` in `globals.css`; do not change the dasharray
without reading it.

⚠ `r: 2.4` in the lamp keyframes would have been discarded silently — `r` is a
CSS *length* and unitless is legal only for `0`. The identical mistake `ry: 30`
made in `@keyframes blink` on 2026-08-04. It is `2.4px`.

---

## The board

Migration **0012** adds `extractions.status` (`not_started` | `in_progress` |
`done`, `not null default 'not_started'`) and `status_changed_at`. Applied to the
live database and verified: 9 attention rows, all correctly defaulted; the 101
summary rows carry a value no screen reads. **All 11 tables still report
`rowsecurity`, `forcerowsecurity` and a policy with both USING and WITH CHECK.**

Four decisions in it that had a plausible wrong answer:

- **⚠ `confirmed_at` is NOT read as "done".** Putting a meeting on a calendar is
  the moment it becomes *real*, not the moment it stops needing attention — a
  meeting confirmed for Friday is squarely in progress all week. The two facts
  are independent and a confirmed card says so wherever it sits. There is a
  fixture on `/preview?screen=attention` that makes this visible rather than
  leaving it in a comment.
- **⚠ Done sorts by `status_changed_at`, not by deadline.** Everything finished
  is eventually overdue, so reusing `sortForAttention` there fills the column a
  person just cleared with red-flagged items ordered by how badly they were
  missed — for work that was completed. A test pins this.
- **⚠ The overdue count on the page header excludes Done**, for the same reason:
  otherwise the number climbs as the person clears work.
- **⚠ No drag and drop.** Trello's columns are the idea; its drag handle is not.
  HTML5 DnD needs a parallel keyboard control built anyway, it depends on
  pointer events this environment cannot test, and it fails silently on touch.
  Two arrows per card, 28×28, operable by mouse, keyboard, touch and screen
  reader, each naming its destination out loud: *"Move 'Project sync with Ms.
  Maria' to In progress"*.

**⚠ The move controls are a client component, and that is not gold-plating.** A
bare `<form action={serverAction}>` discards the return value, so a card that
fails to move simply does not move — "it worked and nothing changed" and "it
failed" would be pixel-identical. That collapse is the defect this console's
notes forbid by name twice. `useActionState` is what puts the reason on screen.

**⚠ `MoveResult` and `NO_MOVE_YET` live in `lib/attention.ts`, not in
`lib/attention-actions.ts`.** A `'use server'` module may export only async
functions; a plain `const` in one is a build error. `lib/auth-constants.ts`
exists for exactly the same reason.

---

## The filter

`?channel=gmail`, repeatable, on the timeline. Server-rendered, shareable,
survives a reload, works before hydration.

**⚠ The URL carries channel TYPES and the query takes channel IDS**, and the two
are different on purpose. A person filters by "Gmail"; `messages` only knows
`channel_id`. Putting ids in the URL — which is what `/search` does — makes a
shared link meaningless to anybody else and breaks on a reconnect, since
migration 0003 permits a second row for the same mailbox. The page resolves
types to the ids the reader actually owns, which also means a forged id in the
URL cannot widen the result. It can only narrow it to nothing.

**⚠ A test caught a real bug in this, and it was mine.** `parseChannelFilter`
collapsed "every line selected" back to "no filter" by comparing the raw
parameter list's length against the number of known types — so
`?channel=gmail&channel=gmail` counted as two, matched two, and **showed both
lines**. Exactly the opposite of what the URL asks for, silently. De-duplication
now happens first and a test pins the order.

**⚠ Both channels are always offered, including the unconnected one.** `/search`
hides its filter below two connected channels, reasoning that a filter which can
only return nothing makes a working feature look broken. That is right there and
wrong here for a reason outside the code: **WhatsApp is not connected** — it is
blocked on Meta, not on this repo — so hiding the control would have shipped Ms.
Maria's request as *no visible change at all*. That precise outcome already cost
two exchanges once, with the mobile dock. The unconnected chip says "not
connected" in words and cannot be selected.

There is now a **third timeline empty state** — narrowed to a line you have not
connected — and it is the one most likely to be misread, because it looks
exactly like a broken pipeline. It names the way out.

---

## Auto-sync

The console already claimed mail arrived without a refresh, and the claim was
conditional in a way nothing on screen admitted. Realtime is a WebSocket and a
WebSocket dies — a laptop sleeps, wifi changes, a tab backgrounds, Supabase
cycles a node. When it did, `live.tsx` set a red `Offline` status, **stopped**,
and told the reader to reload the page. That is the manual refresh Ms. Maria
asked to be rid of, dressed up as a status indicator.

Three things now stand behind the socket:

1. **Reconnection.** A dropped channel is torn down and re-subscribed on capped
   exponential backoff (1s → 30s), indefinitely. ⚠ The old channel is removed
   before each retry: re-subscribing an errored channel does not recover it, and
   leaving it attached leaks a socket per attempt.
2. **A poll** — every 20s while the socket is down, every 60s while it is up.
   The slow one is a safety net against the failure a socket cannot report:
   subscribed, and silently delivering nothing.
3. **Refresh on returning to the tab** (`visibilitychange` *and* `focus`, which
   are not the same event). ⚠ **This is the one that actually answers the
   complaint.** Every browser throttles timers in hidden tabs, so no interval
   can fix "I switched to the console and it was stale" — which is the exact
   moment somebody reaches for reload.

**⚠ Every path respects the at-the-top rule**, and none of them touches the
new-message pill. Refreshing while somebody is reading further down inserts rows
above their eyes, which is why the pill exists; and a poll has no idea whether
anything arrived, so incrementing the count would put "1 new message" over an
unchanged list. The pill's whole value is being believed.

**⚠ Reconnecting also refreshes.** Anything that arrived while the socket was
down was never announced to anyone — a subscription cannot replay it. Without
that, reconnecting restores the "Live" lamp over a list silently missing
messages, which is worse than the outage: it says up to date and is not.

**⚠ `offline` is gone and this overturns a decision recorded in `live.tsx`.**
The third state was red and said *"Reload the page to reconnect."* Both halves
stopped being true: the console **is** still receiving updates, and reloading is
the thing this change exists to make unnecessary. It is now `Syncing` — and it
must still be visibly distinct from `Live`, because "no new messages" and "the
socket died twenty minutes ago" looking identical is the defect the indicator
was built to prevent. Two carriers, neither of them colour: a different word,
and a lamp that does not blink.

---

## What is verified, and what is not

**Verified by measuring the live DOM**, at 375px and 1280px, in both schemes:

| | |
|---|---|
| Contrast, 10 landing-page text roles | **0 failing AA** · worst 7.30 light / 7.45 dark |
| Fonts actually resolved | Archivo · Martian Mono |
| Hero at 375px | 36px, 2 lines, **no horizontal overflow** |
| Patch field | 5 animated cords + 5 static, correct 0.72s stagger, 5 jack lamps, 5 row lamps |
| Resting frame (all motion killed) | every row, lamp, label and cord visible |
| Board | 3 columns, 5 cards, **every card carries its quote**, 10 move controls, 3 correctly disabled |
| Navigations in the a11y tree | exactly **one** at every width |
| Elements actually overflowing | **zero**, at both widths |

**⚠ Not verified: what any of it looks like.** This environment still has no
screenshot capability — the browser pane does not composite, and the attempt
fails outright rather than returning a blank image. Everything above is
measurement. **Somebody has to look at the landing page and the board before
this is shown to Ms. Maria**, and `localhost:3100/preview?screen=attention` and
`/welcome` are where.

**⚠ Also not verified: the move action against the real database.** The board
was exercised over `/preview` fixtures, which never reach Supabase. The action's
RLS behaviour is the same shape as `confirmMeeting`'s and the policy is
unchanged, but *"click an arrow on the deployed console and see the card move"*
has not been done.

---

## The lesson from this one

**A design tell can be a fact, not an opinion.** *"Halatang ginawa mo sa AI"*
sounded like taste and was not: two of the three things carrying it were
checkable in a minute — the typefaces were on a published list of generator
defaults, and the light surfaces were 2.2% of lightness apart. This project has
a standing pattern of documented claims that were never checked because checking
looked like it would be hard. This one was a stylesheet and a font import.

The other half: **the test caught my own bug, not somebody else's.** The
repeated-parameter case in `parseChannelFilter` was written, reviewed by me, and
wrong — and it failed by quietly showing *more* than the URL asked for, which is
the failure mode nobody notices in a demo.

# The design revisions — Yuri's review rounds, the adopted components, and archive

**2026-08-09.** Everything after `2026-08-06-maria-changes.md`. Scope was
`apps/console` plus two migrations. No adapter, worker or ingest code was
touched. **541 tests**, `tsc --noEmit` and `next build` green throughout;
migrations 0012 and 0013 applied to the live database and verified by querying.

Read the 2026-08-06 note first — it covers Ms. Maria's five review items. This
one covers what came after: Yuri's screenshot notes, three third-party
components adopted into the console, and the archive feature Ms. Maria asked for
in place of a delete button.

---

## 1. Yuri's screenshot notes, and one bug of mine

Four items, reported from screenshots of the deployed console.

**The landing hero.** The patch field started at y≈930 in a 1010px viewport, so
the one moving thing on the page sat below the fold and the first screen was a
wall of type. It lives inside the hero now and measures **91% visible at
1280×900**. The fold also carries the two channel dots and the live lamp, which
is where "looks dull" came from — the page was monochrome type all the way down
to the figure. Header wordmark, theme control and sign-in button all went up a
size.

**"Four things it will not do" was cut**, on instruction. The guarantees
themselves are untouched and still enforced; only the marketing section is gone.
A comment stands where it was so nobody reads its absence as the constraints
having been relaxed.

**The overlapping cards on `/attention`** were a promotional URL in a quoted
sentence forcing its grid track wider and drawing across the other two columns.
`min-w-0` on the track plus `[overflow-wrap:anywhere]` on the card — **neither
alone is enough**. Tested with the exact URL from the screenshot.

**The timeline splits**, Gmail left and WhatsApp right, with a Merged/Split
switch beside the channel filter in the same form so the two cannot clobber each
other. See ADR-022 for why split is the default and why that is worth knowing
before a demo.

### The bug that was mine

The animated auth screens first shipped with a `BoxReveal` shutter: a bar
covering each element that slides off on load. It rendered **a column of solid
white rectangles down the right edge of the sign-in form**, and Yuri caught it in
a screenshot.

The bar parked at `translateX(101%)`, which is only *hidden* if something clips
it. Nothing did — `overflow: hidden` had been left off deliberately so the bar
could not clip the focus ring on the inputs beneath. The two constraints are
genuinely in tension: a wipe needs clipping, the fields need their rings
unclipped.

**The lesson generalises and is recorded in `globals.css`.** "Is anything at
`opacity: 0`?" is not the resting-state check. Nothing here was transparent. The
defect was an element fully opaque and in the wrong place, and the only reliable
check is to kill every animation *and look at the result*:

```js
const k = document.createElement('style');
k.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
document.head.append(k);
```

The reveal is gone. The motion on that screen belongs to the backdrop now, where
it cannot cover a control.

---

## 2. Three components adopted, and what was refused

Yuri supplied three component drops (a 21st.dev-style animated sign-in, an
animated-beam demo, and an Apple-style calendar picker) with instructions to
copy them into `/components/ui`. **None was copied.** Each was rebuilt in the
console's own terms, and the refusals are the substance.

### The pattern, in every case: no JavaScript animation runtime

Every drop drove its motion through framer-motion — `useInView`,
`useMotionValue`, `motion.path` animating `pathLength`, `ResizeObserver`-measured
beam geometry. All of it was rebuilt on CSS.

That is not a performance preference. **This project's browser pane delivers zero
`requestAnimationFrame`, `IntersectionObserver` and `ResizeObserver`
callbacks**, and so does any headless renderer or a tab that is never painted. A
component that gates content behind an observer does not degrade there — it
ships blank. The `AnimatedBeam` drop would have measured `0×0` and drawn nothing;
the `BoxReveal` drop would have held a login form at `opacity: 0` forever.

`stroke-dashoffset` on a `pathLength="100"` path expresses the same flowing-line
effect and the compositor owns it. Custom properties written by a plain
`pointermove` handler replace `useMotionValue`. CSS keyframes replace the orbit.

**No dependencies were added.** `framer-motion` and `lucide-react` were already
installed; nothing needed `motion`, `@radix-ui/react-slot` or
`class-variance-authority`. That also avoided the lockfile-in-the-same-commit
rule that kept CI red for five days in July.

### What was refused outright

- **"Continue with Google / Apple / GitHub."** This product federates with none
  of them. Google OAuth exists here to *connect a Gmail channel* once you are
  already signed in — different consent, different scopes, different screen.
  Three dead buttons on the one screen a visitor cannot get past.
- **The Terms of Service / Privacy Policy line.** Neither document exists.
  Linking a policy that is not written is a claim, not a placeholder.
- **A testimonial from "Ali Hassan."** There is no Ali Hassan. An invented
  endorsement on a project being submitted for assessment costs more than it
  could gain.
- **Orbiting HTML5 / React / Figma / Git logos.** A portfolio piece: it tells
  somebody about to type a password what the site is *built with* rather than
  what it *does*.
- **shadcn `Button` and `Input` with radix-slot and cva.** `lib/ui.ts` documents
  why this project uses a class function rather than a Button component.
- **The picker's own theme toggle.** It wrote `classList` on `<html>` directly,
  bypassing `lib/theme.ts` which owns and persists the decision — so it changed
  the whole app's appearance and lost the change on the next reload.
- **Apple's `#FF3B30` on every day cell.** In this console red is
  `--destructive` and means something has gone wrong. A month of red numerals
  reads as a screen full of failures.

### The calendar picker, and the timezone trap

The source did its date arithmetic with `new Date(year, month, day)` and handed
back a `Date`. That is local-machine time, and **this flow is not in
local-machine time**: `lib/manila.ts` exists because a value drifting by an
offset puts a confirmed meeting on somebody's real calendar hours from where
they approved it, silently and consistently — which reads as a bug in extraction
rather than in a suffix.

Everything in `components/ui/date-time-picker.tsx` works on the wall-clock parts
of a `YYYY-MM-DDTHH:mm` string and never constructs a zoned `Date` from them.
`Date.UTC` is used only for month length and weekday, where it cannot drift. It
submits the identical string through a hidden input, so `manilaInputToRfc3339`
on the server is untouched and **ADR-010 still holds — nothing is created
without the form submission.**

It also fixed a real defect the native inputs had: moving the start now drags the
end with it, preserving the gap. Uncontrolled `datetime-local` fields let a
reader correct a 3pm meeting to 4pm and produce an event ending before it begins,
which Google rejects with a 400 naming neither field. Verified in the DOM:
60-minute gap preserved across both a day change and an hour change.

---

## 3. The flowing-line backdrop

The auth screens got a two-panel layout with the flowing lines behind the left
panel. Yuri then asked for the same behind every console page, excluding the
sidebar.

### Why it is far fainter in the console, with numbers

The auth panel carries one heading and one sentence. The console's pages carry
14px body text, and a line passing behind a glyph composites into its
background. Worked against `--muted-foreground`, the quietest text the console
permits:

| scheme | line opacity | effective contrast |
|---|---|---|
| dark | 0.12 | 2.8:1 — fails |
| dark | 0.045 | 4.1:1 — fails |
| dark | 0.03 | 4.8:1 — passes |
| light | 0.12 | 6.5:1 — passes |

Light-on-dark washes out far faster than dark-on-light, so the two schemes cannot
share a cap. The ramp tops out at 0.12 and the container is scaled to a quarter
of that in dark. Measured in the live DOM: muted text where the strongest stroke
crosses is **4.97:1 dark and 6.47:1 light**; body text 11.78:1 and 16.07:1.

**CAUTION: do not raise `dark:opacity-25` to make the effect more visible.** It
is sized to that measurement.

### Coverage was a real bug, found by measuring

Yuri reported the lines only appearing at the bottom. The visible field was
divided into a 4×4 grid and strokes through each cell counted:

```
 0   0   0   0     the entire top row, empty
10   6   3   0
28  15  13   7
46  36  16  16     everything piled into one corner
```

**Density alone did not fix it.** Raising the count from 14 to 36 per family
filled the same corner harder. The curves run upper-left to lower-right, and the
panel's narrow `696×316` box crops to the part of that sweep which has already
descended — right on a tall column beside a login form, wrong on a wide page.

Two changes, both chosen by measurement:

- A wider frame, `-200 -100 1000 800`. Six candidates were tried in the live DOM.
- **A vertically mirrored second family.** The source mirrors with
  `position: ±1`, which flips X only, so both families still descend the same way
  and the field keeps one diagonal band with two empty corners. Rotating 180°
  does nothing either — it maps a diagonal onto itself. Flipping Y turns the
  second family into an ascending sweep and the two cross.

Result on the same grid: **1 empty cell out of 16**, top row populated.

**CAUTION: `strokeScale` and `viewBox` move together.** Stroke width is in
viewBox units, so the wider frame renders every line thinner — the old box scaled
2.28× into the content area, the new one scales 1.02×. `strokeScale: 2.2`
reproduces the previous on-screen weight. Change one and you must change the
other.

### Placement

- It is on the **content wrapper**, not inside `<main>`. `<main>` is the one
  element in this app that scrolls; inside it the backdrop would scroll away
  after one viewport and leave everything below the fold untextured.
- The wrapper carries `isolate`. **A negative z-index only stays inside its
  parent when that parent establishes a stacking context** — without it the
  backdrop paints behind the root background, which is opaque, and disappears
  with nothing in the DOM to explain it. Plain `z-0` is worse: a positioned
  element paints above non-positioned in-flow content, so the lines would render
  over the header's own background.
- **Not in the sidebar**, per Yuri, and it is the right call anyway: the rail and
  the header are `--panel`, the surface that reads as the instrument. Texturing
  it would undo the frame-versus-record distinction the console is built on.

Verified at 1280 and 375: the backdrop starts at x=256 on desktop (exactly the
sidebar's edge) and y=61 on mobile (below the strip); neither the rail nor the
dock contains it; exactly one vertical scroller survives.

---

## 4. Archive, not delete — migration 0013

Yuri proposed a delete button because the board accumulates. Ms. Maria asked for
archive instead. **She is right for a reason specific to this schema, not a
general preference for soft deletes** — the full argument is ADR-021, and the
short version is that migration 0011 records per message that extraction has run,
so the worker skips it forever. A deleted extraction is never re-extracted.

What shipped:

- **An archive control on every card, in all three columns.** Done is the obvious
  case. The valuable one is Not started: the live board carries two cards
  extracted out of marketing email, complete with a tracking URL in the quote.
  Clearing noise before touching it is most of what stops the board reading as a
  pile.
- **"Archive all" on the Done column header.** Done is the only column nothing
  ever leaves. Scoped by `status = 'done'` in the WHERE clause, never by a
  client-supplied list of ids, so it cannot be persuaded to archive unfinished
  work.
- **An archived view at `/attention?archived=1`** with Restore, and an
  always-visible count linking to it. That count is why there is no confirmation
  dialog: the action is reversible and the way back is never hidden. A confirm
  step on a reversible action trains people to click through confirm steps.

**WARNING: `is('archived_at', null)`, never `eq(..., null)`.** PostgREST turns
`eq` into `= null`, which is NULL rather than true in SQL — the filter would
match nothing and the board would render empty with no error anywhere.

**WARNING: `fetchAttention` defaults to `scope: 'board'`, which excludes archived
rows.** `fetchMessageExtractions` calls through it for the proposal on
`/messages/[id]`, and a card somebody archived must not reappear there.

Not built, and worth considering: distinguishing "handled" from "the model should
not have surfaced this". The second is feedback about extraction quality rather
than about the work, and recording it would make "how often is the pass right?"
answerable — which is a defensible thing to have measured. One archive action is
the proportionate version for now.

---

## 5. A PowerShell edit that corrupted a file

Recorded because it will recur and because it nearly shipped.

Adding one field to five fixtures, a `Get-Content -Raw` / regex /
`Set-Content -Encoding utf8` round trip was used instead of the editing tool. In
Windows PowerShell 5.1 `Get-Content` reads a BOM-less UTF-8 file **as ANSI**, so
every box-drawing character in the file's comment banners was double-encoded, and
`Set-Content -Encoding utf8` **added a BOM**. The diff went from 5 lines to 115.

`tsc` and `vitest` both passed — they tolerate a BOM and do not care about
mojibake in comments. This is the same class of failure as the incident in
`docs/03-RESOURCES.md`, where a BOM written by `Out-File -Encoding utf8` broke a
Vercel build for two commits and presented as an application bug.

Caught by reading the bytes, reverted with `git checkout --`, and redone with the
editing tool. **Use the editing tool for source files. If PowerShell must touch
one, verify with `[System.IO.File]::ReadAllBytes` afterwards.**

---

## What is verified, and what is not

Measured in the live DOM at 375px and 1280px, both schemes:

| | |
|---|---|
| Contrast, landing page | 0 failing AA, worst 7.30 light / 7.45 dark |
| Contrast, auth screens | 0 failing AA, worst 5.24 light / 7.45 dark |
| Backdrop under body text | 4.97:1 dark, 6.47:1 light where the strongest stroke crosses |
| Backdrop coverage | 1 empty cell of 16, sidebar excluded, one scroller |
| Auth resting state | all 8 revealed elements at opacity 1 with motion killed |
| Board overflow | reproduced with the real URL; nothing escapes its column |
| Calendar picker | 60-minute gap preserved across day and hour changes |
| Migrations | 0012 and 0013 applied; 11 tables still RLS-forced with USING and WITH CHECK |

**Not verified: what any of it looks like.** This environment has no screenshot
capability — the browser pane does not composite and `computer{action:
"screenshot"}` errors rather than returning a blank image. Everything above is
measurement. Somebody has to look at the console before it is shown to Ms. Maria.

**Also not verified: the archive and move actions against the real database.**
Both were exercised over `/preview` fixtures, which never reach Supabase. Their
RLS shape matches `confirmMeeting`'s and the policies are unchanged, but clicking
Archive on the deployed console and seeing the card move has not been done.

---

## The lesson from this round

**Measure the thing, not a proxy for it.** Three of the defects in this note were
found by measuring and would not have been found by reading: the backdrop's
coverage grid, the hero's fold position, and the contrast of text with a line
behind it. Two more were false alarms produced by measuring *badly* —
`getComputedStyle` returning interpolated values mid-transition, and "first
opaque ancestor" being the wrong backdrop for an icon painted over an input.

The traps in the measuring are now written down in
`.claude/skills/component-adoption/SKILL.md` alongside the recipes, because the
next session will reach for the same probes.

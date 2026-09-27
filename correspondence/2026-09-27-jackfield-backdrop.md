# The jack field — the console's backdrop, redesigned from a reference

**2026-09-27.** Scope was `apps/console` only: styles, one new component, and
where the backdrop sits. No adapter, worker, ingest or migration change.
**706 tests**, typecheck green. Read `AGENTS.md` first.

---

## What Yuri asked for

Yuri supplied a design reference, *"Authkit — frosted glass cathedral at
midnight"*: a near-black page with a faint blueprint grid fading out at the
edges and a conic spotlight shining down from the top. In Yuri's words: *"i just want
the design of the background something like that but the design must be
similar or blending in with switchboards current ui/ux design"*, with a draft
to look at before anything was committed.

## What was built, and what Yuri chose

Three variants were designed (a three-designer panel plus a judge, scored
against this project's own rules), built behind a temporary preview switch,
and screenshotted in both schemes on five screens:

| | Variant | |
|---|---|---|
| A | **Jack field** — patch-bay sockets (hollow rings joined by hairlines) under one overhead light | recommended |
| B | **Ruled grid** — plain continuous lines, the reference's own look | the generated-hero default; flagged as the likeliest to read as "halatang ginawa mo sa AI" again |
| C | **A + today's flowing lines** kept over it in the console | **chosen by Yuri, for both dark and light** |

So what shipped is C:

- **A static jack field** behind the console record, `/login` + `/signup`
  (both columns, lining up across the border at `lg`) and the `/welcome` hero
  (56rem tall, its light hanging over the patch field's jack board).
  `components/ui/jackfield.tsx`; the `.jackfield*` rules in `app/globals.css`.
- **The flowing lines stay** over it in the console (`opacity-50` in light, down
  from full; `dark:opacity-25` unchanged) and on the sign-in panel (65%).
- **The backdrop starts under the header.** It moved from the content wrapper
  to a new `isolate` wrapper around `<main>`, so the header's border is the
  field's top edge. Sidebar, header and mobile dock stay untextured `--panel`.
- **Removed:** `AuthGlow` and `@utility auth-glow` (the form column has the
  jack field now), and every preview-only switch.

## Why a socket and not the reference's plain grid

A plain blueprint grid under a top spotlight is the stock 2024–26 generated
hero — the exact look Ms. Maria recognised on 2026-08-05. The socket is this
product's own glyph (the patch field on `/welcome`, the brand mark): from a
distance it still reads as the reference's grid; up close it reads as a
switchboard.

## Naming — a trap avoided

It is a **jack field** with an **overhead** light (`--overhead-*`), never a
"board" or a "lamp". Here the board is `/attention`, "the board is live" is what
amber means, and a lamp is a signal. Colour comes only from `--foreground` and
`--overhead-source` (`--card` in light, `--foreground` in dark), never `--live`
or a channel colour.

## Contrast — measured on pixels, and the old table was wrong

The flowing-lines table that shipped on 2026-08-09 (dark 0.03 → 4.8:1, dark
0.12 → 2.8:1, light 0.12 → 6.5:1) was worked in linear light. Browsers
composite in gamma sRGB. This time every figure is read off rendered pixels:

1. Render the backdrop with **no text on it** — a static HTML page that loads
   the dev server's compiled CSS (saved locally; a `file://` page will not load
   it from `localhost`) and contains only the backdrop markup copied from the
   served page.
2. Screenshot with headless Chrome at 1184×812 (the content area at 1440 wide),
   in `.dark` and light.
3. Take the worst pixel (brightest in dark, darkest in light) and compute its
   WCAG contrast against `--muted-foreground` converted from oklch to sRGB.
4. For the moving lines, repeat across **eight animation frames**
   (`--virtual-time-budget` from 1.5 s to 41 s) and keep the worst.

| muted text over… | dark | light |
|---|---|---|
| bare background | 7.44 | 7.32 |
| jack field + light + lines at rest | 6.49 | 6.10 |
| worst of 8 animation frames | **4.75** | **3.12** |
| the same, as shipped before (lines only, light at full strength) | — | **1.04** |
| `/welcome` hero field (no lines) | 5.76 | 6.35 |
| sign-in aside, top half (no muted text sits there) | 5.18 | 5.62 |

The worst moments are a few pixels where several moving dashes bunch at the
neck of the two line families, for a fraction of a second. Light still dips
under AA there — but from 1.04 to 3.12. To clear 4.5 at every instant, lower the
light opacity further; never touch `--muted-foreground`.

## Verified

- Screenshots of `/preview` (timeline, attention, assistant), `/login` and
  `/welcome`, 1440×900, both schemes, before and after.
- Phone (375, browser-pane `mobile` preset): no horizontal scroll on the
  timeline, sign-in or landing page; the field starts under the header; the
  dock is untouched.
- `pnpm typecheck`, `pnpm test` (706).

## Known and left alone

- **The timeline's sticky day heading** (`timeline.tsx`, `bg-background`) hides
  the field behind it — a faint band under "TODAY". It has to be opaque, or the
  rows scrolling under it show through when it sticks. Worth a look only if it
  bothers anyone.
- **The screenshot recipe** — headless Chrome renders real pixels here, which
  retires AGENTS.md's old "nobody can screenshot" note. ⚠ It will not make a
  window narrower than ~500px, so phone-width shots come out cropped and
  look like overflow. Use the browser pane's `mobile` preset for phones.

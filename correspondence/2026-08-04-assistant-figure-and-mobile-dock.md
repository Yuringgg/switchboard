# Two components from a generator — the assistant's figure, and the mobile dock

**2026-08-04.** Scope was `apps/console` only. No adapter, worker, ingest or
migration code was touched, and nothing reads the database that did not before.
502 tests, `tsc --noEmit` and `next build` all green.

Two components were supplied as copy-paste snippets from a component generator.
Both needed real repair before they could be used. **The repairs are the point of
this note** — every one of them fails silently, and three would have shipped.

---

## What landed

**`components/ui/shader-svg.tsx` → the assistant's face.** A rounded figure
filled with a live WebGL mesh gradient, eyes following the pointer, blinking. It
sits above the composer on `/assistant` via `components/assistant-ghost.tsx`,
which maps the panel's state to it: *Ready · Reading your messages · Answered
from your messages · Nothing to cite · Unavailable*.

The figure is `aria-hidden` and every state it expresses is also a real string
beside it in the mono voice — which is the only arrangement that makes an
animated illustration acceptable on the screen this product is judged on.

⚠ **The refusal was the design constraint, not the animation.** `docs/01-PRODUCT-SPEC.md`
§7 makes "refuse rather than guess" a success criterion and ADR-016 records what
it cost to keep honest. A character that beams through a refusal quietly undoes
that. The status line names the *reason* — "Nothing to cite" — and does not take
`--destructive`, because a refusal is a correct outcome and not a fault.

**`components/ui/modern-mobile-menu.tsx` → navigation on a phone.** A bottom
dock: every entry shows its icon, the current one also shows its label with a
rule underneath sized to the word. It replaces the horizontally scrolling strip
that sat under the wordmark. **The desktop sidebar is untouched.**

**Two new dependencies**, both in `apps/console` only, and `pnpm-lock.yaml` is in
the same commit: `framer-motion` and `@paper-design/shaders-react`.

---

## The defects in the supplied code

**1. `document.querySelector('svg')` measured the wrong element.** It returns the
*first* SVG in the document — here the Switchboard mark in the sidebar — so the
eyes tracked the pointer relative to the logo. A `ref` now.

**2. The clip path's id was a global constant.** Two figures on one page would
both define `#shapeClip`. `useId()`, sanitised: React 19 generates ids containing
characters that are not safe in a URL fragment.

**3. `ry: 30` is not valid CSS, so the figure never blinked.** `ry` is a length
and unitless is legal only for `0`; the browser discards the declaration and
logs nothing. `30px` now, and the keyframes live in `globals.css` beside
`animate-lamp` rather than in `styled-jsx`.

**4. The menu silently replaced the caller's items with demo data.** Its
validation capped at 2–5 entries and fell back to `defaultItems` otherwise — so
this console's **six** entries would have rendered as *"home · strategy · period
· security · settings"*, in production, behind a `console.warn`. The cap is gone.

**5. `ref={(el) => (itemRefs.current[i] = el)}` is a React 19 error.** An arrow
with an expression body returns the assignment, and React 19 reads a returned
function as the ref's cleanup. Both callbacks have block bodies now.

**6. Nothing respected `prefers-reduced-motion`.** The stylesheet's global reduce
rule only reaches CSS animations; framer-motion writes inline styles and the
shader runs its own rAF loop. `speed={0}` stops the shader's loop outright.

**7. The menu navigated nowhere** — `activeIndex` was local click state. Entries
carrying an `href` are `Link`s, and which one is active comes from the route.
`pending` covers only the gap until the navigation resolves.

⚠ **The CSS for the dock did not exist.** The snippet shipped the custom
properties and the `iconBounce` keyframe and **no `.menu`, `.menu__item`,
`.menu__icon` or `.menu__text` rule at all** — as given it renders six unstyled
buttons in a row. Those rules were written here against this console's tokens.
`tw-animate-css` and a `--color-chart-*` block that defined variables as
themselves were dropped.

---

## ⚠ Two bugs found by measuring, both invisible in the code

**Unlayered CSS outranks every cascade layer, so `md:hidden` did nothing.**
Tailwind v4 emits utilities into `@layer utilities`. `.menu { display: flex }`
written at the top level of `globals.css` beat it at equal specificity — so the
dock stayed visible on desktop beside the sidebar and the console had **two
navigations both labelled "Primary"**. The rules are inside `@layer components`
now. **Any raw class added to `globals.css` must be, or a utility cannot
override it.**

**A React `style` prop re-asserted `--lineWidth: 0px` over the measured value.**
The snippet seeded the rule's width inline, so every re-render overwrote what the
effect had just measured and the rule stayed invisible until an unrelated resize
happened to re-run it. The default lives on `.menu__item` in CSS now, where an
inline value set by the effect outranks it and nothing races.

---

## Verified, not assumed

This environment still has no screenshot capability, and the browser pane does
not composite — `ResizeObserver`, `IntersectionObserver` and `requestAnimationFrame`
all deliver **zero** callbacks in it. Two things follow, and both nearly caused a
wrong fix:

- **The shader canvas measures 0×0 here and that is not a defect.** The library
  pauses when the tab is hidden, and a tab that never runs its rendering steps
  never delivers the `ResizeObserver` that sizes the backing store.
- **`getComputedStyle(el, '::after').width` reports `0px` even for
  `width: 77px !important`.** The pseudo-element's used width needs layout this
  tab is not performing. Height reports correctly, which makes it look credible.

⚠ **The figure's actual appearance is therefore UNVERIFIED.** A CSS gradient is
painted under the canvas so a WebGL failure degrades to a gradient rather than a
hole, but nobody has looked at it. `localhost:3100/preview?screen=assistant` is
where to.

Measured in the live DOM instead, at 375px and 1280px, in both schemes:

| | |
|---|---|
| Ghost status label | 7.45:1 dark · 5.27:1 light — AA on both |
| Dock active label | 13.41:1 dark · 16.51:1 light |
| Dock inactive icons | 7.01:1 dark · 6.36:1 light |
| Touch targets | 44×44, six entries, **no horizontal scroll at 375px** |
| Navigations in the a11y tree | exactly **one** at every width |
| Vertical scrollers | exactly one, `MAIN#console-scroll` — the rule holds |
| Assistant state sequence | Ready → Reading → Answered, citation resolving |

**`/preview?screen=assistant` is new**, with `?state=answered|refused|error`. The
refusal and the provider-unavailable states cannot be summoned on demand in the
running console — one needs a question that retrieves nothing, the other needs a
spent quota — and reaching *any* of them costs real questions out of an allowance
of roughly thirty a day shared by every tenant. The action is a fixture; it
never reaches Groq, `/embed` or the database.

---

## Not addressed, and why

- **The dock is mobile only.** A horizontal icon dock is not a thing a 240px
  desktop rail wants to be, and the sidebar is route-driven and already works.
- **The figure is on `/assistant` only.** Putting it in the shell would mount a
  WebGL canvas on every screen including the timeline, and pull ~410KB into
  every page's bundle instead of one.

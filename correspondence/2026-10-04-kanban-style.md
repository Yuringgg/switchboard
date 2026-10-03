# Needs attention and Contacts in the 21st.dev kanban style

*Written 2026-10-04. Newer than everything in `docs/`.*

Yuri pasted a 21st.dev "kanban board" component (framer-motion, drag and drop)
and asked for its style on **Needs attention**, and on **Contacts** if possible.

## What changed

**Needs attention** (`components/attention-board.tsx`, now a client component)

- Column headers: an empty ring, a clock and a tick (grey, amber, green), the
  title in the sans, and a count that pops when it changes.
- Cards: rounded, a hairline ring with a soft shadow, lifting on hover; Done
  cards faded with the title struck through (full strength on hover or focus).
- Tags: the kind as a tinted pill (Meeting violet, Commitment amber, Action
  cyan, Question fuchsia — none of them a channel's hue), and the channel as
  a named pill.
- Footer: the sender's initials and name, and the date — red with the word
  "Passed" when overdue, never in Done. It wraps rather than cutting the name.
- **Drag and drop between columns**, on top of the arrows. A dropped card
  lands at once (`useOptimistic`); if the server refuses, it goes back and the
  reason shows above the board.

**Contacts** (`components/contact-list.tsx`): the same cards, two across from a
tablet up, a round avatar, one tag per handle, and the count and last date on
the right. The same-name clue now WRAPS — truncated in a half-width card it
read "Operatio…", and the clue is what tells four Marias apart.

## What was kept on purpose

- Every card still shows its quote in full (ADR-007/010).
- The arrows stay: drag is mouse-only, and they are how keyboard, touch and
  screen-reader users move cards.
- ⚠ **No framer-motion.** The snippet starts each card at opacity 0 and fades
  it in from JavaScript, so where animation frames are not delivered (the
  browser pane, headless renders, a background tab) the board renders empty.
  The motion here is CSS (`card-in`, `count-pop`, `.board-card` in
  globals.css) and the resting state is the visible one.

## ⚠ A recorded rule this reverses

The board's cards carried "a border OR a shadow, never both" since the
2026-08-09 design pass, written after Ms. Maria said the console looked
generated. Yuri asked for this look; the comment on `.board-card` says so, and
it is the block to revisit if the "looks like AI" note comes back.

## Verified

- 771 tests, typecheck, production build.
- `/preview?screen=attention` and `?screen=contacts&state=samename`, dark and
  light; the phone width measured in the browser (no sideways overflow at
  375px).
- Drag and drop driven in the browser over the preview's fixtures: the held
  card dims, the target column lights, the card lands at once, and — the
  fixture id being refused by the server — it returns to its column with
  "Could not move that card. Try again." No real card was moved.

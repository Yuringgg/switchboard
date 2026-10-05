# A wall of moving messages on the landing page

*Written 2026-10-06. Newer than everything in `docs/`.*

Yuri pasted a 21st.dev "testimonials with vertical marquee" component and asked
for it merged into the old landing page — "floating emails, meeting
transcripts, WhatsApp messages" — with options to choose from on a preview.

## What was built, and what Yuri chose

Four looks were rendered, dark and light:

- A — two straight columns beside the hero headline
- B — the same, tilted like cards on a table
- **C — a full-width wall under the problem paragraph** ← chosen ("only c")
- D — tilted messages behind the sign-in panel instead of the lines

A, B and D were removed. The sign-in screen is unchanged.

## What is on the page now

Under "A client answers on WhatsApp. Their team replies by email…", four
columns (two on a phone) of invented Gmail mail, WhatsApp chats and meeting
transcript lines drift up and down, alternately, at slightly different speeds.
Some cards carry a coloured "On the board · Commitment" tag (the board's own
kind colours), one email shows its summary, and an invoice shows "In Files" —
the problem paragraph, then the product, without another word of copy.

`components/marketing/message-marquee.tsx`; CSS under THE MESSAGE MARQUEE in
`globals.css`.

## How it differs from the snippet

- **No JavaScript, no new packages.** The snippet used `motion` and
  `@radix-ui/react-avatar` and a `KineticTestimonial` file it did not include.
  The loop is two CSS keyframes; each column holds its cards twice and moves
  exactly half its height, so it has no seam.
- **Nothing starts invisible.** The snippet faded its heading and cards in from
  opacity 0 on scroll. That ships blank wherever the animation does not run
  (this project's browser pane, a headless render, a background tab), so it
  was left out; the cards are drawn and the motion only moves them.
- **It can be stopped.** Pointing at a column pauses it, and a small pause
  button (a checkbox read by `:has()`, so no script) stops all of them —
  WCAG 2.2.2. Reduced motion shows it still.
- **Every message is invented.** Same rule as the board figure: no real mail on
  a public page. Names and companies are made up, phone numbers masked.

## Checked

Dark and light at 1440 wide; a 375 px phone (two columns, no sideways scroll,
card footers wrap cleanly); production build compiles; 773 tests pass.

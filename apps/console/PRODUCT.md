# Product

## Register

product

The console is the product and the register default. **One surface is `brand`:
`/welcome`, the landing page** — it is the only screen seen by someone who does
not yet know what Switchboard is, and Ms. Maria asked for it explicitly
(2026-08-05: *"for landing page, you can be as creative as you want"*). Design
serves the task everywhere else.

## Users

**Yuri**, an OJT intern at iOzera, and **Ms. Maria**, the industry mentor who
proposed and scoped the project. Both use it on a laptop, indoors, in daylight —
which is why the light theme is not a courtesy mode, and why Ms. Maria squinting
at it on 2026-08-05 was a real defect and not a preference.

The job: **stop switching apps to find out what arrived.** A person whose work
comes in on Gmail and on WhatsApp has no single place that answers "what came in,
in what order, and what does it want from me". They are checking, not composing —
Switchboard never sends a message.

Third audience, and the one the whole thing is graded by: a **defence panel**
seeing this for about fifteen minutes. That is the reason for the landing page,
and the reason "which channel did this come in on" has to be answerable across a
room.

## Product Purpose

Gmail and WhatsApp are ingested into one private server, normalised into a single
canonical message shape, and shown as **one ordered timeline**. On top of that
sits a model that summarises each message, pulls meetings, commitments, action
items and questions out of them, and answers questions about the corpus with
citations — refusing when it cannot cite.

Success is: a message arrives and appears **without anybody touching the page**,
and a person can tell at a glance which line it came in on and whether it wants
something from them.

## Brand Personality

**Attentive · mechanical · plainspoken.**

The name is the brief. A switchboard is a physical panel: many lines in, one
operator's view out. The console is *a piece of equipment* — a printed
instrument face in daylight, a panel under its own lamp at night. One amber hue
is reserved for "the board is live" and nothing else may take it.

Two voices, and the split is load-bearing rather than decorative: **one family
for anything a person wrote** (subjects, names, message bodies) against **one
mono for anything the machine knows** (timestamps, addresses, counts, state,
the wordmark). On a monitoring surface the eye has to separate "what arrived"
from "what the system is doing", and a change of voice does that faster than a
change of colour.

It never oversells. The assistant refusing is a success criterion, not a
failure; the model is named on every row it wrote; a proposal is never described
as a fact.

## Anti-references

- **"Halatang ginawa mo sa AI."** Ms. Maria, 2026-08-05, about this console. The
  single most important note in this file. Two of the tells were literal: the
  original pair was **Instrument Sans + IBM Plex Mono**, both on Impeccable's
  reflex-reject list of training-data defaults, and the light theme was
  `#fdfdfe` on `#f7f8f9` — a surface separation you cannot see.
- **Generic SaaS-cream.** No parchment, no sand, no warm-tinted near-white body.
- **The hero-metric template.** No "10,000+ messages processed" stat row. This
  system has one user and it does not need to pretend otherwise.
- **The dashboard that fakes liveness.** No decorative pulsing. The amber lamp
  means a socket is genuinely open; if it is not, it says Offline in red.
- **Trello's own look.** The board Ms. Maria asked for takes Trello's *columns*,
  not its chrome — no drop shadows on cards, no coloured column headers.

## Design Principles

1. **Colour is never the only carrier.** Gmail red against WhatsApp green is the
   worst pair for red/green colour blindness, and "which line was this?" is the
   one question the product exists to answer. The channel is named in words
   wherever the line changes.
2. **Two states that mean opposite things must never look the same.** This
   project has paid for that twice — an empty timeline that looked identical
   whether the pipeline worked or nothing was connected, and a dead socket that
   differed from a healthy one by a dot losing its animation.
3. **Show the sentence it came from.** Every model output on screen carries the
   verbatim quote it was derived from and the name of the model that wrote it. A
   queue of confident claims with no way to check them is the thing the
   architecture exists to prevent.
4. **The frame does not scroll; the record does.** Exactly one element in the app
   owns vertical scroll.
5. **Nothing needs a refresh.** If the reader has to reload to see what arrived,
   the product has not done its job.

## Accessibility & Inclusion

- **WCAG 2.2 AA**, verified by measuring computed colours in the live DOM rather
  than by eye. ⚠ This console's computed colours come back as CIE `lab()`; an
  `rgb()` regex reads L,a,b as R,G,B and reports ~1.2:1 for *everything*.
- **Red/green colour blindness is a first-class constraint**, per principle 1.
- **`prefers-reduced-motion` is honoured globally** and every animation has a
  still fallback. The landing page's hero must be legible with motion off.
- Touch targets 44×44 on the mobile dock; exactly one navigation in the
  accessibility tree at any width.
- No text may be set in `--faint`; it does not clear 4.5:1 and that constraint is
  stated once, on the token.

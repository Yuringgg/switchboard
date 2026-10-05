# The theme switch reveals the new theme in a circle

*Written 2026-10-06. Newer than everything in `docs/`.*

Yuri pasted a 21st.dev "circular theme reveal" component and asked for it in
Switchboard's light and dark mode.

## What changed

Pressing Light, Dark or System on any theme control (landing page, sign-in,
sign-up, privacy page, console sidebar and header) now switches with a circle:

- **Going light**, the light page grows out of the option you pressed until it
  covers the screen.
- **Going dark**, the light page shrinks back into the option you pressed.

`lib/theme-transition.ts` (`switchTheme`) does it with the browser's View
Transitions API; the CSS is under THE THEME REVEAL in `globals.css`. The
toggle calls `switchTheme` instead of `setTheme`; the store in `lib/theme.ts`
is unchanged.

## How it differs from the snippet

- **One theme system, not two.** The snippet carried its own colours and its
  own saved theme on one panel. Here it drives the console's existing store
  (`.dark` on `<html>`, `switchboard-theme` in localStorage, cross-tab sync)
  and the whole page.
- **The circle starts at the control, not the middle**, so the change visibly
  comes from the click. Moving it to the centre is one line (drop `origin`).
- **The three-way control stays.** System is still a choice; the snippet's
  two-way switch would have deleted it.
- **No circle when the colours would not change** (System → Dark on a dark
  machine), under reduced motion, or in a browser without the API. The theme
  just switches.

## ⚠ The bug found while testing, and fixed

The first version awaited the animation alone. Paused in the browser pane, the
watchdog skipped the transition but the animation's promise never settled, so
the "a switch is running" flag stayed on and **every later switch lost its
reveal**. It now races the animation against the transition, so a skip always
ends it. Measured after the fix: a stalled reveal clears in about 2.2 s and the
next switch animates again.

## Checked

In the browser pane, frozen half way (`getAnimations()` paused): the light
circle growing from the sun, the light page shrinking into the moon, the new
option already highlighted in the new picture (`flushSync`). No console
errors; 773 tests pass.

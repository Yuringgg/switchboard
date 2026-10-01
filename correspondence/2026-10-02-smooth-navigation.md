# Smooth navigation — the frame stays put, every page answers the click

*Written 2026-10-02. Newer than everything in `docs/`.*

Yuri asked for Switchboard to feel smoother when moving between pages, and to
use 21st.dev for ideas.

## What 21st.dev offered, and what was taken

21st.dev is a registry of React + Tailwind + shadcn components (12,000+). Its
categories that bear on moving around an app were browsed: Tabs, Docks,
Sidebars, Navigation menus, Search / command menus, Spinners and progress,
Toasts. The console's own dock (`components/ui/modern-mobile-menu.tsx`) was
already adapted from one of them.

**Taken, as patterns — the code is this console's own:**

- the **sliding highlight** of "Vercel Tabs" / "Slide Tabs": one pill that
  glides to the entry you click;
- **skeleton loading states** shaped like the page they stand in for.

**Not taken:** animated heroes, shaders, glow and beam effects. Ms. Maria's
note — *"halatang ginawa mo siya sa AI"* — was about exactly that look.
framer-motion was not used either: this console moved to CSS-only motion on
purpose (`flowing-paths.tsx`).

## What was actually slow — measured, not guessed

1. **No page had a loading screen.** After a click nothing changed until the
   server answered, and Next cannot prefetch a dynamic route that has no
   `loading.tsx`.
2. **The frame was rebuilt on every click.** Each page drew its own sidebar,
   so it, the realtime subscription and the backdrop were thrown away and
   rebuilt each time.
3. **The pages run in Washington, D.C.; the database is in Singapore.** The
   live site's `x-vercel-id` header reads `sin1::iad1::…` — the edge is in
   Singapore, the function in `iad1`. Every database read crosses the Pacific
   and back (about 0.2 s each), several times per page.

## What was built (ADR-031)

| | |
|---|---|
| **`app/(console)/layout.tsx`** | renders `ConsoleFrame` (sidebar, dock, `Live`) once; it survives navigation. URLs unchanged — the parentheses stay out of the path |
| **`PageFrame`** | what each page renders now: its header and its scroll column |
| **`loading.tsx` × 11** | every route: the page's header and a skeleton the page's shape, on the click. Timeline's is exactly the page's first streamed state |
| **The rail's slide** | the active pill is one element that moves to the clicked entry (0.28 s). It moves on the click, before the page answers |
| **Fade-in** | the content column fades and rises 4px over 180 ms when a page arrives. Not on `router.refresh()`, so arriving mail never flickers the page |
| **Search** | the field holds its place while the page loads; it used to pop in and push the prompt down |

Both animations are CSS and switch off under `prefers-reduced-motion`.

## ⚠ Waiting on Yuri — move the pages to Singapore

One line in `apps/console/vercel.json`: `"regions": ["sin1"]`. It was **not
applied**, because it moves the live deployment. It would make each database
read a few milliseconds instead of about 0.2 s. It also helps Uriel: a voice
tool call makes several reads, all of them crossing the Pacific today, which is
Ms. Maria's task 1 (voice responsiveness).

Trade-off: Groq (the AI) is in the US, so each AI call gets about 0.2 s
further away. That is one call per answer against several database reads per
page, so it still comes out ahead. After deploying, check `x-vercel-id` reads
`…::sin1::…`.

## Verified

- 771 tests, 4 of them new (`nav.test.ts` — which rail entry a path lights), typecheck,
  production build. Route table unchanged.
- In the browser (`/preview`): the pill lands exactly on the active entry
  (measured box for box), and slides from Files to Contacts in about 0.3 s
  after the click. The fade-in leaves no `transform` behind, so the date
  picker's popover is not trapped. The phone dock still fits all eight entries
  at 375px.
- Screenshots, dark and light: each loading screen beside its page
  (`/preview?screen=loading&page=<route>`).
- ⚠ **Not checked: clicking through the signed-in console.** This session
  does not sign in. The new layout is covered by the build and the tests;
  Yuri's first click on the live site is the real check.

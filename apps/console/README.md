# apps/console

Next.js 16 (App Router) + Tailwind + shadcn/ui → **Vercel**.

Two things live here, and the boundary between them matters:

- **The console** — timeline, search, contacts, assistant. Talks to Supabase with
  the **anon key + user session**, so RLS applies and a user can only ever reach
  their own rows.
- **Ingest webhooks** — `app/api/webhooks/`. Serverless, per ADR-011, because a
  cold-starting container drops webhooks and providers eventually disable an
  endpoint that keeps timing out.

**Ingest does three things: verify the signature, insert a `raw_events` row,
return 200.** No parsing, no enrichment, no API calls. The temptation to "just do
a little normalization here" is exactly what the ingest/worker split exists to
prevent.

## Deploying to Vercel

Not yet done — it needs the dashboard. The Vercel MCP can read projects and
deployments but cannot create a git-connected project or set environment
variables, and there is no CLI login on this machine.

1. **Import** `Yuringgg/switchboard` at vercel.com/new.
2. Set **Root Directory** to `apps/console`. This is a pnpm workspace monorepo;
   without it Vercel builds the repository root and finds no Next.js app.
3. Add environment variables **before the first deploy**, for Production,
   Preview and Development:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://ytrkpcryztwgflmbhfdu.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from `apps/console/.env.local` |
   | `CRON_SECRET` | any long random string — the keepalive refuses to run in production without it |

   ⚠ If these are missing the build **fails**, and Next reports it as
   `Failed to collect page data for /login`. The real reason is on the
   `[cause]` line. That failure is intentional — better than deploying an app
   that 500s on every request.

4. Deploy. `vercel.json` registers the daily keepalive cron automatically.

**Do not add `SUPABASE_SERVICE_ROLE_KEY` here.** It bypasses RLS, and this app
ships code to a browser.

## State

Built in Phase 0: the app shell and the "no messages yet" empty state, rendering
light and dark, mobile and desktop. `pnpm dev` serves it on port 3100.

Auth is `/login` and `/signup` — **two routes, one primary action each**.

They were briefly one page with two submit buttons, where "Create an account"
was a second `formAction` on the sign-in form. It read as a link to a signup
page, so clicking it with empty fields produced the browser's required-field
tooltip and nothing else; you had to deduce that it wanted the fields above
filled in first. A control that reads as navigation should navigate. Splitting
them also lets the password field carry the right `autocomplete` per context —
`current-password` on sign-in, `new-password` on signup, which is what makes a
password manager offer to *generate* one rather than fill an existing one.

⚠ Both routes must stay in `PUBLIC_PATHS` in `src/proxy.ts`. Miss one and the
gate redirects it to `/login`, which for `/signup` is an infinite bounce.

Not here yet: every surface behind a `soon` nav item (Contacts, Assistant,
Channels). Those flip on by setting `ready: true` in `src/lib/nav.ts` once a
route exists.

The shadcn/ui foundation is in place — `components.json`, the `cn` helper, and
the CSS variable theme — so `pnpm dlx shadcn@latest add <component>` works
without rework.

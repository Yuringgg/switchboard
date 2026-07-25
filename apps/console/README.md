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

## State

Built in Phase 0: the app shell and the "no messages yet" empty state, rendering
light and dark, mobile and desktop. `pnpm dev` serves it on port 3100.

Not here yet: the Vercel deploy, Supabase auth and the sign-in flow, the ingest
routes under `app/api/webhooks/`, and every surface behind a `soon` nav item
(Contacts, Assistant, Channels). Those flip on by setting `ready: true` in
`src/lib/nav.ts` once a route exists.

The shadcn/ui foundation is in place — `components.json`, the `cn` helper, and
the CSS variable theme — so `pnpm dlx shadcn@latest add <component>` works
without rework.

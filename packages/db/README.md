# packages/db

Schema, migrations, and typed clients.

- **Migrations:** Drizzle Kit, checked into git so the schema is reviewable.
- **Worker client:** Drizzle on `service_role` — typed SQL, good `SKIP LOCKED`
  and pgvector support.
- **Console client:** supabase-js on the anon key + user session.

That split is a **security boundary, not a preference**. The console goes through
RLS; the worker bypasses it. Using the service key in the console would silently
disable every tenant-isolation policy in the system.

Every table carries `owner_id`, `enable row level security` **and**
`force row level security`, with one policy shape:
`using (owner_id = auth.uid()) with check (owner_id = auth.uid())`.

Schema is specified in `docs/02-ARCHITECTURE.md` §3. Lands in Phase 0 — currently
a placeholder, because the first migration needs a Supabase project to apply to.

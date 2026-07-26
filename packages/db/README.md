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

## ⚠ Do not run `drizzle-kit generate` or `drizzle-kit migrate`

Run against the live database on 2026-07-26, `generate` produced a migration
that would have **disabled row level security on all ten tables, dropped all ten
tenant-isolation policies**, and dropped every unique, check and foreign-key
constraint — including the `(channel_id, external_id)` idempotency guard.

It is not a drizzle-kit bug: `src/schema.ts` does not model RLS, policies or
check constraints, so the differ correctly saw drift and proposed deleting
everything the schema does not declare. The full reasoning, and what fixing it
properly would require, is in `drizzle.config.ts`.

**Migrations are the hand-written SQL below**, applied through Supabase.
Drizzle is used as an ORM — typed queries and inferred types — which is
unaffected. This deviates from `docs/02-ARCHITECTURE.md` §8 and needs an
amendment there.

`drizzle-kit pull` (introspection) is safe and is a useful drift check.

## State

```
migrations/0001_initial_schema.sql   ten tables, pgvector, indexes
migrations/0002_rls_policies.sql     the security boundary, on its own
tests/tenant_isolation.sql           two tenants, one shared contact, no bleed
seeds/dev_user.sql                   DEV ONLY — a pre-confirmed test account
src/schema.ts                        Drizzle tables for typed queries
src/supabase-types.ts                generated types for the console
```

Both migrations are applied to project `ytrkpcryztwgflmbhfdu`
(`ap-southeast-1`), verified by introspection: 10 tables, 75 columns, 18
indexes, 20 foreign keys, 10 policies, 6 check constraints.

**Run the isolation test after any change to a policy or to `owner_id`.** It is
self-verifying — every assertion raises, so a clean run is the pass — and it
rolls back, leaving nothing behind. It has been checked against a negative
control: with RLS disabled it fails, which is the only reason a pass means
anything.

Schema is specified in `docs/02-ARCHITECTURE.md` §3.

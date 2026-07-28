# packages/db

Schema, migrations, and typed clients.

- **Migrations:** hand-written SQL, checked into git so the schema is reviewable.
  ⚠ **Not** Drizzle Kit — see the section below, and note the first line of this
  file used to say otherwise.
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
migrations/0001_initial_schema.sql        ten tables, pgvector, indexes
migrations/0002_rls_policies.sql          the security boundary, on its own
migrations/0003_channels_unique_account.sql   a reconnect cannot double a mailbox
migrations/0004_raw_events_idempotency.sql    the guard a redelivery hits first
migrations/0005_realtime_messages.sql     messages → supabase_realtime
migrations/0006_channels_external_account.sql  the WhatsApp tenant lookup key

tests/tenant_isolation.sql           two tenants, one shared contact, no bleed
tests/idempotency.sql                replay 3×, assert one row, across 4 guards
scripts/assert-rls.ts                CI: RLS + force + USING/WITH CHECK, 10 tables
scripts/provision-whatsapp.ts        assign a business number to an owner
src/schema.ts                        Drizzle tables for typed queries
src/supabase-types.ts                generated types, kept in step by hand
```

All six migrations are applied to project `ytrkpcryztwgflmbhfdu`
(`ap-southeast-1`), verified by introspection rather than assumed.

**Run the isolation test after any change to a policy or to `owner_id`.** It is
self-verifying — every assertion raises, so a clean run is the pass — and it
rolls back, leaving nothing behind. It has been checked against a negative
control: with RLS disabled it fails, which is the only reason a pass means
anything.

⚠ **`src/supabase-types.ts` is generated but is edited by hand when a migration
lands**, because regenerating needs the Supabase CLI. It drifts silently — a
missing column typechecks fine everywhere until something selects it.

Schema is specified in `docs/02-ARCHITECTURE.md` §3.

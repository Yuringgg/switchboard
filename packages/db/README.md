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

## State

```
migrations/0001_initial_schema.sql   ten tables, pgvector, indexes
migrations/0002_rls_policies.sql     the security boundary, on its own
tests/tenant_isolation.sql           two tenants, one shared contact, no bleed
seeds/dev_user.sql                   DEV ONLY — a pre-confirmed test account
```

Both migrations are applied to project `ytrkpcryztwgflmbhfdu`
(`ap-southeast-1`). Still to do: the Drizzle client and generated types.

**Run the isolation test after any change to a policy or to `owner_id`.** It is
self-verifying — every assertion raises, so a clean run is the pass — and it
rolls back, leaving nothing behind. It has been checked against a negative
control: with RLS disabled it fails, which is the only reason a pass means
anything.

Schema is specified in `docs/02-ARCHITECTURE.md` §3.

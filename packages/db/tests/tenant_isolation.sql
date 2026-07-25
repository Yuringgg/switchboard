-- Two-tenant isolation test.
--
-- The scenario from docs/04-ROADMAP.md Phase 0: two users who both know the
-- SAME external contact — the same email address, the same phone number —
-- because in the real world two people at an agency talk to the same client.
--
-- Why this test carries more weight than its size suggests: RLS is the security
-- boundary, not defense in depth (ADR-009). There is no application-level check
-- behind it. If a policy is wrong, one tenant reads another's private client
-- communications and nothing else in the system objects.
--
-- It runs as `authenticated` with a forged JWT claim, which is exactly how
-- PostgREST executes a console query — so it exercises the real policies rather
-- than a simulation of them.
--
-- Self-verifying: every assertion raises on failure, so a non-error run IS the
-- pass. Cleans up after itself.
--
-- Run:  supabase MCP execute_sql, or psql -f against any Switchboard database.

begin;

-- ── Arrange ─────────────────────────────────────────────────────────────────
-- Two tenants. Inserted directly because this test needs no password flow —
-- RLS keys off the JWT `sub` claim, which is all auth.uid() reads.
insert into auth.users (id, instance_id, aud, role, email)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tenant-a@isolation.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tenant-b@isolation.test');

-- Seeded as the table owner (bypassing RLS) so the fixture itself is not the
-- thing under test.
insert into channels (id, owner_id, type, display_name, credentials)
values
  ('a0000000-0000-4000-8000-000000000001',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'gmail', 'A gmail', '\x00'::bytea),
  ('b0000000-0000-4000-8000-000000000001',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'gmail', 'B gmail', '\x00'::bytea);

-- THE SAME external contact, known to both tenants. This is the case that
-- breaks a naive unique constraint and the case a leak would surface in.
insert into contact_identities (id, owner_id, channel_type, external_id, display_name)
values
  ('a0000000-0000-4000-8000-000000000002',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'gmail', 'shared-client@example.com', 'Shared Client'),
  ('b0000000-0000-4000-8000-000000000002',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'gmail', 'shared-client@example.com', 'Shared Client');

insert into messages (
  owner_id, channel_id, external_id, direction, body_text, payload_raw, sent_at
)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'msg-a-1', 'inbound', 'Tenant A private message', '{}'::jsonb, now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001',
   'msg-b-1', 'inbound', 'Tenant B private message', '{}'::jsonb, now());

-- ── Act + Assert ────────────────────────────────────────────────────────────
set local role authenticated;

do $$
declare
  a_id constant text := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  b_id constant text := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  n int;
  body text;
  leaked text;
begin
  -- ── As tenant A ───────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', a_id, 'role', 'authenticated')::text, true);

  select count(*), min(body_text) into n, body from messages;
  if n <> 1 then
    raise exception 'LEAK: tenant A sees % messages, expected exactly 1', n;
  end if;
  if body <> 'Tenant A private message' then
    raise exception 'LEAK: tenant A read the wrong message: %', body;
  end if;

  -- The shared contact must resolve to A's row only, despite B having an
  -- identity with an identical external_id.
  select count(*) into n from contact_identities
   where external_id = 'shared-client@example.com';
  if n <> 1 then
    raise exception 'LEAK: tenant A sees % identities for the shared contact, expected 1', n;
  end if;

  select count(*) into n from channels;
  if n <> 1 then
    raise exception 'LEAK: tenant A sees % channels, expected 1', n;
  end if;

  -- ── As tenant B ───────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', b_id, 'role', 'authenticated')::text, true);

  select count(*), min(body_text) into n, body from messages;
  if n <> 1 then
    raise exception 'LEAK: tenant B sees % messages, expected exactly 1', n;
  end if;
  if body <> 'Tenant B private message' then
    raise exception 'LEAK: tenant B read the wrong message: %', body;
  end if;

  -- ── Writes are fenced too, not just reads ─────────────────────────────────
  -- WITH CHECK must stop B from creating a row owned by A. Without it, a
  -- compromised or buggy client could plant rows in another tenant's console.
  begin
    insert into messages (owner_id, channel_id, external_id, direction, body_text, payload_raw, sent_at)
    values (a_id::uuid, 'a0000000-0000-4000-8000-000000000001',
            'forged', 'inbound', 'forged by B', '{}'::jsonb, now());
    raise exception 'LEAK: tenant B successfully wrote a row owned by tenant A';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  -- B must not be able to reassign its OWN row into A's console either.
  -- WITH CHECK raises rather than quietly matching zero rows, so both outcomes
  -- have to be treated as the pass condition.
  begin
    update messages set owner_id = a_id::uuid where external_id = 'msg-b-1';
    if found then
      raise exception 'LEAK: tenant B reassigned a row into tenant A''s console';
    end if;
  exception
    when insufficient_privilege then null;  -- expected: WITH CHECK blocked it
  end;

  -- And confirm from A's side that nothing arrived.
  perform set_config('request.jwt.claims', json_build_object('sub', a_id, 'role', 'authenticated')::text, true);
  select string_agg(body_text, ', ') into leaked
    from messages where body_text = 'Tenant B private message';
  if leaked is not null then
    raise exception 'LEAK: tenant A can see tenant B''s message after reassignment attempt';
  end if;

  -- ── Anonymous sees nothing ────────────────────────────────────────────────
  perform set_config('request.jwt.claims', null, true);
  select count(*) into n from messages;
  if n <> 0 then
    raise exception 'LEAK: an unauthenticated session sees % messages, expected 0', n;
  end if;

  raise notice 'PASS: tenant isolation holds across reads, writes, ownership reassignment, and anonymous access';
end $$;

reset role;

-- ── Cleanup ─────────────────────────────────────────────────────────────────
-- Rolled back rather than deleted: the test leaves no trace even if an
-- assertion fires midway.
rollback;

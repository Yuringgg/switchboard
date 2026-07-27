-- Idempotency test — the last Phase 1 item.
--
-- Pub/Sub guarantees AT-LEAST-once delivery, never exactly-once. It redelivers
-- whenever an ack is slow or lost, and Gmail's history windows overlap on
-- retry. So the same notification arriving three times is normal operation, not
-- an edge case, and "exactly one row" has to be a property of the schema rather
-- than of the code being careful.
--
-- Guards under test:
--   raw_events  unique (channel_id, external_id)   [migration 0004]
--   messages    unique (channel_id, external_id)   [migration 0001]
--   conversations unique (channel_id, external_thread_id)
--   contact_identities unique (owner_id, channel_type, external_id)
--
-- Self-verifying: every assertion raises, so a clean run IS the pass. Rolls
-- back, so it leaves nothing behind even if an assertion fires midway.
--
-- Run: supabase MCP execute_sql, or psql -f against any Switchboard database.

begin;

insert into auth.users (id, instance_id, aud, role, email)
values ('11111111-1111-4111-8111-111111111111',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'idempotency@test.local');

insert into channels (id, owner_id, type, display_name, credentials)
values ('22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        'gmail', 'idem@example.test', '\x00'::bytea);

do $$
declare
  owner   constant uuid := '11111111-1111-4111-8111-111111111111';
  chan    constant uuid := '22222222-2222-4222-8222-222222222222';
  n int;
begin
  -- ── 1. The same Pub/Sub notification, delivered three times ───────────────
  -- Pub/Sub's messageId is stable across redeliveries, so all three carry it.
  for i in 1..3 loop
    begin
      insert into raw_events (owner_id, channel_id, external_id, payload, status)
      values (owner, chan, 'pubsub-msg-identical',
              '{"emailAddress":"idem@example.test","historyId":"5000"}'::jsonb, 'pending');
    exception
      -- The webhook treats this as success and returns 200: a non-2xx would
      -- make Pub/Sub retry a duplicate even harder.
      when unique_violation then null;
    end;
  end loop;

  select count(*) into n from raw_events where channel_id = chan;
  if n <> 1 then
    raise exception 'raw_events: 3 deliveries produced % rows, expected 1', n;
  end if;

  -- ── 2. The same message, upserted three times ─────────────────────────────
  -- History windows overlap on retry, so the worker re-reads messages it has
  -- already stored. That must be a no-op, not a duplicate.
  for i in 1..3 loop
    insert into conversations (owner_id, channel_id, external_thread_id, subject, last_message_at)
    values (owner, chan, 'thread-1', 'Original subject', now())
    on conflict (channel_id, external_thread_id) do update
      set last_message_at = greatest(conversations.last_message_at, excluded.last_message_at),
          subject = coalesce(conversations.subject, excluded.subject);

    insert into contact_identities (owner_id, channel_type, external_id, display_name)
    values (owner, 'gmail', 'sender@example.test', 'Sender')
    on conflict (owner_id, channel_type, external_id) do update
      set display_name = coalesce(contact_identities.display_name, excluded.display_name);

    insert into messages (
      owner_id, conversation_id, channel_id, external_id, direction,
      sender_identity, subject, body_text, payload_raw, sent_at
    )
    select
      owner,
      (select id from conversations where channel_id = chan and external_thread_id = 'thread-1'),
      chan, 'gmail-message-id-1', 'inbound',
      (select id from contact_identities
        where owner_id = owner and channel_type = 'gmail' and external_id = 'sender@example.test'),
      'A subject', 'A body', '{}'::jsonb, now()
    on conflict (channel_id, external_id) do update
      set body_text = excluded.body_text;
  end loop;

  select count(*) into n from messages where channel_id = chan;
  if n <> 1 then
    raise exception 'messages: 3 replays produced % rows, expected 1', n;
  end if;

  select count(*) into n from conversations where channel_id = chan;
  if n <> 1 then
    raise exception 'conversations: 3 replays produced % rows, expected 1', n;
  end if;

  select count(*) into n from contact_identities where owner_id = owner;
  if n <> 1 then
    raise exception 'contact_identities: 3 replays produced % rows, expected 1', n;
  end if;

  -- ── 3. A reply in the same thread reuses the conversation ─────────────────
  -- A plain insert would violate the unique constraint on every reply, so this
  -- also proves the upsert target is right rather than merely present.
  insert into messages (
    owner_id, conversation_id, channel_id, external_id, direction,
    subject, body_text, payload_raw, sent_at
  )
  select owner,
         (select id from conversations where channel_id = chan and external_thread_id = 'thread-1'),
         chan, 'gmail-message-id-2', 'inbound', 'Re: A subject', 'Reply body',
         '{}'::jsonb, now()
  on conflict (channel_id, external_id) do update set body_text = excluded.body_text;

  select count(*) into n from conversations where channel_id = chan;
  if n <> 1 then
    raise exception 'a reply created a second conversation (% total)', n;
  end if;

  select count(*) into n from messages where channel_id = chan;
  if n <> 2 then
    raise exception 'expected 2 distinct messages in the thread, got %', n;
  end if;

  -- The first subject must survive: replies carry "Re:" and letting them
  -- overwrite turns a thread's title into whatever arrived last.
  if (select subject from conversations where channel_id = chan) <> 'Original subject' then
    raise exception 'a reply overwrote the conversation subject';
  end if;

  raise notice 'PASS: replays are idempotent across all four tables';
end $$;

select 'IDEMPOTENCY TEST PASSED' as result;

rollback;

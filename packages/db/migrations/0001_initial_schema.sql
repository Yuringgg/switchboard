-- 0001_initial_schema
--
-- The full schema from docs/02-ARCHITECTURE.md §3. Ten tables, every one of
-- them owned by a user.
--
-- RLS is applied separately in 0002 so the security boundary is reviewable on
-- its own rather than buried in table definitions.

-- pgvector stays in `public`, deliberately.
--
-- Supabase's security linter flags this (`extension_in_public`) and the textbook
-- fix is to move it to the `extensions` schema. Checked before doing so: on this
-- project only the `postgres` role has `extensions` in its search_path, and
-- there is no database-level default. `authenticated` and `service_role` — the
-- two roles the console and worker actually run as — do not.
--
-- Moving it would therefore break `::vector` casts and the `<=>` cosine operator
-- in Phase 4, and break them for the app roles only, which is the worst way to
-- find out. The exposure being traded away is pgvector's math functions being
-- callable over PostgREST; they touch no tables and read no data.
--
-- Revisit only alongside an explicit search_path grant for both roles.
create extension if not exists vector;

-- Identity comes from Supabase Auth (auth.users). No custom users table.

-- ── channels ────────────────────────────────────────────────────────────────
-- Connected accounts. owner_id is the tenant key everything else inherits.
create table channels (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  type          text not null check (type in ('gmail', 'whatsapp')),
  display_name  text not null,
  -- ENCRYPTED (AES-256-GCM), never plaintext. bytea rather than text so that
  -- storing a plaintext token is obviously wrong. docs/02-ARCHITECTURE.md §6.
  credentials   bytea not null,
  status        text not null default 'active'
                  check (status in ('active', 'paused', 'error')),
  last_error    text,
  created_at    timestamptz not null default now()
);

create index channels_owner_idx on channels (owner_id);

-- ── contacts ────────────────────────────────────────────────────────────────
-- One row per real human. Per-tenant: my contacts are not your contacts.
create table contacts (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  display_name  text not null,
  notes         text,
  created_at    timestamptz not null default now()
);

create index contacts_owner_idx on contacts (owner_id);

-- ── contact_identities ──────────────────────────────────────────────────────
-- That human's handle on a given channel. This is what makes merging work.
create table contact_identities (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  contact_id    uuid references contacts (id) on delete set null,
  channel_type  text not null check (channel_type in ('gmail', 'whatsapp')),
  external_id   text not null,              -- email address / phone number
  display_name  text,
  -- owner_id MUST be in this key: two tenants can both know the same number.
  unique (owner_id, channel_type, external_id)
);

create index contact_identities_contact_idx on contact_identities (contact_id);

-- ── conversations ───────────────────────────────────────────────────────────
create table conversations (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users (id) on delete cascade,
  channel_id         uuid not null references channels (id) on delete cascade,
  external_thread_id text not null,
  subject            text,
  last_message_at    timestamptz,
  unique (channel_id, external_thread_id)
);

create index conversations_owner_recent_idx
  on conversations (owner_id, last_message_at desc);

-- ── messages ────────────────────────────────────────────────────────────────
create table messages (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete cascade,
  channel_id      uuid not null references channels (id) on delete cascade,
  external_id     text not null,
  direction       text not null check (direction in ('inbound', 'outbound')),
  sender_identity uuid references contact_identities (id) on delete set null,
  subject         text,
  body_text       text not null,
  body_html       text,
  payload_raw     jsonb not null,
  sent_at         timestamptz not null,
  ingested_at     timestamptz not null default now(),
  -- ← idempotency guard. Providers WILL redeliver webhooks; upsert on this,
  --   never plain insert.
  unique (channel_id, external_id)
);

-- The timeline query, and the index every RLS policy check rides on.
create index messages_owner_sent_idx on messages (owner_id, sent_at desc);
create index messages_conversation_idx on messages (conversation_id);
create index messages_sender_idx on messages (sender_identity);

-- ── message_chunks ──────────────────────────────────────────────────────────
-- Embeddings live here, not on messages, because long emails chunk into several.
create table message_chunks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  message_id  uuid not null references messages (id) on delete cascade,
  chunk_index int not null,
  content     text not null,               -- the chunk that was embedded
  embedding   vector(384),                 -- Xenova/multilingual-e5-small
  unique (message_id, chunk_index)
);

-- Cosine, matching the retrieval in docs/02-ARCHITECTURE.md §4.
create index message_chunks_embedding_idx
  on message_chunks using hnsw (embedding vector_cosine_ops);

create index message_chunks_owner_idx on message_chunks (owner_id);

-- ── attachments ─────────────────────────────────────────────────────────────
create table attachments (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  message_id  uuid not null references messages (id) on delete cascade,
  blob_url    text not null,               -- Azure Blob, assigned after upload
  filename    text,
  mime_type   text,
  size_bytes  bigint
);

create index attachments_message_idx on attachments (message_id);
create index attachments_owner_idx on attachments (owner_id);

-- ── extractions ─────────────────────────────────────────────────────────────
-- LLM-derived structure. Separate from messages so it can be recomputed or
-- discarded without touching the source of truth. ADR-006.
create table extractions (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users (id) on delete cascade,
  message_id        uuid not null references messages (id) on delete cascade,
  kind              text not null
                      check (kind in ('commitment', 'meeting', 'action_item', 'question')),
  payload           jsonb not null,        -- { title, starts_at, participants, ... }
  confidence        real,
  model             text not null,         -- which model produced it
  -- Calendar write-back (ADR-010). Null until the user confirms a proposal.
  -- ← idempotency guard: check before every events.insert, or re-running
  --   extraction puts the same meeting on a real calendar twice.
  calendar_event_id text,
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now()
);

create index extractions_owner_kind_idx on extractions (owner_id, kind);
create index extractions_message_idx on extractions (message_id);

-- ── raw_events ──────────────────────────────────────────────────────────────
-- The ingestion queue. A table, not a broker — ADR-005. Consumed with
-- SELECT ... FOR UPDATE SKIP LOCKED.
create table raw_events (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  channel_id    uuid not null references channels (id) on delete cascade,
  external_id   text,
  payload       jsonb not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'processing', 'done', 'failed')),
  attempts      int not null default 0,
  last_error    text,
  received_at   timestamptz not null default now()
);

-- The worker's claim query: oldest pending first.
create index raw_events_claim_idx on raw_events (status, received_at)
  where status = 'pending';

create index raw_events_channel_idx on raw_events (channel_id);
create index raw_events_owner_idx on raw_events (owner_id);

-- ── sync_state ──────────────────────────────────────────────────────────────
-- Worker-only (never read by the console), but carries owner_id anyway so every
-- table follows the same RLS shape and none is a special case.
create table sync_state (
  channel_id  uuid primary key references channels (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  cursor      text,                        -- gmail historyId
  -- ⚠ Gmail's watch expires and must be renewed at least every 7 days or email
  --   ingestion stops SILENTLY. Daily cron renews at T-2 days.
  expires_at  timestamptz,
  updated_at  timestamptz not null default now()
);

create index sync_state_owner_idx on sync_state (owner_id);

-- Finds watches due for renewal.
create index sync_state_expiry_idx on sync_state (expires_at)
  where expires_at is not null;

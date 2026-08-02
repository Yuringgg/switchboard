-- 0009_chunk_retrieval
--
-- Phase 4B: semantic retrieval over `message_chunks` (US-6, ADR-003, ADR-007).
--
-- The table and its `vector(384)` column have existed since migration 0001.
-- What lands here is the index that makes searching it viable, and the function
-- that searches it **without bypassing RLS**.
--
-- Applied by hand. ⚠ `drizzle-kit generate` is NOT used on this project — run
-- against the live database it proposed disabling RLS on all ten tables and
-- dropping every tenant_isolation policy. See packages/db/drizzle.config.ts.

-- ── The index ───────────────────────────────────────────────────────────────
--
-- HNSW rather than IVFFlat, for one reason that matters at this size: **IVFFlat
-- must be built against existing data to choose its lists, and it returns bad
-- recall when built on an empty or nearly-empty table.** This table is empty
-- right now and fills gradually as mail arrives, which is precisely the shape
-- IVFFlat handles worst. HNSW has no such requirement — it is incrementally
-- built and its recall does not depend on when it was created.
--
-- `vector_cosine_ops`, matching the `<=>` operator the function below uses.
-- The embeddings are L2-normalised by the model, so cosine distance and inner
-- product would rank identically — but the operator class and the operator MUST
-- agree or Postgres silently ignores the index and sequentially scans every
-- row. That is a performance cliff with no error attached.
--
-- Parameters left at defaults (m=16, ef_construction=64). At a few thousand
-- chunks the defaults are well past sufficient, and tuning them without a
-- corpus to measure against is guessing.

create index if not exists message_chunks_embedding_idx
  on message_chunks using hnsw (embedding vector_cosine_ops);

-- Retrieval always filters by owner before it ranks, and RLS adds that filter
-- to every query. Without this the planner has to choose between using the
-- vector index and using the owner filter; with it, it can do both.
create index if not exists message_chunks_owner_idx
  on message_chunks (owner_id);

comment on column message_chunks.embedding is
  'multilingual-e5-small, 384d, L2-normalised, written with the "passage: " '
  'prefix. ⚠ A query vector must be produced by the SAME model with the '
  '"query: " prefix — mixing models or prefixes does not error, it just ranks '
  'badly. See packages/ai/src/embed.ts.';

-- ── The retrieval function ──────────────────────────────────────────────────
--
-- ⚠⚠ SECURITY INVOKER, for the same reason `search_messages` is (migration
-- 0007). A function reachable over PostgREST is callable by any signed-in user
-- with any arguments they choose. Declared SECURITY DEFINER it would run as its
-- owner, RLS would not apply, and one tenant could read every other tenant's
-- private client mail through an RPC — the failure ADR-009 calls Critical.
--
-- There is deliberately no `owner_id` parameter. A tenant key supplied by the
-- client is the one thing this system never accepts.
--
-- ── Why it returns a SIMILARITY and not a distance ──────────────────────────
--
-- `<=>` is cosine DISTANCE: 0 is identical, 2 is opposite. Every threshold in
-- the application is expressed as a similarity, where 1 is identical, because
-- ADR-007's rule is "drop anything below a floor" and a floor on a distance
-- reads backwards. Converting once, here, means no call site can get the
-- direction wrong — and getting it wrong would invert the refusal path into
-- returning only the *least* relevant messages.
--
-- ── Why it resolves to messages rather than returning chunks ────────────────
--
-- `docs/02-ARCHITECTURE.md` §4: "Retrieval matches chunks but always surfaces
-- and cites the *message*." A long email can put three chunks in the top ten
-- and crowd out three other messages, so the rows are collapsed per message,
-- keeping each message's best-scoring chunk.

create or replace function public.match_chunks(
  query_embedding vector(384),
  match_count     integer default 12,
  min_similarity  real    default 0.0,
  channel_ids     uuid[]  default null
)
returns table (
  message_id  uuid,
  chunk_index integer,
  content     text,
  similarity  real,
  subject     text,
  body_text   text,
  sent_at     timestamptz,
  direction   text,
  channel_id  uuid,
  sender_name text,
  sender_ref  text
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with scored as (
    select
      mc.message_id,
      mc.chunk_index,
      mc.content,
      -- 1 - cosine_distance = cosine similarity, for normalised vectors.
      (1 - (mc.embedding <=> query_embedding))::real as similarity
    from message_chunks mc
    where mc.embedding is not null
    -- ⚠ ORDER BY on the raw distance operator, not on the derived similarity.
    -- The HNSW index can only serve `embedding <=> $1`; ordering by
    -- `1 - (embedding <=> $1)` is an expression the index cannot answer, so the
    -- planner falls back to a sequential scan over every chunk. It still
    -- returns correct rows, which is what makes it easy to ship by accident.
    order by mc.embedding <=> query_embedding
    -- Over-fetch before collapsing per message: several chunks of one long
    -- email can otherwise fill the whole result and hide other messages.
    limit greatest(match_count * 4, 40)
  ),
  best as (
    select distinct on (s.message_id)
      s.message_id, s.chunk_index, s.content, s.similarity
    from scored s
    order by s.message_id, s.similarity desc
  )
  select
    b.message_id,
    b.chunk_index,
    b.content,
    b.similarity,
    m.subject,
    left(m.body_text, 2000),
    m.sent_at,
    m.direction,
    m.channel_id,
    ci.display_name,
    ci.external_id
  from best b
  join messages m on m.id = b.message_id
  left join contact_identities ci on ci.id = m.sender_identity
  where b.similarity >= min_similarity
    and (channel_ids is null or m.channel_id = any (channel_ids))
  order by b.similarity desc
  limit greatest(1, least(coalesce(match_count, 12), 50));
$$;

comment on function public.match_chunks is
  'Semantic retrieval for the assistant (US-6). SECURITY INVOKER — RLS scopes '
  'it to the caller; never change that. Returns cosine SIMILARITY (1 = best), '
  'collapsed to one row per message. The query vector must come from '
  'multilingual-e5-small with the "query: " prefix.';

revoke all on function public.match_chunks(vector, integer, real, uuid[])
  from public, anon;

grant execute on function public.match_chunks(vector, integer, real, uuid[])
  to authenticated;

-- No RLS change. `message_chunks` has carried a tenant_isolation policy since
-- migration 0002; a new index and a SECURITY INVOKER function inherit it.
-- `packages/db/scripts/assert-rls.ts` is what proves that on every push.

-- 0010_search_summaries
--
-- Phase 3 fix: search results carry their AI summary, exactly as the timeline
-- does (US-4, ADR-015).
--
-- ── The defect this closes ──────────────────────────────────────────────────
--
-- `fetchTimeline` embeds `extractions` and renders the summary in an opened row.
-- `search_messages` returns no such column, so **the same message showed
-- different information depending on which screen you found it on** — a summary
-- in the timeline, nothing in search. On a console whose premise is one record
-- of everything, a row that changes what it knows depending on the route you
-- arrived by is the kind of inconsistency that quietly teaches people not to
-- trust it.
--
-- ── ⚠ Why this DROPS the function instead of replacing it ───────────────────
--
-- `create or replace function` **cannot change a RETURNS TABLE**; Postgres
-- rejects it with "cannot change return type of existing function". So the
-- function is dropped and recreated, and that has one consequence which is easy
-- to miss and silent when missed: **DROP takes the grants with it.** Without the
-- `revoke`/`grant` block at the bottom, `authenticated` loses EXECUTE, PostgREST
-- answers every search `42501`, and search breaks for every user while the
-- migration reports success. The grants are therefore part of this migration,
-- not an afterthought.
--
-- ⚠ Everything else about the function is deliberately unchanged and must stay
-- that way — the header of `0007_message_search.sql` is the reasoning, and all
-- of it still holds:
--
--   · **SECURITY INVOKER.** As DEFINER it would run as its owner, RLS would not
--     apply, and any signed-in user could read every tenant's private mail
--     through an RPC. This is the failure ADR-009 calls Critical.
--   · **'simple', never 'english'.** The corpus is Taglish; an English stemmer
--     mangles it and strips "at", which is Tagalog for "and".
--   · **Two query modes.** `to_tsquery` raises on malformed input, so raw user
--     text only ever reaches `websearch_to_tsquery`.
--   · **STX/ETX headline delimiters**, so a message body never reaches
--     `dangerouslySetInnerHTML`.
--   · **No direction filter.** A self-sent message is outbound and is the one
--     the demo depends on.
--
-- Applied by hand. ⚠ `drizzle-kit generate` is NOT used on this project — run
-- against the live database it proposed disabling RLS on all ten tables and
-- dropping every tenant_isolation policy. See packages/db/drizzle.config.ts.

drop function if exists public.search_messages(
  text, boolean, uuid[], uuid[], timestamptz, timestamptz, integer, integer
);

create function public.search_messages(
  q            text        default null,
  prefix       boolean     default false,
  channel_ids  uuid[]      default null,
  contact_ids  uuid[]      default null,
  sent_from    timestamptz default null,
  sent_to      timestamptz default null,
  max_rows     integer     default 50,
  skip         integer     default 0
)
returns table (
  id                  uuid,
  direction           text,
  subject             text,
  body_text           text,
  sent_at             timestamptz,
  channel_id          uuid,
  sender_external_id  text,
  sender_display_name text,
  snippet             text,
  rank                real,
  -- New in 0010. Null is the ORDINARY case, not a failure: messages under 280
  -- characters are deliberately never summarised, and a Groq outage degrades to
  -- null rather than to no mail.
  summary_text        text,
  summary_model       text
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with q as (
    select case
      when q is null or btrim(q) = '' then null
      when prefix                     then to_tsquery('simple', q)
      else                                 websearch_to_tsquery('simple', q)
    end as ts
  )
  select
    m.id,
    m.direction,
    m.subject,
    -- Bounded for the same reason lib/timeline.ts bounds it: every body in the
    -- result set is serialised into the page whether or not its row is opened,
    -- and a real inbox contains newsletters.
    left(m.body_text, 4000),
    m.sent_at,
    m.channel_id,
    ci.external_id,
    ci.display_name,
    case
      when q.ts is null then null
      else ts_headline(
        'simple',
        -- Headline over subject + body so a hit in the subject is shown as one.
        coalesce(m.subject || ' — ', '') || m.body_text,
        q.ts,
        'StartSel=' || chr(2) || ',StopSel=' || chr(3) ||
        ',MaxFragments=2,MinWords=6,MaxWords=18,FragmentDelimiter= … '
      )
    end,
    case
      when q.ts is null then 0::real
      -- ts_rank_cd rather than ts_rank: cover density rewards matches that sit
      -- NEAR each other, which is what makes a two-word search find the
      -- sentence containing both rather than the longest document mentioning
      -- either. Normalisation 32 divides by (rank+1) so a long newsletter does
      -- not outrank a short reply purely by containing the term more often.
      else ts_rank_cd(m.search_vector, q.ts, 32)
    end,
    ex.payload ->> 'text',
    ex.model
  from messages m
  cross join q
  -- LEFT join: sender_identity is nullable, and a message whose sender row was
  -- removed must still be findable. An inner join would silently drop it.
  left join contact_identities ci on ci.id = m.sender_identity
  -- ⚠⚠ LEFT, and the `kind` filter belongs in the JOIN condition, not the WHERE.
  --
  -- Both halves of that are load-bearing and both fail the same way — by hiding
  -- messages rather than by erroring:
  --
  --   · An INNER join would return only messages that HAVE a summary, which is
  --     66 of 76. Search would silently lose ten messages, and a console that
  --     promises to find everything must not.
  --   · Moving `ex.kind = 'summary'` into the WHERE clause turns this back into
  --     an inner join in effect, because an unmatched LEFT join yields
  --     `ex.kind IS NULL`, which fails the predicate. This is the classic
  --     LEFT-join-with-a-WHERE-on-the-right-table mistake and it is invisible
  --     until someone counts the rows.
  --
  -- The filter is needed at all because Phase 5 writes other kinds to this same
  -- table (ADR-006) — a meeting extraction must never render where a summary
  -- belongs. Migration 0008's partial unique index guarantees at most one
  -- summary row per message, so this cannot multiply results.
  --
  -- RLS still applies to `extractions` here: the function is SECURITY INVOKER,
  -- so a tenant can only ever join to their own summaries.
  left join extractions ex
    on ex.message_id = m.id
   and ex.kind = 'summary'
  where
        (q.ts is null or m.search_vector @@ q.ts)
    and (channel_ids is null or m.channel_id = any (channel_ids))
    and (contact_ids is null or ci.contact_id = any (contact_ids))
    and (sent_from   is null or m.sent_at >= sent_from)
    and (sent_to     is null or m.sent_at <= sent_to)
    -- ⚠ NO DIRECTION FILTER, here as everywhere. A self-sent message is
    -- `outbound` and it is the one the demo depends on. lib/timeline.ts.
  order by
    -- Relevance first when there is a query, recency always as the tiebreak.
    -- With no query this collapses to a pure `sent_at desc` browse, which is
    -- what makes one function serve both search and filtered browsing instead
    -- of two implementations of the same filters drifting apart.
    case when q.ts is null then 0::real else ts_rank_cd(m.search_vector, q.ts, 32) end desc,
    m.sent_at desc
  limit  greatest(1, least(coalesce(max_rows, 50), 200))
  offset greatest(0, coalesce(skip, 0));
$$;

comment on function public.search_messages is
  'Cross-channel keyword search (US-4). SECURITY INVOKER — RLS scopes it to the '
  'caller; never change that. Pass prefix=true only with a tsquery string built '
  'by lib/search.ts, never with raw user input. Returns the message''s AI '
  'summary (0010) so a result row shows what the timeline shows; summary_text '
  'is NULL for the majority of messages, which is correct.';

-- ⚠ Re-granted because DROP removed the old grants. Without this block the
-- function exists and nobody may call it: PostgREST answers `42501` and search
-- is broken for every signed-in user while the migration looks like it worked.
--
-- `anon` stays deliberately absent — RLS would return them nothing anyway, but a
-- function an unauthenticated caller cannot invoke at all is one fewer surface.
revoke all on function public.search_messages(
  text, boolean, uuid[], uuid[], timestamptz, timestamptz, integer, integer
) from public, anon;

grant execute on function public.search_messages(
  text, boolean, uuid[], uuid[], timestamptz, timestamptz, integer, integer
) to authenticated;

-- No RLS change. `messages`, `contact_identities` and `extractions` have each
-- carried a tenant_isolation policy since migration 0002, and a SECURITY INVOKER
-- function inherits all three. `packages/db/scripts/assert-rls.ts` is what proves
-- that on every push rather than this comment.

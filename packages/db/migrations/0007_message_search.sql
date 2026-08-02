-- 0007_message_search
--
-- Phase 3: keyword search across every channel at once (US-4).
--
-- Two things land here: a generated `tsvector` on `messages`, and a
-- `search_messages` function that ranks, snippets and filters. Both need
-- explaining, because both had a plausible-looking alternative that is wrong.
--
-- ── Why 'simple' and not 'english' ───────────────────────────────────────────
--
-- The corpus is **Taglish**. Postgres ships no Tagalog text-search
-- configuration and there is no credible one to install, so the real choice is
-- between an English stemmer applied to code-switched text and no stemmer at
-- all.
--
-- 'english' would stem English words correctly (deadlines → deadlin) and then
-- apply the same Porter rules to Tagalog words, which are not English and do
-- not decompose that way. It would also strip the English stopword list — and
-- "at" is both an English preposition and the Tagalog word for "and", so a
-- phrase search containing it would silently lose a term. The failure mode is
-- the one docs/03-RESOURCES.md §4c warns about for the embedding model: it does
-- not error, it just returns the wrong rows, and it reads as a ranking bug.
--
-- 'simple' lower-cases and de-duplicates and does nothing else. Every token in
-- the message is findable by typing it exactly. The cost is that "deadline"
-- does not match "deadlines" — mitigated by `prefix` below, which is the
-- typeahead behaviour people expect anyway.
--
-- ── Why a GENERATED column and not a trigger ─────────────────────────────────
--
-- A trigger has to be remembered on every write path. `persistMessage` upserts,
-- the backfill script will insert, and Phase 4 may rewrite bodies — a generated
-- column is maintained by Postgres on all of them, including the ones nobody
-- has written yet. `to_tsvector(regconfig, text)` is IMMUTABLE in its two-
-- argument form, which is what makes this legal; the one-argument form is only
-- STABLE (it reads a GUC) and Postgres rejects it here.
--
-- `subject` is concatenated ahead of the body deliberately. Half this timeline
-- has no subject at all — email has one, chat does not — so coalesce, not
-- concat, or a null subject would null the entire vector and make every chat
-- message unsearchable. That is exactly the silent-unsearchable failure
-- docs/02-ARCHITECTURE.md §2 spends a paragraph refusing for `body_text`.
--
-- Applied by hand. ⚠ `drizzle-kit generate` is NOT used on this project — run
-- against the live database it proposed disabling RLS on all ten tables and
-- dropping every tenant_isolation policy. See packages/db/drizzle.config.ts.

alter table messages
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('simple', coalesce(subject, '') || ' ' || body_text)
  ) stored;

comment on column messages.search_vector is
  'Full-text index over subject + body_text, ''simple'' config (no stemming — '
  'the corpus is Taglish and an English stemmer mangles it). Generated, so it '
  'cannot drift from the columns it summarises. Query it through '
  'search_messages(), not directly.';

-- GIN, not GiST: GIN is slower to update and far faster to search, and this
-- column is written once per message and read on every search.
create index if not exists messages_search_idx
  on messages using gin (search_vector);

-- ── The search function ──────────────────────────────────────────────────────
--
-- ⚠⚠ SECURITY INVOKER, AND THAT IS THE WHOLE POINT.
--
-- A function reachable over PostgREST is reachable by any signed-in user with
-- any arguments they like. Declared SECURITY DEFINER it would run as its owner
-- and RLS would not apply — one tenant could read every other tenant's private
-- client mail by calling an RPC, and no policy in this database would stop it.
-- That is the exact failure ADR-009 calls Critical on the risk register.
--
-- SECURITY INVOKER (the default, stated explicitly here so nobody "tidies" it)
-- runs the body as the caller, so `tenant_isolation` on `messages` and
-- `contact_identities` applies inside the function exactly as it does outside.
-- There is deliberately NO owner_id parameter and no owner_id filter: a filter
-- would imply the policy might not be doing its job, and an owner_id parameter
-- would be a tenant key supplied by the client, which is the one thing this
-- system never does.
--
-- `set search_path = public, pg_catalog` pins resolution so a user-created
-- schema earlier on someone's search_path cannot shadow a function this body
-- calls.
--
-- ── Why two query parameters instead of one ──────────────────────────────────
--
-- `to_tsquery` RAISES on malformed input — `'a &'` is a syntax error, and user
-- typing reaches this. `websearch_to_tsquery` never raises and understands
-- "quoted phrases", `or`, and `-exclusions`, but it cannot express a prefix
-- match, so "deadlin" finds nothing under the 'simple' config.
--
-- So: `q` carries what the person typed and is parsed with websearch_to_tsquery
-- when `prefix` is false. When `prefix` is true, `q` is a tsquery string the
-- console BUILT from stripped word characters (lib/search.ts), which cannot be
-- malformed because nothing that is a tsquery operator survives the strip. One
-- function, both behaviours, and the raising parser only ever sees machine
-- input.
--
-- ── Why the snippet is delimited with control characters ─────────────────────
--
-- `ts_headline`'s default StartSel/StopSel are `<b>`/`</b>`, and rendering that
-- means putting attacker-controlled message text through
-- `dangerouslySetInnerHTML`. Every body in this table was written by somebody
-- else. STX (\x02) and ETX (\x03) cannot occur in a real message, survive JSON
-- transport, and let the console split on them and render <mark> as React
-- elements — so highlighting is XSS-proof by construction rather than by
-- sanitiser.

create or replace function public.search_messages(
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
  rank                real
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
    end
  from messages m
  cross join q
  -- LEFT join: sender_identity is nullable, and a message whose sender row was
  -- removed must still be findable. An inner join would silently drop it.
  left join contact_identities ci on ci.id = m.sender_identity
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
  'by lib/search.ts, never with raw user input.';

-- PostgREST exposes functions to whichever roles hold EXECUTE. `authenticated`
-- is the signed-in user; `anon` is deliberately absent — RLS would return them
-- nothing anyway, but a function an unauthenticated caller cannot invoke at all
-- is one fewer surface to reason about.
revoke all on function public.search_messages(
  text, boolean, uuid[], uuid[], timestamptz, timestamptz, integer, integer
) from public, anon;

grant execute on function public.search_messages(
  text, boolean, uuid[], uuid[], timestamptz, timestamptz, integer, integer
) to authenticated;

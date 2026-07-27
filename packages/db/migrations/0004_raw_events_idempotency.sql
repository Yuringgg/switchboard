-- 0004_raw_events_idempotency
--
-- `raw_events` had no unique constraint — only its primary key. Every other
-- table on the ingest path carries an idempotency guard:
--
--   messages       unique (channel_id, external_id)
--   conversations  unique (channel_id, external_thread_id)
--   message_chunks unique (message_id, chunk_index)
--
-- raw_events was missed, and it is the FIRST table a redelivery touches.
--
-- Pub/Sub guarantees at-least-once delivery and redelivers whenever an ack is
-- slow or lost, so duplicates are not an edge case — they are normal operation.
-- Without this, one notification becomes N queued events, the worker polls
-- history N times, and the only thing standing between that and N duplicate
-- rows is the guard on `messages` one layer down. Relying on it means doing the
-- work N times to reach the same result, and it leaves the queue permanently
-- padded with events that were never distinct.
--
-- external_id is Pub/Sub's `message.messageId`, which is stable across
-- redeliveries of the same notification.
--
-- Applied by hand rather than generated. `drizzle-kit generate` is not used on
-- this project — see packages/db/drizzle.config.ts.

-- Partial, because external_id is nullable and NULLs are never equal in a
-- unique index anyway — being explicit documents that a null-keyed event is
-- deliberately un-deduplicated rather than accidentally so.
create unique index raw_events_channel_external_key
  on raw_events (channel_id, external_id)
  where external_id is not null;

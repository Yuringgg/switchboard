-- 0019 — Which messages have had their files saved (Ms. Maria's research task 5)
--
-- Task 5: "routing documents directly into database folders without manual
-- file downloads." The worker's file sweep downloads each real attachment
-- from Gmail into Azure Blob (ADR-004, container `attachments`, provisioned
-- 2026-08-03) and writes one `attachments` row per file (0001).
--
-- This table records that the sweep has DONE a message, which is not the same
-- as "it found a file": a message whose only attachment is a signature logo or
-- a calendar invite is done with zero files saved. Without this row the sweep
-- would re-download it every pass, forever. The same reason
-- `message_extraction_runs` (0011) exists, and the same shape.
--
-- `attachments.blob_url` holds the blob NAME (`<owner>/<message>/<n>-<file>`),
-- not a URL: the container is private (`allowBlobPublicAccess: false`), and a
-- readable link is minted per request, for five minutes, by the console.

create table if not exists message_attachment_runs (
  message_id    uuid        primary key references messages(id) on delete cascade,
  owner_id      uuid        not null references auth.users(id) on delete cascade,
  files_saved   integer     not null default 0 check (files_saved >= 0),
  files_skipped integer     not null default 0 check (files_skipped >= 0),
  created_at    timestamptz not null default now()
);

create index if not exists message_attachment_runs_owner_idx
  on message_attachment_runs (owner_id);

comment on table message_attachment_runs is
  'One row per message the file sweep has finished. files_saved = 0 is an '
  'ordinary outcome (logos, invites and oversized files are skipped). Presence '
  'is what stops the sweep downloading the same message again.';

comment on column attachments.blob_url is
  'The blob NAME in the private `attachments` container, e.g. '
  '<owner>/<message>/<n>-<file>. Not a URL: the console mints a five-minute '
  'read link per request (0019).';

alter table message_attachment_runs enable row level security;
alter table message_attachment_runs force row level security;

create policy tenant_isolation on message_attachment_runs
  for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- 0020 — What a saved file SAYS: a PDF's text, a recording's transcript
--
-- Yuri, 2026-10-06: Uriel could name a file but not read it. The worker's file
-- sweep (0019) now reads what it saves — the text layer of a PDF (`unpdf`, on
-- the worker) and a transcript of an audio recording (Groq Whisper, the model
-- the voice lab already uses) — and keeps it on the file's own row, so the
-- Files page, Uriel and the tenant boundary all come with it for free.
--
-- Pictures are NOT read: that needs a vision model, and is a separate decision.
--
-- `text_status` is null until the reader has tried the file. Its values:
--   done      — `text_content` holds what it says
--   empty     — read fine, nothing in it (a scanned PDF, a silent recording)
--   failed    — the reader refused it for good (a broken file, a format Groq
--               will not take); a transient failure (rate limit, network)
--               writes nothing and is retried on a later pass
--   too_large — over the reader's size limit
--
-- `text_preview` is the first few hundred characters, so the Files page can
-- show what a file says without selecting every file's whole text.

alter table attachments
  add column if not exists text_content text,
  add column if not exists text_preview text,
  add column if not exists text_kind    text
    check (text_kind in ('pdf_text', 'transcript')),
  add column if not exists text_status  text
    check (text_status in ('done', 'empty', 'failed', 'too_large')),
  add column if not exists text_model   text,
  add column if not exists text_read_at timestamptz;

-- The reader's queue: files not yet tried. Partial, so it stays tiny.
create index if not exists attachments_text_pending_idx
  on attachments (owner_id)
  where text_status is null;

comment on column attachments.text_content is
  'What the file says: a PDF''s text layer or a recording''s transcript, '
  'capped at 100,000 characters. Written by the worker (0020). Null until read, '
  'and for pictures, which are not read.';
comment on column attachments.text_preview is
  'The first ~400 characters of text_content, for the Files page.';
comment on column attachments.text_status is
  'null = not tried yet; done / empty / failed / too_large (0020).';

-- No new policy: `attachments` already has tenant_isolation (0002), and new
-- columns are covered by it.

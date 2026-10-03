# Gmail Spam was being ingested — fixed

*Written 2026-10-04. Newer than everything in `docs/`.*

Yuri found an OnlyFans email on the console ("OnlyFans is updating its Terms
of Service…", 3 Oct) and had never seen it in Gmail.

## What happened

- It is a genuine OnlyFans system notice (DKIM and SPF pass for
  notify.onlyfans.com, sent through SendGrid) to leiruychua@gmail.com, and
  **Gmail filed it in Spam** — `labelIds: UNREAD, CATEGORY_UPDATES, SPAM`.
  That is why it never appeared in the inbox. Terms-of-service notices go to
  every address registered on a site, and a site can be signed up to with
  somebody else's address; nothing in the message says Yuri did anything.
- **Switchboard ingested Gmail's Spam.** The watch is INBOX-only, but
  `history.list` returns every message *added to the mailbox*, and Spam is in
  the mailbox. **100 of 456** of Yuri's messages came from Spam — 77 LinkedIn,
  the rest service mail, and this one. They reached the timeline, contacts,
  the board (100 extraction rows) and Uriel's answers. No files.

## The fix

- `isJunk(labelIds)` in `packages/adapters/gmail/src/normalize.ts`: SPAM or
  TRASH. Not "INBOX only" — sent mail has SENT and no INBOX and belongs on the
  timeline.
- `apps/worker/src/gmail-ingest.ts` skips junk before anything is stored.
- `apps/worker/src/file-sweep.ts` never downloads attachments from junk.
- Tests: `isJunk` keeps INBOX, SENT and unlabelled mail and drops SPAM/TRASH.

## ⚠ The 100 already stored — Yuri's to delete

Permanent deletion was left to Yuri. The SQL given to Yuri (Supabase SQL
editor) deletes, for leiruychua@gmail.com only: every stored message Gmail had
filed as spam (cascading to chunks, extractions and run rows) and the 13
contacts whose ONLY messages were spam. In Gmail, the original is in the Spam
folder; Gmail empties Spam after 30 days, or "Delete forever" does it now.

⚠ A message moved to Spam AFTER it was ingested is not removed — the worker
only reads `messageAdded`. Rare; not handled.

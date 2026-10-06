# Uriel can see files

*Written 2026-10-06. Newer than everything in `docs/`.*

Yuri: *"can you check why uriel cant reach files or sent pics, pdf's, etc., in
gmail? it is showing in switchboard but somehow uriel cant see them."*

## Why it could not

The worker saves Gmail attachments to the `attachments` table (ADR-030), and
only the Files page read that table. All five voice tools read `messages`, so
Uriel never knew an email had a file, and nothing could answer "what did Bea
send me?".

## What changed (`apps/console/src/lib/voice/tools.ts`)

1. **Every message a tool returns names its files** —
   `get_recent_messages`, `search_messages` and `get_person_activity` embed
   `attachments(filename, mime_type)` and add `files: [{ name, kind }]` to any
   message that has one (`kind` is spoken: "a PDF", "a picture", "a Word
   document"…; `spokenFileKind`).
2. **`search_messages` also matches file NAMES** — a second query
   (`attachments!inner` + `ilike` on `attachments.filename`), merged by id,
   because PostgREST cannot OR a message's columns with its files' columns.
3. **A sixth tool, `get_files`** — files newest first, optionally one
   person's (`person_id` from `resolve_person`) or matching a word in the file
   name or the email subject. Up to ten, each with name, kind, who sent it
   ("you" for your own), when, and the email's subject.

Every new read filters `owner_id` by hand, on the messages AND on
`attachments.owner_id` — this path is service-role (see the top of
`tools.ts`). Tests assert both.

⚠ **Names and kinds only, never contents.** Nothing reads what is inside a PDF
or a picture; the prompt below says so, so Uriel points at the Files page
instead of guessing from a file name. ⚠ Only Gmail attachments are saved;
WhatsApp media is not.

## Checked

Read-only against the live database with the service key, as the webhook
runs: `get_files` returned Yuri's ten latest (nine pictures, a PDF); the other
tenant got "No files have been saved yet"; a name search ("pdf") matched three
files; one sender's files and their activity both carried the file. 40 voice
tests pass (13 new).

## ⚠ Yuri has to paste this into Vapi — the code alone changes nothing

Vapi holds its own copy of the tools and prompt (`docs/03-RESOURCES.md` §4d).
Until these are pasted, Uriel still sees file names on messages (step 1 needs
no paste) but cannot call `get_files`.

### A. Create the tool — Dashboard → Tools → Create Tool → Function

- **Name:** `get_files`
- **Description:**
  `Files saved from the person's email — pictures, PDFs, documents — newest first. Use for "what files did Bea send me", "any PDFs", "the invoice she attached". For one person's files, call resolve_person first and pass their person_id. Returns each file's name, kind, who sent it and when. It cannot open a file or read what is inside it.`
- **Parameters** (both type string, both NOT required, no enum):
  - `person_id` — `Optional. The personId from resolve_person, to list only files that person sent.`
  - `query` — `Optional. A word from the file's name or the email's subject, like "invoice" or "pdf".`
- **Server:** the same Server URL and credential as `get_recent_messages`
  (copy them from it).
- **Async, Strict, Lock schema:** all off, like the other five.
- Save, then **Published** (top right).
- Open the **assistant** → Tools → add `get_files` → publish the assistant.

### B. Optional — `search_messages` description

Append: ` Also matches the names of files attached to a message.`
(then Published).

### C. The prompt — two edits

In **# Tools you have access to**, add the line:

```
- get_files: files saved from email — pictures, PDFs, documents — by person or by name
```

Change *"You cannot look at a calendar, join a meeting, or send anything."* to:

```
You cannot look at a calendar, join a meeting, open a file, or send anything.
```

And add this section just before **# Rules, in order of importance**:

```
# Files

Messages from the other tools may list files they carry. Mention them when
they matter: "She attached a PDF, the August invoice."

Use get_files when the question is about files themselves. For one person's
files, call resolve_person first and pass their person_id.

You know a file's name, what kind it is, who sent it and when. You do NOT know
what is inside it. Never guess what a file says from its name. If asked, say
you can't open files yet and that it is on the Files page in Switchboard.
Say a name the way a person would — "the INV-2207 PDF" — not letter by letter,
and skip the extension.
```

`correspondence/2026-09-10-vapi-agent-prompt.md` §2 has these edits applied —
it stays the source of truth for the whole prompt.

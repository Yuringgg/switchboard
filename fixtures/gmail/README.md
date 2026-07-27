# fixtures/gmail

Gmail message resources as `users.messages.get?format=full` returns them.

**Structure is real; content is not.** The part trees, header sets and field
types here were taken from a live inbox on 2026-07-27 — then every address,
subject, body and identifier was replaced. That split is deliberate: the shapes
are what `normalize` has to survive, and none of them are things I could have
reliably invented. The words are what must never be committed.

Three of these mirror messages observed in a real mailbox:

| Fixture | Real structure it mirrors |
|---|---|
| `multipart-alternative.json` | `multipart/alternative > text/plain + text/html` — a self-sent message, labelled both SENT and INBOX |
| `nested-html-only.json` | `multipart/mixed > multipart/related > text/html` — **no text/plain at all** |
| `bare-html.json` | a top-level `text/html` payload with no parts |

The rest cover cases that will arrive eventually and are cheaper to handle now:
attachments alongside inline images, quoted display names containing commas,
and a missing `From`.

## Why HTML-only matters more than it looks

**Two of the three real messages had no `text/plain` part.** `messages.body_text`
is `NOT NULL`, so an adapter that only reads `text/plain` fails on the majority
of ordinary mail — and fails at insert time, far from the cause. `normalize`
converts HTML when no text part exists, and `nested-html-only.json` and
`bare-html.json` are what keep that honest.

## Adding a fixture

Record from a real message, then scrub: addresses, display names, subject,
body, `id`, `threadId`, `historyId`, `attachmentId`. Keep the part tree, mime
types, header names and field types exactly as received — those are the point.

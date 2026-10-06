# Uriel reaches the rest of Switchboard

*Written 2026-10-06. Newer than everything in `docs/`. Follows
`2026-10-06-uriel-files.md` the same evening.*

Yuri: *"can you also make uriel reach everything in switchboard"*.

## What was on screen and not in Uriel's reach

| On screen | Uriel before | Now |
|---|---|---|
| A long message's summary | read the first 200 characters (often a greeting) | `aiSummary` on every message any tool returns |
| A whole message | impossible | **`read_message`** (new) — summary, text up to 1,500 characters, files, what went on the board |
| The board's columns, calendar marks, sender | title and quote only | each item says its column, `onCalendar`, `from`, `messageId` |
| Done items | never | `get_attention_items` with `status: "done"` |
| A contact's brief (company, role, relationship, open items) | last five messages only | `get_person_activity` adds `about` and `openWithThem` |
| Channels, counts, files, contacts | nothing | **`get_overview`** (new) |
| Files | nothing | `get_files` and `files` on messages (earlier note) |

## How (`apps/console/src/lib/voice/tools.ts`)

- **Summaries** are embedded beside each message
  (`gist:extractions!extractions_message_id_fkey(kind, payload)`, filtered
  `gist.kind = summary` and `gist.owner_id`), so no extra round trip.
- **The brief** reuses `lib/brief.ts`'s pure roll-ups (`rollUpAffiliations`,
  `openItems`, `nameTokens`), so Uriel and the contact page name the same
  company and the same open items. Only the reads are new — owner-filtered,
  bounded at 100 conversations / 100 messages, run in parallel with the
  activity read, and a failure costs the brief, never the answer.
- **`read_message`** takes a `messageId` from any other tool's results; every
  message, board item and file now carries one.
- **`get_overview`** counts per channel TYPE (two Gmail accounts are one line
  to a listener) on Manila days, and says a broken channel in plain words
  ("needs reconnecting in Channels"), never its `last_error`.

⚠ Every new read filters `owner_id` by hand (service role). Tests assert it
for each tool; checked live, `read_message` and `get_overview` run as the other
tenant see nothing of Yuri's.

## Still out of reach, on purpose

- **What is inside a file** — no file is read; names and kinds only.
- **Sending, moving cards, booking the calendar** — Uriel is read-only
  (prompt rule 4). Calendar write-back stays confirm-on-screen (ADR-020).
- **Search by meaning** — the console's semantic search RPC takes no owner
  argument and relies on RLS, which is inert here. Word search only, until the
  RPC takes an explicit owner.

## Checked

801 tests pass (+9). Live, read-only, as the webhook runs: recent messages all
carry ids and 12 of 20 a summary; "OpenAI refund" finds three, all with
summaries; 12 open items and 6 done; a contact's activity carries an open item;
`read_message` opens the refund email; the overview says every channel is
connected, four messages today, 12 open, 28 files, 83 contacts.

## ⚠ Yuri has to paste this into Vapi

Without these, Uriel already gets the summaries, columns, brief and message
ids (no paste needed), but cannot call the two new tools or ask for done work.

### A. Create `read_message` — Tools → Create Tool → Function

- **Description:**
  `One whole message: who sent it, when, its summary, its text, its files, and what was put on the board from it. Use when the user wants a message read out or explained. Takes the messageId from any other tool's results — never ask the user for it.`
- **Parameter** `message_id` — string, **Required ticked**, no enum:
  `The messageId of a message from another tool's results.`
- Server URL and credential: same as the others. Async, Strict, Lock schema
  off. **Publish.**

### B. Create `get_overview` — Tools → Create Tool → Function

- **Description:**
  `Switchboard at a glance: which channels are connected or need reconnecting, how many messages arrived today and this week on each, how many items are open on the board, and how many files and contacts there are. Use for "how's everything", "is my Gmail connected", "how many emails today".`
- **No parameters.**
- Same server, switches off. **Publish.**

### C. Edit `get_attention_items`

Add a parameter `status` — string, NOT required, no enum:
`Optional. "done" to hear what has been finished. Leave empty for what is still open.`
**Apply**, then **Publish**.

### D. Add both new tools to the assistant, then publish it.

### E. The prompt

Add to **# Tools you have access to**:

```
- read_message: one whole message — its summary, text, files, and what was put on the board from it
- get_overview: Switchboard at a glance — channels, what arrived today and this week, the board, files and contacts
```

And this section just before **# Files**:

```
# Reading a message, and the rest of Switchboard

Every message, board item and file the tools return carries a messageId.
When the user wants a message read out or explained, call read_message with
it. Give the aiSummary first when there is one, then offer the rest. If
truncated is true, say it is long and the full text is in Switchboard.

When a message has an aiSummary, use it to say what the message is about
instead of the excerpt.

get_attention_items says which column each item is in (not started or in
progress), whether it is on the calendar, and who it came from. Pass status
"done" when they ask what they have finished.

get_person_activity also says who a person is (company, role, relationship)
and what is open with them, when Switchboard knows. Use it for "who is Bea"
or "what do I owe Bea". Never invent a company or role it did not return.

Use get_overview for "how's everything", "is my Gmail connected", "how many
emails today", "how many files". If a channel needs reconnecting, tell them
to reconnect it on the Channels page.
```

`correspondence/2026-09-10-vapi-agent-prompt.md` §2 has all of this applied.

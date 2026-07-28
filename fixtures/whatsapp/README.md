# fixtures/whatsapp

WhatsApp Cloud API webhook payloads, as Meta POSTs them to
`/api/webhooks/whatsapp`.

**Structure is documented; content is invented.** Unlike `fixtures/gmail/`,
these were not recorded from a live account — Phase 2 was built before the Meta
test number existed, so the envelopes were taken from Meta's webhook reference
(linked in `docs/03-RESOURCES.md` §2) rather than from traffic.

> ⚠ **Re-record `text.json` and one media fixture against the real test number
> once it is connected**, and note it here. Documentation and reality diverge —
> that is a lesson this project already paid for twice on the Gmail side, where
> header case and part nesting were both wrong until a real inbox corrected
> them. Until then, treat these as a specification of what *should* arrive.

## What each one is for

| Fixture | The case it holds |
|---|---|
| `text.json` | the ordinary message — the baseline every other test is a deviation from |
| `taglish.json` | code-switched Tagalog/English, `ñ`, an accented name, an emoji |
| `image-with-caption.json` | media whose caption **is** the message's text |
| `image-no-caption.json` | media with **no** text at all — `body_text` is `''`, and that is legal |
| `document.json` | the only media type with a `filename`, and it is non-ASCII |
| `voice-note.json` | `audio` with `voice: true`; the words are in the audio, so there is honestly no text |
| `location.json` | a pin whose `name`/`address` are real, searchable words |
| `reaction.json` | a `reaction` — a message that points at another message |
| `reply-with-context.json` | `context.id` quotes an earlier message. **Not a thread id** |
| `statuses-only.json` | delivery receipts and nothing else — the most common payload in a live account |
| `batch.json` | **the important one.** See below |
| `unsupported.json` | Meta itself could not read it; `errors[]` explains why |
| `other-field.json` | a subscribed field that is not `messages` |

## Why `batch.json` is the important one

Every payload example in Meta's documentation has exactly one entry, one
change, and one message. Written against those, `entry[0].changes[0].value
.messages[0]` passes every test and **silently drops mail in production.**

`batch.json` is the fixture that makes that fail. It carries:

- **two entries**, the second on a *different business number* — so one POST
  can belong to two channels and, in a multi-tenant system, two owners
- **two changes in one entry**, the second easily missed
- **two messages in one change, from different senders** — which is also what
  proves `contacts` is matched by `wa_id` rather than by position
- **a `statuses` array alongside `messages` in the same change**, so the
  status branch cannot be written as "either/or"

Four messages come out of it. Any indexing shortcut yields one.

## The rules these encode

**Unix seconds, as a string.** `timestamp` is `"1785240000"`, not
milliseconds and not a number. Read as milliseconds it places every message in
January 1970 — which sorts correctly among itself, so a timeline of only
WhatsApp messages looks fine.

**`phone_number_id` is the tenant key, `display_phone_number` is for humans.**
The id is opaque and stable; the display number is a formatted string. See
`samePhoneNumber` in `packages/core/src/phone.ts`.

**No bytes.** Media arrives as an `id` to be exchanged for a short-lived URL
against the Graph API. `normalize` is pure, so it emits an `AttachmentRef` and
stops. Download lands in Phase 3 with Gmail's.

## Adding a fixture

Keep the **full four-level envelope** — `object → entry[] → changes[] → value`
— even when testing one field. Half the bugs this directory exists to catch are
in the envelope, not the message.

Scrub `wa_id`, `from`, `recipient_id`, profile names, `sha256`, media `id`, and
message bodies. Keep `wamid.` prefixes, timestamp format, mime types, and the
`field` name exactly as received.

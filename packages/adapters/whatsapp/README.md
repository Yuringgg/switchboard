# packages/adapters/whatsapp

WhatsApp Cloud API channel adapter. **Built second** — pure push, structurally
different from Gmail's hybrid push/pull. That difference was the point: it is
what tested the adapter contract, and what the contract failed (ADR-014).

```
Meta ──webhook──► /api/webhooks/whatsapp   (Vercel, serverless)
                    verify HMAC → parse → look up channel by
                    phone_number_id → insert raw_events → 200
                                        │
                            raw_events = queue
                                        ▼
                    worker: normalize → persistMessage
```

## What is here

| File | Job |
|---|---|
| `src/types.ts` | the payload as Meta sends it, every field optional because none is guaranteed |
| `src/parse.ts` | webhook → one self-contained envelope per message. **Pure** |
| `src/normalize.ts` | envelope → `CanonicalMessage`. **Pure** |
| `src/index.ts` | the `ChannelAdapter` implementation |

Fixtures are in `fixtures/whatsapp/`; read its README before adding one.

## The five things that are easy to get wrong

**1. Every level of the envelope is an array.** `object → entry[] → changes[] →
value → messages[]`. Every example in Meta's documentation has exactly one of
each, so `entry[0].changes[0].value.messages[0]` passes every test written from
the docs and **silently drops mail in production**. `fixtures/whatsapp/batch.json`
is the fixture that fails on it — four messages, two business numbers, one POST.

**2. `phone_number_id` is the tenant key. `display_phone_number` is a label.**
The id is opaque and stable; the display number is formatted for humans. Ingest
matches the id against `channels.external_account_id` and takes `owner_id` from
the row it finds. A miss means **drop the message**, never guess — the worker
runs as `service_role`, so no policy catches a wrong owner.

**3. Timestamps are unix SECONDS, in a string.** Read as milliseconds every
message lands in January 1970 — and sorts correctly among itself, so a timeline
of only WhatsApp messages looks entirely normal.

**4. Most traffic is `statuses`, not messages.** Delivery receipts for messages
the business sent arrive on the same webhook field. They are counted and
dropped. Queue them and every outbound message appears in the timeline twice.

**5. Media is an id, not bytes and not a URL.** Meta delivers a media id to be
exchanged for a short-lived download URL. `normalize` is pure, so it emits an
`AttachmentRef` and stops. Download lands in **Phase 3** with Gmail's, when the
Blob container exists — `messages.payload_raw` holds every reference until then,
so it is a backfill, not a re-ingest.

## `body_text` is synthesised, and `''` is legal

The same settled rule Gmail follows (`docs/02-ARCHITECTURE.md` §2). A photo with
no caption has no text, and the column is `not null`.

What `normalize` deliberately does **not** do is invent one. Writing `"[image]"`
would put a word in `body_text` that nobody sent, and Phase 4 embeds that column
— a corpus salted with machine-written tokens returns them in search results.

A location's name and address, and a contact card's names, *are* used as body
text: those words came from the sender, so embedding them is faithful rather
than invented. A reaction becomes its emoji, and is stored rather than dropped —
a client reacting to a quote is an answer. Filter reactions in the console if
they prove noisy; that decision is reversible, dropping them at ingest is not.

## Two constraints that shape the product, not just the code

- The Cloud API only receives messages sent **to a business number you control**.
  It cannot read existing personal WhatsApp conversations — those are end-to-end
  encrypted with no API. Libraries claiming otherwise (`whatsapp-web.js`,
  Baileys) impersonate WhatsApp Web, violate Meta's terms, and get numbers
  banned. **Do not use them on this project.**
- Numbers belong to the *business*, not the user, so WhatsApp channels are
  **admin-provisioned, not self-serve** — unlike Gmail (ADR-009). There is no
  Connect button; there is `packages/db/scripts/provision-whatsapp.ts`.

Development runs on Meta's free test number: up to 5 verified recipients, no
business verification. Never let a milestone depend on Meta's production
approval.

## No `poll`, and no `sync_state`

Gmail's adapter has `poll`, a cursor, and a watch that expires. This one has
none of them, and a WhatsApp channel's `sync_state` row staying empty is
**correct, not a symptom.** Worth knowing before someone debugs it as one.

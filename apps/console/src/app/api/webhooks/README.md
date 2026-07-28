# Ingest webhooks

**Verify the signature. Insert `raw_events`. Return 200. Nothing else.**

That sentence is the whole contract, and it is load-bearing (ADR-011). Meta and
Google retry a webhook that responds slowly and eventually **disable the
endpoint**. Every millisecond spent here is a millisecond closer to silently
losing the primary ingestion path.

So: no parsing, no normalization, no contact resolution, no LLM calls, no
attachment downloads, no outbound HTTP. All of that is the worker's job and it
happens asynchronously off the `raw_events` queue. The temptation to "just do a
little normalization while we're here" is precisely what this split exists to
prevent — if you feel it, that is the design working.

## The rules, in order

1. **Read the raw body first, and verify against those exact bytes.** Not a
   re-serialised object. `JSON.parse` then `JSON.stringify` will not round-trip
   byte-identically, and the HMAC will not match.
2. **Compare signatures in constant time.** `===` on a signature leaks its
   contents through timing.
3. **An unverified body is attacker-controlled input.** Reject with 401, log the
   rejection, do not parse it.
4. **`owner_id` comes from the `channels` row**, looked up by the provider's
   identifier for the destination. Never from the payload. The worker runs as
   `service_role` and bypasses RLS, so a wrong `owner_id` here puts one tenant's
   messages in another's console and nothing downstream will notice.
5. **Return 200 even for payloads you don't handle.** A 4xx or 5xx to a provider
   for a message type we simply ignore counts as a delivery failure against the
   endpoint's health. **Meta retries for up to 7 days and then disables the
   endpoint**; Pub/Sub throttles the subscription. The only non-2xx answers that
   belong here are **401** for a body that failed verification — that is an
   intruder, not the provider — and **500** for a database fault, which is
   transient and worth a retry.

## One row per message, not per webhook

Gmail's notification describes one mailbox event, so one row. **A WhatsApp POST
can carry several messages** — `entry[] → changes[] → messages[]`, and every
level is genuinely used. Each becomes its own `raw_events` row keyed on its
`wamid`, because that is the only id stable across a redelivery. A row per
webhook would have no such key: a redelivery of a batch where two of three
messages already processed would either re-process all three, or queue the batch
twice under a synthetic id.

Splitting a payload is not parsing it. The message object is copied verbatim.

## Routes

| Route | Channel | Verification | State |
|---|---|---|---|
| `gmail/route.ts` | Gmail via Pub/Sub push | Google OIDC token | live, ingesting real mail |
| `whatsapp/route.ts` | WhatsApp Cloud API | `X-Hub-Signature-256` HMAC | wired; waiting on Meta credentials |

Both return **503 Not Configured** until their channel's credentials exist. That
is deliberate: an endpoint that silently accepts and discards webhooks is worse
than one that says it is not ready. **Unset config must never mean "skip
verification"** — fail closed.

⚠ A verified WhatsApp payload for a number with no provisioned channel returns
**200 and stores nothing**, logging `unknownNumber`. There is no safe default
owner, and inventing one is the single mistake in this system that no RLS policy
can catch. Provision the number: `packages/db/scripts/provision-whatsapp.ts`.

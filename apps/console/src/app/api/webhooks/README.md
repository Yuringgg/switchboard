# Ingest webhooks

**Verify the signature. Insert one `raw_events` row. Return 200. Nothing else.**

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
   endpoint's health.

## Routes

| Route | Channel | Status |
|---|---|---|
| `gmail/route.ts` | Gmail via Pub/Sub push | Phase 1 — verifies the Google OIDC token |
| `whatsapp/route.ts` | WhatsApp Cloud API | Phase 2 — `X-Hub-Signature-256` HMAC |

Both currently return **503 Not Configured** until their channel's credentials
exist. That is deliberate: an endpoint that silently accepts and discards
webhooks is worse than one that says it is not ready.

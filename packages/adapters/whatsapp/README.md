# packages/adapters/whatsapp

**Built second** — pure push, structurally different from Gmail's hybrid
push/pull. That difference is the point: if the adapter interface survives both,
it will survive a third.

Verification is `X-Hub-Signature-256` HMAC, compared **timing-safe**, against the
**raw request bytes** — not a re-serialized object. An unverified body is
attacker-controlled input: reject with 401, log the rejection, do not parse.

**Two constraints that shape the product, not just the code:**

- The Cloud API only receives messages sent **to a business number you control**.
  It cannot read existing personal WhatsApp conversations — those are end-to-end
  encrypted with no API. Libraries claiming otherwise (`whatsapp-web.js`,
  Baileys) impersonate WhatsApp Web, violate Meta's terms, and get numbers
  banned. **Do not use them on this project.**
- Numbers belong to the *business*, not the user, so WhatsApp channels are
  **admin-provisioned, not self-serve** — unlike Gmail (ADR-009).

Development runs on Meta's free test number: up to 5 verified recipients, no
business verification. Never let a milestone depend on Meta's production
approval.

Lands in Phase 2 (`docs/04-ROADMAP.md`) — currently a placeholder.

# packages/adapters/gmail

**Built first** (ADR-001) — it reads a genuine existing inbox with no recipient
cap, so it's the channel that actually demonstrates the product thesis.

Hybrid push/pull: `users.watch` registers a Pub/Sub topic, Gmail pushes a
notification carrying a `historyId`, then `users.history.list` fetches the delta
from the stored cursor.

⚠ **`watch` expires and must be renewed at least every 7 days**, or email
ingestion stops *silently*. `sync_state.expires_at` plus a daily cron renewing at
T-2 days, alerting on failure.

`normalize` handles MIME, threads, and HTML→text via `mailparser`. Record real
payloads into `fixtures/gmail/` and unit-test against them — no live account
should be needed to run the suite.

Lands in Phase 1 (`docs/04-ROADMAP.md`) — currently a placeholder.

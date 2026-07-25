# fixtures

Recorded provider payloads, checked into the repo, **scrubbed of personal data**.

They let every adapter's `normalize` be tested without network access or a live
account — which is what keeps the suite fast and keeps development unblocked when
a provider API is down.

```
fixtures/
├── gmail/       Pub/Sub notifications, history.list responses, raw MIME
└── whatsapp/    webhook bodies, including the signature they were signed with
```

**Scrub before committing.** Replace real addresses, phone numbers, names, and
message bodies. A fixture is a shape to test against, not a message to keep.

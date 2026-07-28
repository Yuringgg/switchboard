# fixtures

Recorded provider payloads, checked into the repo, **scrubbed of personal data**.

They let every adapter's `normalize` be tested without network access or a live
account — which is what keeps the suite fast and keeps development unblocked when
a provider API is down.

```
fixtures/
├── gmail/       message resources as users.messages.get?format=full returns them
└── whatsapp/    full webhook bodies, envelope included
```

Each directory has its own README explaining what its fixtures encode. Read it
before adding one — both carry cases that exist specifically because something
was scrubbed away once and a bug shipped behind the gap.

**Scrub before committing.** Replace real addresses, phone numbers, names, and
message bodies. A fixture is a shape to test against, not a message to keep.

⚠ **Scrub the content, keep the ENVELOPE.** Replacing a subject is right;
replacing its `=?UTF-8?B?…?=` wrapper, a part's `charset`, a `wamid.` prefix or
a timestamp's format is not — those *are* the thing under test. Gmail shipped
two real bugs behind fixtures scrubbed to clean ASCII.

**Provenance differs between the two, and it matters.** Gmail's structures were
taken from a live inbox. **WhatsApp's were written from Meta's documentation**,
because Phase 2 was built before the test number existed — so they are a
specification of what *should* arrive, not evidence of what does. Re-record them
against the real number when it exists.

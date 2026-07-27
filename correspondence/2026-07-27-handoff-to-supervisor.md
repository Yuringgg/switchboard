# Handoff — builder → supervisor

**2026-07-27, after build session 5.** Written to save you rediscovering state.
Everything below was verified against the live database and Azure, not inferred.

---

## Your last analysis was correct on every checkable claim

I re-verified rather than taking it on trust:

| Your claim | Verified |
|---|---|
| Watch registered, `sync_state` populated | ✅ cursor set, expires **2026-08-02 20:08:03 UTC** |
| BOM was the whole blocker | ✅ reproduced locally, fixed in `908dc87` |
| `raw_events` had no unique constraint | ✅ **0** constraints vs 1 on `messages` — real gap, now fixed |
| Channel lookup in the webhook is required, not a violation | ✅ agreed, and implemented that way |
| Aug 2 renewal deadline | ✅ **already covered** — see below |

**The Aug 2 risk is closed.** The Azure worker (revision `0000004`, running) has
all four renewal variables: `DATABASE_URL`, `CHANNEL_CREDENTIALS_KEY`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PUBSUB_TOPIC`. The renewal
path was also proven end to end in production earlier: a probe channel with a
deliberately invalid refresh token produced `status='error'` with the right
reason, `cursor` untouched, then was cleaned up.

---

## What changed this session

1. **Migration 0004** — `unique (channel_id, external_id)` on `raw_events`,
   partial on `external_id is not null`. Applied. Your catch.
2. **The webhook now queues.** `/api/webhooks/gmail` verifies → looks up the
   channel by notified address → inserts one `raw_events` row → 200.
3. **CI now runs `next build`.** That gap is why a BOM shipped: `next build` is
   the only step resolving through package `exports` maps and the only one
   Vercel runs.
4. **Pre-commit rejects BOM'd JSON**, verified by staging one.

---

## ⚠ One decision needs you: docs/02-ARCHITECTURE.md §6

§6 says `service_role` "lives only in the worker's server-side environment."
ADR-011 puts ingest webhooks in the console. **Both cannot hold.** A Pub/Sub push
arrives with no cookie and no user, so an RLS-scoped client sees nothing and
cannot insert the `raw_events` row the pipeline depends on.

I implemented it with `service_role` in the console, because §6's *intent* —
never in a browser bundle — still holds: it is a server-only module behind a
non-`NEXT_PUBLIC_` variable. But the **wording** is now wrong and that is a
documented decision, so I flagged it rather than redefining it.

The real risk was never the browser. It is a future page using that client for a
user-facing query and silently bypassing tenant isolation. So its use is
confined to `app/api/webhooks/` and **the confinement is tested** —
`apps/console/test/service-client-boundary.test.ts` fails if anything else
imports it, or if any file references a `NEXT_PUBLIC_*SERVICE*` variable.
Verified by adding a violating import to a page and watching it fail.

**Please amend §6** to say: server-side only, never in a browser bundle; in the
console permitted *only* in ingest routes, enforced by that test.

---

## Docs that are now wrong — yours to fix

Yes, please do all three. You offered; it is needed.

- **`AGENTS.md` §5** — says the live blocker is a missing Google env var and
  that watch registration is unbuilt. Both false.
- **`docs/04-ROADMAP.md` Phase 1** — these are now done: OAuth flow,
  `users.watch` registration, watch renewal cron, ingest endpoint inserting
  `raw_events`. Still open: `history.list` + `normalize`, fixtures, worker
  upsert, contact identity resolution, attachments, timeline query,
  idempotency test.
- **`docs/03-RESOURCES.md` §8** — wrong about Vercel MCP scope. The MCP is
  authenticated to team `Yuringgg` whose only project is `ageni-academy`;
  `switchboard-console` is on the **personal Hobby scope** and is not reachable
  from tooling. That is why I could not read build logs and had to reproduce the
  failure locally. Record it so nobody tries again.
- Also worth an ADR or a §8 note: **CI must run `next build`.** Two production
  incidents came from build-only failures invisible to typecheck and tests.

---

## Verified current state

```
channel      leiruychua@gmail.com   gmail   active   no error
sync_state   cursor set             expires 2026-08-02 20:08:03 UTC
raw_events   0        messages 0        contacts 0
worker       revision 0000004, Running, minReplicas 1, Malaysia West
tests        92 passing
```

`raw_events` is 0 **as of writing** because the queueing code had not deployed
yet. It should become non-zero once Yuri adds `SUPABASE_SERVICE_ROLE_KEY` to
Vercel and sends an email — that is the next observable milestone.

---

## Build order from here (unchanged, and I agree with yours)

1. ~~`raw_events` insert~~ — done this session
2. **`history.list` + `normalize`** in `packages/adapters/gmail` — MIME, threads,
   HTML→text. Needs `fixtures/gmail/` recorded from real payloads so `normalize`
   is testable without a live account (the purity rule in §2).
3. **Worker upsert** — claim → `history.list` from cursor → normalize → upsert
   `messages` on `(channel_id, external_id)` → advance cursor. Contact identity
   resolution alongside.
4. **Timeline query** — `page.tsx` still renders `<NoMessagesYet />`
   unconditionally and never queries `messages`.
5. **Idempotency test** — replay one notification 3×, assert exactly one row.

One UX note for step 4: the empty timeline currently looks identical whether
Gmail is connected and working or nothing is connected at all. That cost a
debugging session. It should distinguish "connected, waiting" from "nothing
connected".

---

## What I'd ask of you specifically

You have been most useful when you check the builder's claims against the live
system rather than reading the code alone — the `raw_events` constraint gap is
exactly that, and I would have shipped a broken upsert without it. More of that.

Concretely, before I build step 2, it would help to have:

- Your read on whether `normalize` should return attachments as provider ids
  only (current `AttachmentRef` has no URL, deliberately — §2 purity), and
  whether Phase 1 should download attachments at all or defer to Phase 2.
- A check that `messages.body_text` being `not null` is right for emails that
  are HTML-only with no text part — that is a real Gmail case and it will
  violate the constraint unless normalize always synthesises text.

That second one is the kind of thing that surfaces at 2am against a real inbox.

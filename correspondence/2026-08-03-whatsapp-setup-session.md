# Session brief — get WhatsApp live (Phase 2)

**Written 2026-08-03 for a session that will walk Yuri through the Meta setup.**
Paste the block below into a fresh session. Everything in it was verified
against the code or the live database on the day it was written.

---

## The prompt

```
You are picking up Switchboard, Yuri's OJT project at iOzera. The repo is at
D:\Claude Code\Switchboard.

Read AGENTS.md first — especially §7, which carries the verified current state —
then docs/03-RESOURCES.md §6 and correspondence/2026-07-28-phase-2-whatsapp.md.
Do not write code before you have read those.

YOUR JOB THIS SESSION: get WhatsApp ingestion working end to end. Phase 2 is
CODE COMPLETE and has been since 2026-07-28 — adapter, ingest route, worker
branch, 13 fixtures, migration 0006, all tested. Nothing is blocked on code.
It is blocked on clicks in Meta's dashboard that only Yuri can do.

So your job is mostly: guide Yuri through those clicks, then verify the result
against the live system, then close the two things that can only be done once a
real number exists.

── HOW TO WORK WITH ME (Yuri) ──────────────────────────────────────────────

- Give me exact, numbered, click-by-click steps in ONE message. Do not
  drip-feed. Include every value I need to paste.
- ⚠ CHECK THE ACTUAL BUTTON LABEL IN THE CODE before telling me to click it.
  A previous session told me to click "Connect" on /channels; the button says
  "Reconnect" once a channel exists, and I went hunting for something that was
  not on the screen. For Meta's own dashboard you cannot check — say so, and
  mark those labels as approximate rather than stating them as fact.
- Do not guess API limits, quotas or prices. Check them against the live system
  or look them up. EIGHT documented decisions in this project have now been
  contradicted by measurement, and the ones that mattered were found by RUNNING
  the thing, not by reading it.
- If something is wrong, broken, or could be better, fix it and tell me why.
  If a doc is holding you back, say so and propose the change.
- Push each piece once tests and `next build` are green.

── VALUES YOU WILL NEED (verified 2026-08-03) ──────────────────────────────

  My user uuid (the owner to provision against):
      ec7645a6-11b8-456a-bbcc-03b94e5841db
      (verified from auth.users; the other account, f5131cd5-…, owns nothing)

  Webhook callback URL:
      https://switchboard-console-beryl.vercel.app/api/webhooks/whatsapp
      ⚠ Confirm this hostname against my Vercel dashboard before I paste it —
      it is what the docs record, not something you can verify from tooling.
      The Vercel MCP cannot see this project (it authenticates to team
      Yuringgg; Switchboard is on the personal Hobby scope).

  A verify token I can use (I invent this; Meta does not give it to me):
      sbwh_7Kq2mR9xTvL4nP8eZ3wY6bA5cD1fH0jN

  ⚠ ONLY TWO env vars go on Vercel, not four. Verified by grepping every read
  across apps/console, apps/worker and packages/adapters/whatsapp:
      WHATSAPP_WEBHOOK_VERIFY_TOKEN   ← read by the webhook route
      WHATSAPP_APP_SECRET             ← read by the webhook route
  WHATSAPP_PHONE_NUMBER_ID is never read from the environment at all (it is a
  --phone-number-id argument, then lives in channels.external_account_id).
  WHATSAPP_ACCESS_TOKEN is read only by the provisioning script, locally.
  docs/03-RESOURCES.md §6 used to say "all four"; it was corrected 2026-08-03.
  Two fewer fields is two fewer chances to paste something wrong into a
  platform that stores the field VERBATIM — a value pasted with its quotes
  becomes part of the value and fails auth in a way that reads as a bad secret.

  Provisioning command (run locally, after the Meta steps):
      $env:WHATSAPP_ACCESS_TOKEN = "<the access token>"
      node --env-file=apps/worker/.env packages/db/scripts/provision-whatsapp.ts --owner ec7645a6-11b8-456a-bbcc-03b94e5841db --phone-number-id <numeric id> --display "<+1 555 ...>"
  It reads DATABASE_URL and CHANNEL_CREDENTIALS_KEY from apps/worker/.env (both
  present) and the token from the environment, never from argv.

── THE BLOCKER, STATED HONESTLY ────────────────────────────────────────────

I have not been able to get past Meta's developer-account phone verification:
"You can only complete this action in Accounts Center." That is an account
wall, not our code, and nothing downstream can start until it clears. If I hit
it again, help me work out what Meta actually wants rather than assuming the
next step will work.

── THE FIVE TRAPS THAT WILL COST TIME ──────────────────────────────────────

All guarded by tests, all worth knowing:

1. ⚠ THE SILENT ONE. Registering the webhook URL is NOT enough — the `messages`
   FIELD must be subscribed separately. If it is not, the handshake succeeds,
   the dashboard shows green, and Meta simply never delivers anything. There is
   no error anywhere, because nothing failed: it was never sent.
2. The App Secret is NOT the access token. Wrong value = every webhook 401s,
   which reads as Meta being broken. Log line: `rejected: bad or missing
   signature`.
3. Vercel binds env vars WHEN A DEPLOYMENT IS CREATED. A variable added after
   does nothing until the next build. Redeploy, then check
   /api/health/config (signed in) which reports deployment.commit — answer
   "did my change deploy?" by reading, not by inferring.
4. phone_number_id is the tenant key; display_phone_number is a label. The
   script rejects a display number with a clear error, but only for the flag it
   validates.
5. An unknown number returns 200, not 404 — deliberately, because Meta disables
   endpoints that keep answering non-2xx. So "nothing stored, no error" is the
   expected state before provisioning, not a bug.

Two more that look like bugs and are not: a WhatsApp channel's sync_state row
stays empty (there is no cursor — it is pure push), and most WhatsApp messages
will have NO AI summary (the already-short skip rule fires under 280
characters, because paraphrasing a one-line chat message is no shorter and less
true). Say both out loud before a demo rather than debugging them during one.

── WHEN A MESSAGE DOES NOT ARRIVE, CHECK IN THIS ORDER ─────────────────────

Cheapest first. This project has twice concluded the wrong thing by reading
code instead of checking here.

1. The live database via the Supabase MCP (project ref ytrkpcryztwgflmbhfdu):
   select * from raw_events order by received_at desc limit 5;
   A row means ingest worked and the problem is the worker. No row means it is
   upstream.
2. Meta's dashboard → WhatsApp → Configuration. It shows recent deliveries and
   their response codes. A message I sent that produced NO delivery attempt
   means trap 1.
3. Vercel runtime logs. The route logs on every call:
   queued=N duplicates=N unknownNumber=N statuses=N unusable=N
   Those five numbers identify every failure mode above. unknownNumber > 0
   means the channel was not provisioned, or with the wrong id.

── WHAT TO DO ONCE A REAL MESSAGE LANDS ────────────────────────────────────

These two can ONLY be done after a real number exists, and they are the actual
engineering work of this session:

1. ⚠ RE-RECORD THE FIXTURES. fixtures/whatsapp/text.json and one media fixture
   were written from Meta's DOCUMENTATION, not recorded from traffic, because
   the test number did not exist. This project has already shipped two real
   Gmail bugs behind fixtures that were a specification rather than evidence —
   header case and part nesting were both wrong until a real inbox corrected
   them. Capture the real payloads from raw_events.payload and replace them.
   Note it in fixtures/whatsapp/README.md.
   Keep batch.json as it is: two entries, two changes, two business numbers,
   four messages in one POST. Any [0]-indexed parse returns one and loses three
   with no error, and that fixture earns its place regardless of provenance.

2. Verify the cross-channel claims that were previously untestable:
   - the same timeline shows Gmail and WhatsApp, with the channel NAMED at
     every change point (not just a coloured dot — Gmail red vs WhatsApp green
     is the red/green confusion pair, and channel identity is the one question
     this product exists to answer)
   - search a term present in both channels and confirm both hit
   - a contact with an email address AND a phone number merges into one person
   These are steps 3–5 of the demo sequence in docs/01-PRODUCT-SPEC.md §6 and
   they are the last unproven part of it.

── HOUSE RULES YOU MUST NOT BREAK ──────────────────────────────────────────

- NEVER run drizzle-kit generate or migrate. It proposed disabling RLS on every
  table. Migrations are hand-written SQL. Migrations are at 0011.
- Adding a table to `public` makes CI RED until EXPECTED_TABLES in
  packages/db/scripts/assert-rls.ts lists it. That is the guard working.
- Changing ANY package.json means running pnpm install and committing
  pnpm-lock.yaml in the SAME commit, or CI goes red before running a test.
  pnpm may be missing after a Node upgrade: npm i -g pnpm@11.17.0
- CI does NOT repoint the Azure Container App — it pushes an image to ghcr and
  nothing deploys it. If you change apps/worker/** or packages/ai/**, repoint by
  hand or the deployed worker runs old code while the commit looks deployed.
  az lives at C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd (the Azure
  MCP times out). Currently on revision --0000015.
- owner_id comes from the CHANNEL, never from the provider payload. The worker
  runs as service_role and bypasses RLS, so this is the one place a wrong value
  leaks one tenant's messages into another's console with no policy to catch it.
- ⚠ Never "fix" a multi-row channel lookup with .limit(1). That delivers one
  tenant's mail to whichever row sorted first. The fan-out already handles it.
- ADR-010 IS ABSOLUTE: never auto-create a calendar event, and never send
  Google `attendees` — that emails an invitation from me to that address.
- ⚠ The assistant's ~30 questions/day is a TOKEN cap SHARED by every user, not
  per user. Measured 2026-08-03: it actually tripped after ~13. Anything you
  spend, I cannot. WhatsApp work should not need it at all — if you want to
  check retrieval, use apps/worker/scripts/probe-context.ts, which costs
  nothing.
- NO SCREENSHOTS — verify UI by measuring the DOM. Disable CSS transitions
  first, and note this console's computed colours come back as CIE lab(), not
  rgb(); an rgb() regex reads L,a,b as R,G,B and reports ~1.2:1 for everything.

── STATE AS OF 2026-08-03 (verified by querying, not inferred) ─────────────

86 messages · 22 contacts · 2 users · 84 extraction runs · 0 outstanding
Queue: 0 not done. Channels: 1 Gmail, active, 0 in error.
Tests: 496. Migrations: 0011. Worker: revision --0000015, healthy.
Assistant eval: answerable 6/6, must-refuse 7/7 — the first complete score.
Azure Blob: swbattachments / container `attachments` provisioned, NO CODE YET.

⚠ My Gmail OAuth refresh token lapses ~2026-08-08 19:34 UTC. If mail stops
arriving mid-session, that is why — I reconnect on /channels (the button says
"Reconnect"). Do not confuse it with the Gmail WATCH expiry, which is a
different date and auto-renews.
```

---

## Why this is a separate session

Not because the work is large — it is maybe 15 minutes of clicks and an hour of
verification. Because it is **gated on an account wall that has already blocked
Yuri once**, and a session that sits waiting on it burns context it cannot use.
Starting fresh when the Meta account actually exists is cheaper than holding the
state.

## What is NOT in scope for that session

So it does not wander: attachments (the Blob account exists but no code is
written, and WhatsApp media must come first because its media ids exchange for a
**short-lived** URL), timeline virtualization, and the error-handling audit.
Those are Phase 3 items that do not need a phone number.

# Session Handoff — the pipeline repair, and the per-person brief

**Written 2026-09-24 (the night of 24→25 Sep, Manila).** Newer than
`2026-09-22-phase-7-handoff.md` and newer than everything in `docs/`. Where they
disagree, **this is right.**

*Read `AGENTS.md` first, then this. This file is only the delta since
`305cd0a`.*

Everything here is on branch **`claude/dreamy-wozniak-lexzju`**, pushed, **not
yet merged to `main`.** Four commits:

```
042696f  A brief on every contact: who they are, what is open, where they write
0ceb1d8  The worker can now be given Recall's key, and the Meetings page stops saying meetings go nowhere
1c738c4  Stranded events switched the catch-up off for seven weeks, and summaries had no way back
         (+ this docs commit)
```

---

## The one-paragraph version

Mail was flowing, and almost nothing was being done to it. Measured against the
live database on 2026-09-24: **no summary written since 14 August**, **183 of
393 messages never extracted**, **36 never embedded**, and **27 queue events
stuck in `processing`**, the oldest since 4 August. Two causes, both silent. A
stranded event switched the extraction catch-up off, and no catch-up existed at
all for summaries or embeddings. And summaries (and very probably the console
assistant) were asking the new gpt-oss reasoning model for 160 tokens. Its
thinking uses those same tokens, so it runs out before it writes an answer. All
of that is fixed in code, migration 0018 is applied, and a new worker image is
built. **What is left is the Azure deploy, which needs Yuri's `az` login.**

---

## ⚠⚠ Blocked on Yuri — the deploy

Nothing below reaches production until this is done. The image is built and
verified by digest:

| | |
|---|---|
| Image | `ghcr.io/yuringgg/switchboard-worker@sha256:0e6bad966a9347d203d7bc0155e6f262b53696c91a2a0055257dad48a6d19c65` |
| Built from | `1c738c4` on this branch, workflow run **#42** (`workflow_dispatch`), success |
| Carries | the reaper, all three catch-ups, the summary fix, **and** the meeting sweep from `18f6c23` |

```bash
# 1. Give the worker Recall's key — the same value as RECALL_API_KEY on Vercel.
az containerapp secret set -g rg-switchboard -n switchboard-worker \
  --secrets recall-api-key=<the key, unquoted>

# 2. The new image and the key, in ONE revision.
az containerapp update -g rg-switchboard -n switchboard-worker \
  --image ghcr.io/yuringgg/switchboard-worker@sha256:0e6bad966a9347d203d7bc0155e6f262b53696c91a2a0055257dad48a6d19c65 \
  --set-env-vars RECALL_API_KEY=secretref:recall-api-key RECALL_REGION=ap-northeast-1
```

⚠ **`containerapp update`, not a bicep deployment**, for the same reason as
last time (`2026-09-22-phase-7-handoff.md`). `infra/main.bicep` now declares
`recallApiKey` too, so a bicep deploy would not strip it, but it is still the
bigger hammer.

⚠ **Without step 1 meetings still never arrive.** Until this session the Recall
key existed only in Vercel, where the console uses it to *send* a bot. The
worker needs it to *fetch* what the bot recorded. Without it the worker logs
`[meeting] sweep disabled` once at startup and nothing else, and a meeting that
never arrives looks exactly like Recall not being done yet.

⚠ **`:latest` on ghcr now points at this branch's image**, because a
`workflow_dispatch` build tags `latest` like any other. Deploys pin by digest,
so nothing runs it by accident, but do not read `:latest` as "what `main` is".

### How to know it worked

Watch `az containerapp logs show -g rg-switchboard -n switchboard-worker --follow`:

| Line | When | Means |
|---|---|---|
| `[summary] enabled, model=openai/gpt-oss-20b` | startup | the key is there |
| `[reclaim] 27 event(s) stuck in processing … returned to the queue` | startup | the reaper works. Then 27 Gmail events re-run. They are harmless no-ops, because Gmail ingest reads from the stored cursor, not the notification |
| `[summary-catchup] sweep: considered=5 written=5 …` | after ~15 min | **summaries work on gpt-oss.** If it says `failed=` with `empty completion`, the 400-token ceiling is still too low. Raise `SUMMARY_COMPLETION_OPTIONS.maxTokens` |
| `[embed-catchup] sweep: …` / `[extract-catchup] sweep: …` | same pass | the backlog is moving |
| `[meeting] sweep: …` | every 5 min, **only when a bot is in its 12-hour window** | meetings are being fetched |

Then, the same queries this session used (Supabase MCP):

```sql
select count(*) from raw_events where status = 'processing';            -- was 27, expect 0
select max(created_at) from extractions where kind = 'summary';         -- was 2026-08-14
select count(*) from messages m where not exists
  (select 1 from message_extraction_runs r where r.message_id = m.id);  -- was 183, falling
```

**How long the backlog takes:** each pass does 5 summaries and 5 extractions
(20 s apart) and 20 embeddings, every 15 minutes, and only while the queue is
idle. That is about **8 hours for the summaries and 9 for extraction**, and it
is correct for it to be slow: it shares a per-minute token window with live
mail. To go faster, run `backfill-summaries.ts` / `backfill-extractions.ts`
locally with `--limit`. They honour `retry-after`.

**The 19 September recording will NOT come through.** The sweep only looks at
bot sessions inside their 12-hour window (`meeting-sweep.ts`, on purpose), and
that one expired days ago. To see a meeting land end to end, send one new bot
into **your own** test meeting from `/meetings` after the deploy. Never into a
meeting with other people in it (RA 4200, ADR-026).

---

## What was wrong, and what was built

### 1. Stranded events switched the extraction catch-up off, from 4 August

`claimNextEvent` flips a row to `processing` as it claims it. If the worker dies
before `markDone`, the row stays there forever, because the claim only selects
`pending`. Deaths that do this include a deploy outliving the 10-second SIGTERM
grace, an OOM, or a restart. That alone would be a small leak. But
`extract-catchup.ts` ran only when the queue was idle, and it counted
`processing` as busy. **The first stranded row turned the sweep off for good,
and nothing logged it.**

- **Migration 0018**: `raw_events.claimed_at`, set in the claim statement.
  **Applied to production.** RLS on `raw_events` re-checked afterwards: still
  enabled and forced.
- **`apps/worker/src/queue.ts`**: a reaper that runs at startup, then every 5
  minutes. It returns rows stuck over 30 minutes to `pending`. It keeps the
  attempt they spent, so a payload that kills the worker still runs out and
  parks as `failed`. The same file holds **one** idle check that ignores stale
  claims, shared by all three catch-ups.
- **Measured with read-only SELECTs on the live data:** the old idle check saw
  27 busy rows; the new one sees 0. The reaper would reclaim 27 and park 0.

⚠ **Rejected: "reset everything in `processing` at startup."** It is simpler,
and it is wrong at exactly the moment stranding happens. During a deploy the
old revision is still finishing its event, so the new process would pull a live
event back and process it a second time, concurrently. The timestamp is what
makes the reaper safe.

### 2. Summaries could not succeed on gpt-oss, and had no way back

- **The model trap.** Summaries called `provider.complete(system, prompt)` with
  no options: 160 tokens, default reasoning. `openai/gpt-oss-20b` bills its
  thinking out of the same budget, so the answer comes back empty. Extraction
  hit this on 2026-09-20 and got `reasoningEffort: 'low'`. Summaries never did,
  because the model switch (`35f65c7`) was re-checked with `eval-extractions.ts`
  only. **`SUMMARY_COMPLETION_OPTIONS`** (low effort, 400 ceiling) is now used
  by the worker **and** by `eval-summaries.ts`, so the eval measures the request
  production actually sends. Nothing gets longer on screen, because
  `validateSummary` still cuts at 240 characters.
- **The console assistant has the same trap.** It runs on `openai/gpt-oss-120b`
  and sent the same 160-token default. **`ASSISTANT_COMPLETION_OPTIONS`** (low
  effort, 900 ceiling). ⚠ **Not measured.** Nothing in this session holds a
  Groq key. **Run `eval-assistant.ts` before quoting any assistant score.** The
  6/6 · 7/7 in ADR-017 and ADR-020 were measured on the Llama model and say
  nothing about this one. If `/assistant` has been answering "busy, try again"
  since 20 September, this is why.
- **`summary-catchup.ts` and `embed-catchup.ts`**, the same shape as the
  extraction sweep. All three run in **one** loop (summaries → embeddings →
  extraction), so the two Groq steps cannot contend for their shared window.
- **Each catch-up keeps an in-memory give-up set.** A failure records nothing,
  so a message that fails non-retryably would head the list on every sweep and
  stop it ever reaching anything older.

686 tests (was 639). Negative-controlled: put back
`status in ('pending','processing')`, or drop the summary options, and exactly
one test fails for each.

### 3. The worker image and the Recall key

The last image build (`18f6c23`) failed on an **npm download timeout** for the
ONNX runtime packages, not on code. The earlier session could not read the log
without signing in; the GitHub MCP could. A fresh build from this branch
passed. `infra/main.bicep` now declares `recallApiKey` and `recallRegion`, and
`bicep build` passes (CLI 0.47.16).

### 4. `/meetings` stops saying meetings go nowhere

It said *"A finished recording does not reach the timeline yet"*, which was
true until `18f6c23`. It now says the meeting arrives as one message and that
Switchboard checks every five minutes. It makes **no** promise about how long
Recall's transcription takes, because nobody has measured it. On a 375px phone
the sent list no longer truncates the link to `us05we…`.

⚠ **Merge order.** The console deploys from `main` through Vercel. Merge after
the worker is deployed, or the page says meetings arrive while production
cannot fetch them.

### 5. The per-person brief on `/contacts/[id]`

Ms. Maria's "Meeting Brief Protocols" asks for company, relationship
(client/partner/investor/broker) and decision-maker. 7B extracted them; nothing
showed them. The Brief now shows:

- **Who they are.** Each fact comes with its verbatim sentence and a link to
  its message, and facts from one sentence share one quote. The newest row wins
  per fact, and a later row that doesn't mention a fact never erases it.
- **Open with them**, soonest first, saying who owes what.
- **Where they write**, per channel, named in words.
- **How much is unread**, e.g. "N of M messages in these conversations have not
  been read by the extraction pass yet". A brief built from half of someone's
  mail looks complete unless it says so.

⚠⚠ **A fact only lands on a person when the extraction's title names them.**
The first design attributed affiliations to the message's sender. Checked
against the live database before building it: the **only** affiliation row in
production is in a message **Yuri sent**, and its title names someone else.
Attributed by sender, that person's company would have been printed on Yuri's
own contact as fact. So the brief reads every conversation the contact is in,
rolls a row up only on a whole-word name match, and lists the rest as "Also
mentioned in these conversations", shown but never attributed. **ADR-028.**

**On real data today the brief is mostly empty, correctly.** There is one
affiliation row and 183 unread messages, so real contacts show the "not read
yet" state until the catch-up runs. `/preview?screen=contact` renders all three
states: filled, `state=unread` and `state=empty`.

---

## Still open, and not started

- **Measure the assistant and summaries on gpt-oss.** `eval-assistant.ts` (both
  numbers) and `eval-summaries.ts`, on a day the assistant is otherwise unused.
- **The 144 `failed` Gmail events** (14 Aug–19 Sep, all "refresh token is no
  longer valid"). Left alone on purpose. Gmail ingest pulls from the stored
  cursor, so re-running them would fetch nothing, and the mail from those weeks
  is in `messages`.
- **Contacts named only by a phone number or address get no facts rolled up.**
  That is deliberate, but it means WhatsApp contacts with no profile name will
  show everything under "Also mentioned".
- Everything under *Smaller, still open* in `2026-09-22-phase-7-handoff.md`
  still stands (Vapi key origins, merged vs split default, split view past
  four lanes). The shader-svg deletion is done (`18f6c23`).

---

## How this session found it

The same way the last one kept telling future sessions to: **by counting rows,
not reading code.** One query grouped `raw_events` by status and found the 27.
A second split messages by week and found summaries flat at zero from
mid-August. A third, before the brief was built, found that attributing by
sender would have been wrong. None of it needed the model or a key, and none
of it would have come out of the code alone.

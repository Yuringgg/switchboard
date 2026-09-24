# Session Handoff — Phase 7, meetings

**Written 2026-09-22, updated 2026-09-23.** Newer than everything in `docs/`
and newer than every other file in `correspondence/`. Where this disagrees with
them, **this is right** — except where it says otherwise below.

*Read `AGENTS.md` first, then this. This file is only the delta since
2026-09-17.*

---

## The one-paragraph version

Phase 6 (voice) shipped on 2026-09-11. Since 2026-09-18 the work has been
**Phase 7 — meetings**: Recall.ai sends a named bot into a Zoom/Meet/Teams call,
records it, transcribes it, and the transcript becomes messages in Switchboard
like any other channel. **7A's receiving pathway is built, deployed and proven
against a real Zoom meeting. 7B (affiliation extraction) is built and has been
run over the whole existing corpus.** What is left is the transcript itself:
nobody has yet seen what one looks like, and nothing maps one into `messages`
until somebody has.

**On 2026-09-23 the console caught up with the database.** Meetings was a live
channel that the timeline, the voice assistant and every line of marketing copy
still behaved as though did not exist. That is fixed and shipped.

**Two jobs remain half-finished and both are blocked on Yuri, not on code.** See
*Blocked on Yuri* below — start there.

---

## ⚠⚠ Before anything else — RA 4200

Recording a private communication without the consent of **every** party is a
**criminal offence** in the Philippines (Anti-Wiretapping Act). It is the same
law behind ADR-008 excluding calls.

- The bot is **named and visible** in the participant list. `botName` is
  required and defaults to `Switchboard Notetaker`.
- The platform's own recording announcement stays on.
- **Consent is obtained by a person before a bot is sent.** Never inferred from
  somebody having shared a link.

The bot being visible is a *mitigation*, not consent. Every bot sent so far has
been into Yuri's own empty test meeting. **Do not send one into a real meeting
with other people in it** — that is Ms. Maria's and iOzera's call, not a
decision to make by shipping. `docs/04-ROADMAP.md` Phase 7, ADR-026.

---

## Blocked on Yuri — the two things that unblock everything

Neither is a code problem. Both were asked for on 2026-09-20 and **neither was
done as of 2026-09-23**, so **ask again rather than assuming**. Three days is
long enough that the reason may have changed.

### 1. Azure login expired → the worker deploy is stuck

`az` returns `AADSTS50173: the provided grant has expired due to it being
revoked`. Yuri changed their password on 2026-09-09 and every token issued
before then is dead. They must run this themselves — it opens a browser:

```bash
az login --tenant c7e8b5ac-96c6-4123-a65a-793543aced4d
```

### 2. `RECALL_API_KEY` exists only in Vercel → the transcript is stuck

It is in Vercel's production env vars (which is why the deployed
`/api/meetings/bot` works) and **nowhere on disk**. Yuri copies it from Vercel →
Settings → Environment Variables into `apps/worker/.env` as `RECALL_API_KEY=…`.

⚠ Do **not** work around this by materialising a key through the Recall MCP
tools. `get_webhook_verification_secret` was already blocked by the classifier
for exactly that, and the right response then was to say so and change approach,
not to find another route to the same secret. Same here.

---

## ⚠ THE WORKER IS RUNNING BROKEN CODE RIGHT NOW

**This is the most urgent thing in this file.**

Groq decommissioned every Llama model the project used. The fix — moving to the
`openai/gpt-oss-*` family — landed in commit `35f65c7` and **is not deployed**.
The container in Azure is still running an image that asks for models that
return `404`. Extraction and summarisation in production are dead until it
ships.

Everything needed is ready:

| | |
|---|---|
| Image | `ghcr.io/yuringgg/switchboard-worker@sha256:39d445d4d52c156720e40dd62a5e7ae22168d96fb868ccc509c656f9f71dc39a` |
| Built from | `0b3e628` — the newest commit touching the worker's paths |
| Verified | `:latest` and `sha-0b3e628…` resolve to that same digest |

### ⚠ Deploy with `containerapp update`, NOT a bicep deployment

```bash
az containerapp update -g rg-switchboard -n switchboard-worker \
  --image ghcr.io/yuringgg/switchboard-worker@sha256:39d445d4d52c156720e40dd62a5e7ae22168d96fb868ccc509c656f9f71dc39a
```

That changes the image and nothing else. **A full
`az deployment group create -f infra/main.bicep` would have been the wrong
move**, and finding out why is most of what this session did — see the next
section.

### Two things to check the moment `az` works again

Both are unanswerable without a live read, and both were left unanswered on
purpose rather than guessed at:

1. **Are `GROQ_API_KEY` and `EMBED_API_SECRET` actually set on the live
   revision?** If they are, somebody set them by hand. If they are not,
   extraction has never run in production at all.
2. **What cpu/memory does the live app have?** `infra/main.bicep` still says
   `0.25` / `0.5Gi`, with its own comment saying to raise it in Phase 4 because
   ONNX embedding weights will not fit. Phase 4 shipped; `packages/ai` pulls
   `@huggingface/transformers`. If the live app was bumped by hand and bicep
   still says `0.5Gi`, a bicep deployment would shrink it back and OOM the
   worker.

```bash
az containerapp show -g rg-switchboard -n switchboard-worker \
  --query "{image:properties.template.containers[0].image, \
            env:properties.template.containers[0].env[].name, \
            secrets:properties.configuration.secrets[].name, \
            cpu:properties.template.containers[0].resources}" -o json
```

---

## Shipped 2026-09-23, and why each one mattered

Everything below is committed and pushed. **Do not rewrite it — read it.**

### `infra/main.bicep` — `4d378b1`

Added `groqApiKey` and `embedApiSecret` as `@secure()` params, plus their
secrets and env entries. `az bicep build` passes.

**Why it mattered:** the worker reads both (`apps/worker/src/env.ts`) and the
template declared **neither**. A bicep deployment *replaces* the revision's env
list, so redeploying would have stripped whatever was set by hand and taken
summaries, extraction and `/embed` down with it — while reporting success. The
worker fails **soft** on all three (`[summary] disabled`, `[extract] disabled`,
`/embed is DISABLED`), so the only symptom would have been that nothing gets
extracted any more. Same shape as the BOM incident in `docs/02-ARCHITECTURE.md`
§8: green everywhere, and the work quietly not happening.

⚠ `EMBED_API_SECRET` is not in `apps/worker/.env` either, so `/embed` is
probably disabled locally *and* in production. Not chased — flagged.

### `apps/worker/scripts/fetch-transcript.ts` — `4d378b1`

Requests an async transcript for a finished recording, polls until terminal,
downloads it, and writes the raw payload **and** a shape summary to
`D:/Claude Code/_scratch/recall`. Typechecks clean. Never run — see blocker 2.

```bash
node --env-file=apps/worker/.env \
  apps/worker/node_modules/tsx/dist/cli.mjs \
  apps/worker/scripts/fetch-transcript.ts \
  --recording 3299fb14-bb93-4db3-bb17-a2fa64d29a84
```

The request body was **read from Recall's post-meeting transcription guide on
2026-09-20**, not guessed:

```json
{ "provider":    { "recallai_async": { "language_code": "auto" } },
  "diarization": { "use_separate_streams_when_available": true } }
```

⚠ `recallai_async`, **not** `recallai_streaming`. The streaming providers go in
`recording_config` on the bot and are configured *before* the meeting; this one
runs against the finished recording. Sending the async name to the bot endpoint
is a 400 — that mistake already cost a round trip (`6dc53fd`).

⚠ A recording allows **10 successful transcripts and 100 attempts, ever**, then
400s until old ones are deleted. Do not put this in a retry loop.

⚠ Output goes outside the repo on purpose. A transcript is a real conversation
between real people and has no business in git. Same rule as `probe-recall.ts`.

---

### The console, `d66dab5` · `88b0204` · `65d791d`

**Meetings had been a live channel for five days and the console behaved as
though it was not one.** Three separate places, all the same root cause: layout
and copy written when there were exactly two channels, none of which failed
loudly when a third arrived.

**The split timeline buried it.** `TimelineSplit` maps over `CHANNELS`, so the
column was correct the day 0016 landed. The grid was a hard `lg:grid-cols-2`,
and a three-item two-column grid puts the third item in row TWO — which begins
below the tallest cell in row one. With fifty Gmail messages that is several
screens down. **It rendered perfectly and was invisible**, which is worse than
missing, because nothing looks broken. The track count now follows the number
of lines, written out as a lookup because Tailwind only ships classes it can
find as literal text and `lg:grid-cols-${n}` silently compiles to one column.

**Split view also ran at a reading measure.** `AppShell` defaults to 56rem,
right for merged, which is one column of prose. Split is laid out across, and
three lines inside 56rem measured **250px each** — narrower than a subject line.
That is the identical complaint that put `width="wide"` on the attention board,
so split uses it now: **357px per lane**, measured.

**A LinkedIn job alert gave the whole page a horizontal scrollbar.**
`whitespace-pre-wrap` has nowhere to break a ~400-character tracking URL with no
whitespace in it, and `max-w-[62ch]` caps the box rather than what overflows it.
`[overflow-wrap:anywhere]` now on the four places that render text somebody else
wrote. ⚠ `break-words` would NOT have fixed it — it only breaks a word that
would overflow on a line of its own, and this URL sits after ordinary words.

**The voice tools dropped the meeting filter on the floor.**
`getRecentMessages` resolved its channel with a two-arm ternary. "meetings" fell
through to `null`, which means NO FILTER, so *"what were my last meetings"*
quietly answered with Gmail, **out loud, with no screen to catch it on**. An
ignored filter looks exactly like a filter that matched everything.

`CHANNEL_LABELS` became `CHANNEL_SPEECH`, typed `Record<ChannelType, …>`. It
holds the label, the counted unit, the "nothing there" sentence and the words a
caller might actually say — "zoom", "teams" and "meet" included, because nobody
says "the meeting channel" out loud. `HEARD_AS` is built FROM it rather than
written out again. **Phase 7 found three separate places that had assumed two
channels**; one compiler-checked record is what stops a fourth. Four new tests,
because the bug was silent.

`get_recent_messages` now returns which line each message arrived on. Without
it every item sounds like an email, and *"Maria said"* means something different
depending on whether she typed it or said it in a room with other people
listening.

**The agent prompt moved in the same commit**, because `tools.ts` claimed "there
are no transcripts in this system" and pointed at the prompt saying the same.
Both now say meetings are **searched** like any other message — not that they
can be "pulled up", because there is still no `get_meeting_brief` tool and
claiming one recreates the exact failure that prompt was written to avoid.

> ⚠⚠ **The prompt lives in Vapi's dashboard.**
> `correspondence/2026-09-10-vapi-agent-prompt.md` is the source of truth and it
> is updated, but **somebody still has to paste it into Vapi.** Until that
> happens the shipped agent still believes it cannot read meetings.

**Copy.** Eight places described a two-channel product, including the browser
tab title and the whole landing page. All updated. The hero diagram
(`patch-field.tsx`) now draws three source lines — two Gmail cords, two
WhatsApp, one meeting, because a meeting arrives once after the fact where mail
and chat arrive all day. `STROKE`/`FILL` are `Record<ChannelType, …>` for the
same reason as above.

⚠ The colour-blindness rule is **unchanged, not relaxed**. Meetings blue
survives the red/green axis, which makes two of three sources legible by hue
rather than three — so every source is still named in words.

Also fixed in passing: the landing header measured ~423px against 335px of
usable width on a 375px phone, so **the first page anybody sees scrolled
sideways**. Pre-existing, unrelated to Phase 7, found by checking.

---

## What Phase 7 actually landed — verified, not assumed

Ten commits since 2026-09-17, newest first:

```
742fcaa  A recording does carry the bot id — verified against a real Zoom meeting
6dc53fd  Async transcription is not a recording_config setting — drop it, log the body
284d681  A meeting channel has no credentials, and the log should have said so
0b3e628  Send the bot, then ASK for the result instead of waiting to be told
cd25a25  Make extraction work on a reasoning model: cap the thinking, show the shape
20a84bb  Accept `participants: null` — gpt-oss says "nobody" differently to Llama
9e60a11  Extract who somebody is, not just what they asked for
a61959d  Meetings become a third channel, with the tenant rule voice already taught us
35f65c7  Groq deleted every Llama model we use — move to the gpt-oss family
898b317  Ignore graphify's generated knowledge graph
```

### 7A — the receiving pathway

| | Where | State |
|---|---|---|
| `channels.type` accepts `meeting` | migration **0016** | applied to production |
| `meeting_bot_sessions` | migration **0016** | applied, RLS enabled **and forced** |
| Svix signature verification | `apps/console/src/lib/meetings/signature.ts` | done, 13 tests |
| The webhook | `/api/webhooks/recall` | done — verifies, resolves tenant, files raw |
| Sending a bot | `/api/meetings/bot` | **built and deployed** — a real bot joined a real Zoom call |
| Polling probe | `apps/worker/scripts/probe-recall.ts` | done, run, answered its question |
| Transcript → `messages` | — | **not built, and must not be until a real one is read** |

### 7B — affiliation extraction

| | Where | State |
|---|---|---|
| `affiliation` kind | migration **0017** | applied to production |
| `company · relationship · role · decision_maker` | `packages/ai/src/extract.ts` | done |
| Prompt rules + worked examples | `EXTRACTION_SYSTEM_PROMPT` | done |
| Backfill over the existing corpus | — | **run** |
| Per-person roll-up view | — | **not built** — the obvious next build, needs no Recall |

---

## The question that got answered, and why it mattered

`lib/meetings/payload.ts` resolves the tenant by **bot id**. The open question
was whether the deliveries that actually carry a meeting — `recording.done` and
`transcript.done`, which are *recording artifact* events — reference the bot at
all, or only their own artifact id. Recall's schemas live in doc components
their docs API does not expand, so it could not be settled by reading.

If the answer had been "only their own id", the tenant lookup would have refused
exactly the deliveries worth having.

**A real bot was sent into a real Zoom meeting and the recording read back. A
recording carries the bot id twice:**

```
{ "id":     "3299fb14-…",            ← the recording
  "bot_id": "8b37ef2b-…",            ← top level
  "bot":    { "id": "8b37ef2b-…" } } ← and nested
```

⚠ **The fallbacks in `payload.ts` stay** until a real *webhook* delivery has
been seen. That was an API response, and the webhook envelope may wrap it
differently.

### The recording that exists

| | |
|---|---|
| Recording | `3299fb14-bb93-4db3-bb17-a2fa64d29a84` |
| Bot | `8b37ef2b-0bd2-4812-9e81-1ccae8973322` |
| Meeting | "Yuriel Chua's Zoom Meeting", 2026-09-19, **68 seconds** |
| Transcript | **`null`** — confirmed over MCP on 2026-09-20. It has to be requested |

---

## ✅ THE TRANSCRIPT SHAPE IS KNOWN (2026-09-23)

A real transcript was generated for recording `3299fb14-…` and read back. This
was the last unknown blocking the mapping, and it is now answered. Raw files in
`D:/Claude Code/_scratch/recall/` — outside the repo, because a transcript is a
real conversation.

**The transcript is an array of speaker turns, word by word:**

```
[ { "participant": { "id": 1, "name": "Yuriel Chua", "is_host": true,
                     "platform": "unknown", "email": null, "extra_data": {…} },
    "words": [ { "text": "…",
                 "start_timestamp": { "relative": 27.88, "absolute": null },
                 "end_timestamp":   { "relative": 28.01, "absolute": null } },
               … 67 total ],
    "language_code": "en" } ]
```

Measured: 1 group, 67 words, 350 characters once joined, spanning 27.9s to
57.0s of a 68-second recording.

### Four things that decide how the mapping has to be written

1. **⚠⚠ THE ARTIFACT HAS NO BOT ID.** It carries `recording.id` and nothing
   else pointing anywhere. The known bot id does not appear anywhere in the
   serialised object. A recording carries it twice; a transcript carries it
   **zero** times. So the chain is **transcript → recording → bot → tenant**,
   and `botIdOf` returns null on a transcript-shaped payload today. Full note
   and the two workable fixes are in `lib/meetings/payload.ts`.

2. **⚠ `absolute` timestamps are null. Only `relative` seconds exist.**
   `messages.sent_at` is a `timestamptz`, so it has to be computed as
   `recording.started_at + relative`. Reading `relative` as an epoch puts every
   utterance in January 1970 — which sorts correctly among itself, so a
   meetings-only view would look perfectly normal. Exactly the WhatsApp
   seconds-vs-milliseconds trap in a new costume (AGENTS.md §6).

3. **⚠ `participant.email` is null.** Zoom does not hand over addresses, so
   identity resolution cannot match a speaker to an existing contact by email
   the way Gmail does. It has a display name and nothing else. Do not assume
   `contact_identities` will resolve a speaker — decide what happens when it
   cannot.

4. **It is word-level, not sentence-level.** A message body is
   `words.map(w => w.text).join(' ')`. There is no punctuation-aware sentence
   split in the payload, so anything wanting sentences has to make them.

⚠ `platform` read `"unknown"` on a Zoom call. Do not use it to decide anything.

### The decision this now unblocks

One meeting is one group per speaker turn. A short solo test produced one; an
hour of four people talking produces hundreds. **One timeline row per
utterance would bury a week of mail under a single meeting.** The intended
shape stays the one written under *What to do next*: one row per meeting, with
utterances stored and embedded behind it.

---

## The webhook is broken on Recall's side, and it is not our bug

Recall's dashboard webhook page is an embedded Svix portal. **The Create button
does nothing**, in Chrome and in Edge. There is **no webhook path anywhere in
`list_rate_limits`**, which lists every endpoint they publish — so it cannot be
created through the API either.

⚠ An earlier diagnosis in this project blamed an *account write restriction*.
**That was wrong**, and `list_rate_limits` disproved it: every write endpoint
reports `source: "default"`. If you find that claim in an older note, it is
stale.

Support was emailed 2026-09-19 ~01:39. **No reply as of 2026-09-22** — worth
chasing.

**None of this blocks Phase 7.** `GET /bot/{id}`, `/recording/{id}` and
`/transcript/{id}` are all public at 300/min. A webhook is Recall telling us;
polling is us asking. Same answer. The signed webhook route stays built and
tested so it works the day they fix their portal.

---

## Current numbers, verified 2026-09-23

| | |
|---|---|
| Branch | `main` at `65d791d`, pushed, working tree clean |
| Tests | **639 passing**, 42 files |
| Typecheck | clean |
| Latest migration | **0017** |
| Console | deployed by Vercel off the push |
| Worker | ⚠ **still the old image.** See the warning above |

---

## What to do next, in order

1. **Deploy the worker** once `az login` is done. Production extraction is
   broken until then — this outranks everything else here.
2. ✅ **Done 2026-09-23.** The transcript was fetched and its shape read. See
   the section above — and note the artifact does NOT carry a bot id, which
   changes how the tenant is resolved on that path.
3. **Map transcript → `messages` + segments.** Not before step 2. The Vapi
   payload-shape guess cost most of a day and this is the same class of unknown.
4. **Per-person roll-up on `/contacts`** — the actual "brief" view, and the one
   thing here that needs no Recall, no Azure and no key. Good work to do while
   blocked.
5. **Chase Recall support.**

### ⚠ The design decision waiting at step 3

**A meeting is not a message, and the schema currently says it is.** One
hour-long meeting is 200–500 separate things said. If each becomes a row, a
single meeting buries a week of Gmail and WhatsApp under it and the timeline
stops being a timeline.

Three ways, and the third is the one to build:

| | | |
|---|---|---|
| **A** | One row per meeting, transcript on its own page | Clean, but nothing said inside a meeting is findable |
| **B** | One row per utterance | Dies on contact. Floods everything |
| **C** | One row per meeting in the timeline, every utterance stored and embedded behind it | **This one** |

**C** keeps the timeline readable and still answers *"what did Maria say about
the deadline"* with the actual sentence and a citation. It costs almost nothing
extra: extraction and embeddings already run per message, so utterances inherit
both.

⚠ Decide this **after** reading a real transcript, not before. The shape may
make one of these obviously wrong.

### Smaller, still open

- ✅ **Done 2026-09-23** — the agent prompt and three tool descriptions were
  pasted into Vapi by hand. ⚠ Nothing in this repo deploys to Vapi, so this has
  to be repeated every time Uriel's abilities change. `docs/03-RESOURCES.md`
  §4d is the checklist.
- Restrict Vapi's Public Key **Origins** from "All domains allowed" to the
  Vercel domain.
- Delete `components/ui/shader-svg.tsx` — 225 lines, orphaned.
- `EMBED_API_SECRET` appears to be set nowhere. Confirm, then decide.
- **Split view caps at about four lanes.** Facebook Messenger is Phase 7C; at
  four lanes each is ~265px again. Decide then whether the fifth scrolls
  sideways or drops out of split.
- **Merged is arguably the better default view.** The product's promise is
  "what happened, in the order it happened", which is merged; split is a triage
  view. Right now split loads first. Yuri's call.

---

## How Yuri wants to be talked to

Short. Plain English. Direct answers, no preamble. They have said
*"TO THE POINT PLS WHAT DID YOU DO?"*, *"simpler"*, *"SHORTER"*, and *"IN SIMPLE
ENGLISH PLS"* — repeatedly, in this order. Lead with the answer.

**Standing constraints:**

- Heavy work goes on **disk D**, never disk C — C is short on space and it slows
  the machine down.
- **Do not touch Notion.**
- **Do not touch the SafeHands project.** Switchboard is the workspace.

---

## The habit this phase is built on

When two different causes present identically, **build something that measures
instead of guessing again.** It paid off five times in three days:

- Listing `/v1/models` against the live key ended the `groq http 404` mystery —
  every Llama model was gone.
- `list_rate_limits` disproved my *own* account-restriction theory.
- An HTML 404 body, where ours would have been plain text, proved a route was
  not deployed rather than mis-keyed.
- A query against the live schema found `channels.credentials` was `bytea NOT
  NULL` — Postgres had been saying so all along, to a log line that threw the
  message away.
- Sending one real bot answered a bot-id question the documentation could not.

And its pair: **verify before writing.** Svix's signing scheme, both constraint
names, Groq's real rate limits and Recall's async body were each read from the
source before code depended on them — explicitly because the Vapi payload-shape
guess cost a day.

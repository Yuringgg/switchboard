# Voice integration — the plan

*Written 2026-09-10, against Ms. Maria's research-and-planning list and the
Switchboard technical roadmap from the same meeting. Nothing here is built yet.
This is the design and the evidence behind it, so the decisions can be argued
before any code is written.*

---

## 1. What Ms. Maria asked for

From the meeting notes, the voice item has six parts. They are listed here as
acceptance criteria rather than prose, because three of them are measurable and
those are the ones that will decide whether this reads as finished:

| # | Her words | What it means concretely |
|---|---|---|
| V1 | Voice integration applied and **tested** on the switchboard | A working loop, verified, not a demo video |
| V2 | **7/10 responsiveness** | A latency number, defined below. Not a feeling |
| V3 | A **circular interface** | One orb, on `/assistant` |
| V4 | Chat and voice in **one page or room**, like ChatGPT | `/assistant` is the room. No second screen |
| V5 | **Chat detailed, voice short** | Two answer lengths from one pipeline |
| V6 | **English only** for now; Tagalog deferred | `language: 'en'` pinned, and a note saying why |

Plus the standing obligation: every feature documented on Notion, with an
explicit paragraph on how it aligns with the cybersecurity major. §7 is that
paragraph, written from real findings rather than filler.

---

## 2. The one number that defines "7/10"

Responsiveness has to be a stopwatch, or it is an opinion. The definition used
here is **end of speech to first audible word**, because that is the gap the
user actually sits through.

| Stage | How | Estimate |
|---|---|---|
| Detect end of speech | client-side silence detection, ~700 ms hangover | 700 ms |
| Upload the clip | ~5 s of webm/opus is roughly 40 KB | 150–300 ms |
| Transcribe | Groq `whisper-large-v3-turbo`, 216x realtime | 300–500 ms |
| Embed the question | existing warm-worker `/embed` hop | 200–400 ms |
| Retrieve | `match_chunks` over pgvector | 100–200 ms |
| Generate a SHORT answer | Groq, ~60 output tokens | 600–1200 ms |
| Start speaking | browser `speechSynthesis`, local | ~50 ms |
| **Total** | | **2.1–3.4 s** |

That band is a defensible 7/10. For calibration: under 1 s is what a realtime
speech-to-speech API buys, and those neither retrieve from a private corpus nor
produce citations, so they cannot serve this product. Over 5 s reads as broken.

**The single biggest lever on PERCEIVED responsiveness is not in that table.**
It is drawing the mic level on the orb while the person is still talking. The
dead air during speech is most of what makes a voice UI feel slow, and an
amplitude ring costs one `AnalyserNode` and no network. Build it in the same
pass as the orb, not later.

**Instrument every stage and print the milliseconds.** Then V2 is a reported
number rather than a claim — which is the difference between this passing and
this being argued about.

---

## 3. Architecture — three new pieces, and nothing existing is disturbed

```
  microphone
      |  MediaRecorder -> webm/opus, stops on silence, hard cap 30 s
      v
  +-----------------------------------------------+
  | POST /api/voice/transcribe        NEW #1      |   Next.js route, console
  |  - requires a signed-in session               |
  |  - forwards the blob to Groq Whisper          |
  |  - returns { text }; stores NOTHING           |
  +----------------------+------------------------+
                         |  the transcript, as text
                         v
  +-----------------------------------------------+
  | askAssistant()                    EXISTING    |   unchanged retrieval,
  |  + mode: 'voice' appends a brevity note        |   unchanged floors,
  |                                   NEW #2       |   unchanged refusal
  +----------------------+------------------------+
                         |  { answer, citations, refused }
                         v
  +-----------------------------------------------+
  | speechSynthesis.speak(answer)     NEW #3      |   browser, free, local
  | the ORB: idle/listening/thinking/speaking      |
  | citations still RENDER on screen               |
  +-----------------------------------------------+
```

Three additions. No migration, no new table, no new blob container, no change to
`match_chunks`, no change to the retrieval floors, and no change to the text
path's prompt.

**That last point is the design constraint everything else bends around.** The
assistant scored `answerable 6/6, must-refuse 7/7` on 2026-08-03 and a full eval
costs most of a day's token budget. A change that alters the prompt for every
question forfeits that score as a baseline. So the voice brevity instruction is
**appended only when `mode === 'voice'`** — exactly the pattern
`buildAssistantPrompt` already uses for `derivedNote`, and for exactly the same
stated reason. A typed question gets a prompt identical byte-for-byte to the
measured one.

---

## 4. Speech to text: Groq Whisper, not Gemini

The meeting note records *"Yuri is utilizing Gemini for audio-to-text
transcription."* The evidence points the other way, and this is worth raising
with Ms. Maria rather than quietly doing something else.

**Verified 2026-09-10 from Groq's own documentation:**

| | `whisper-large-v3-turbo` |
|---|---|
| Free-tier rate | **20 req/min · 2,000 req/day** |
| Free-tier audio | **7,200 audio-seconds/hour · 28,800/day** — eight hours of speech a day |
| Speed | 216x realtime — a 5-second clip is ~23 ms of compute |
| Word error rate | 12% |
| Max upload, free tier | 25 MB |
| Formats | flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, **webm** |
| Endpoint | `POST https://api.groq.com/openai/v1/audio/transcriptions` |

Five reasons it wins here:

1. **The key already exists.** `GROQ_API_KEY` is configured in both the console
   and the worker. No new vendor, no new credential in the rotation list.
2. **The limits are published and generous.** 28,800 audio-seconds a day will
   never be the binding constraint on this project.
3. **Google no longer publishes free-tier limits** — the rate-limit page now
   defers to per-account values in AI Studio, so the number cannot be verified
   from documentation at all. The last measurement this project made of Gemini
   2.5 Flash's free tier was **20 requests per day** (2026-08-02, read off the
   quota error). If that still holds, twenty spoken sentences exhausts it.
4. **It is a different Groq bucket** from the assistant's
   `llama-3.3-70b-versatile`. Groq's limits are per-model, so transcription can
   never starve the assistant — the same failure-isolation argument ADR-003
   makes, applied again.
5. It is OpenAI-compatible, so swapping providers later is a base-URL change.

**This is not overruling her.** It is the same move this project already made
when it took the assistant off Gemini in ADR-003's amendment, for the same
measured reason. Present it that way.

CAUTION: **`whisper-large-v3-turbo` transcribes only.** The translation endpoint is on
the non-turbo `whisper-large-v3`. That matters the day Tagalog comes back on the
table (V6), and not before.

---

## 5. Text to speech: the browser, not an API

`window.speechSynthesis` is in every target browser, costs nothing, has no
quota, needs no key, and starts speaking in about 50 ms because it never leaves
the machine.

The trade is honest: voice quality is OS-dependent and can sound synthetic next
to a neural voice. Two things make that acceptable for now —

- Pick the voice deliberately at runtime rather than taking `[0]`. Prefer a
  local `en-US`/`en-GB` voice; the default is often the worst one installed.
- **Network TTS costs the responsiveness score directly.** A neural voice adds
  300–800 ms to the number in §2, and V2 is a stated requirement while voice
  timbre is not. If Ms. Maria says it sounds cheap, swap the implementation
  behind the same interface and re-measure — but measure first.

Upgrade path if she does: Groq's Orpheus TTS, or Azure Neural TTS on the F0 tier
(0.5M chars/month, already recorded in `docs/03-RESOURCES.md` — but note that
file's standing warning that F0 may be region-blocked on student subscriptions).

CAUTION: **`speechSynthesis` will not speak without a user gesture** in Chrome and
Safari. The tap that starts the recording is that gesture, so the loop works —
but a voice answer triggered any other way fails silently, with nothing in the
console. Do not discover this during a demo.

---

## 6. The constraint nobody has flagged yet, and it is the real risk

**The assistant is capped at roughly 30 questions per day, shared across every
tenant.** That is measured, not estimated — `AGENTS.md` and
`docs/03-RESOURCES.md` §4a-bis both record it, derived from live 429s. Groq's
limits are scoped to the organization and this deployment holds one key.

**Voice makes asking a question about five times easier than typing one.** The
whole point of V2 is to remove that friction. Removing it against a 30-a-day
shared cap means the budget is gone before lunch, and the failure looks like
*"the assistant's daily allowance is used up"* to a person who has asked nothing.

Transcription is not the problem — 2,000 requests a day. **The answer is.**

Three responses, in the order they should be built:

1. **Route voice answers to `llama-3.1-8b-instant`, behind a flag.** It is a
   different bucket: 14,400 requests/day against the 70B's 1,000, and it does
   not touch the assistant's budget at all. It is also *already* the model that
   writes summaries and extractions, so its behaviour on this corpus is known.
   Ms. Maria's own requirement is that voice answers be short — which is the
   thing an 8B model is least likely to get wrong.
   CAUTION: **flag-gated and measured before it is default.** Run the existing
   `eval-assistant.ts` against it and check the refusal score holds. A voice
   assistant that invents a meeting is the exact failure ADR-007 exists to
   prevent, and it is worse aloud than on screen because nothing is left on the
   page to check. Follow `ASSISTANT_GROUND_EXTRACTIONS`' precedent.
2. **A short-lived answer cache.** The same question asked twice in five minutes
   should not cost two completions. Voice invites repetition — people re-ask
   when they mishear.
3. **A per-user throttle.** This is open question Q11, already on the books, and
   voice is what turns it from theoretical into real.

Raise this with Ms. Maria. It is the kind of measured finding she responds to,
and it is better said before the demo than during it.

---

## 7. The cybersecurity write-up — real findings, for Notion

Ms. Maria asked that each feature be documented with how it aligns with the
cybersecurity major. Voice input genuinely does, and these are not after-the-fact
justifications: each one changed a decision above.

**Application security**

- **The Web Speech API was rejected for input, on privacy grounds.** Chrome's
  `SpeechRecognition` sends raw microphone audio to a Google service for
  processing — MDN states this plainly, and it is why the API does not work
  offline. There is no data-processing agreement between that service and this
  deployment, and a spoken question to Switchboard routinely contains a client's
  name. Recording locally with `MediaRecorder` and transcribing through a vendor
  already inside the trust boundary is the smaller surface. (MDN also lists the
  API as *Limited availability* — effectively Chrome-only, so it fails on
  portability as well.)
- **The API key never reaches the browser.** Transcription is a server route;
  the client posts audio and receives text. The same rule ADR-013 sets for
  `service_role`, applied to a new secret.
- **The transcript is untrusted input and is capped.** It joins the existing
  500-character slice in `askAssistant`. Prompt-injection rule 5 already covers
  message content; the transcript is the user's own words, but the cap is what
  stops a runaway recorder producing a multi-thousand-word prompt.

**Network security**

- Audio crosses exactly one hop, over TLS, to one vendor already in the trust
  boundary. No third-party audio egress, no new outbound destination to monitor.

**Endpoint security**

- Microphone access is an explicit per-origin permission, granted by user gesture
  and revocable in the browser. The recorder must be **visibly** running and
  **hard-capped at 30 seconds**, so a stuck recorder cannot stream a room.
- **Nothing is persisted.** The audio blob goes out of scope after the request.
  No new table, no new blob container, no retention question, and nothing new
  under RA 10173 (Data Privacy Act of 2012).

**Cloud security**

- The shared-quota problem in §6 is a denial-of-service against ourselves, and
  that is the honest way to frame it: one user, or one stuck loop, can exhaust a
  shared resource for every tenant. Rate limiting is a security control here, not
  a cost control.

**And the boundary that must not move:** this is a person dictating a query. It
is **not** call recording, which ADR-008 rules out on three independent grounds —
Ms. Maria excluded it, WhatsApp provides no native recording, and **RA 4200 makes
recording a private communication without all-party consent a criminal offence in
the Philippines, including by a participant.** The 30-second cap, the visible
recording state, and the fact that nothing is stored are what keep this obviously
on the right side of that line. Say so explicitly in the Notion entry.

---

## 8. The circular interface

One orb on `/assistant`, five states. Reuse the existing `GhostState` vocabulary
from `assistant-ghost.tsx` so the console keeps one design language rather than
growing a second.

| State | What the orb does |
|---|---|
| `idle` | slow breathing ring — "tap to speak" |
| `listening` | **ring amplitude follows the live mic level** |
| `thinking` | the existing mesh-gradient busy state |
| `speaking` | pulses on `speechSynthesis` boundary events |
| `refused` | goes still. No pulse |

CAUTION: **the `refused` state is not cosmetic.** `assistant-ghost.tsx` carries the rule
already: the figure *"may never look like it is speaking when it has not cited
anything."* Aloud this matters more, not less — a spoken answer leaves nothing on
screen to check, so the refusal has to be audible as a refusal.

**The citation contract survives voice, unchanged.** An answer that cites nothing
is spoken as the refusal sentence. What is spoken is the short answer; the full
answer and its citation chips still render on the page underneath, exactly as
they do today. Voice does not read the citations aloud — it does not get to skip
them either.

Accessibility: everything the orb expresses must also be text in the mono machine
voice, on the same reasoning `assistant-ghost.tsx` gives. And the keyboard path
must reach the whole feature — a mic button that is mouse-only fails on a screen
this central.

---

## 9. Phasing

| | Scope | Time |
|---|---|---|
| **V0** | **BUILT 2026-09-10.** See §9a below | half a day |
| **V1** | **BUILT 2026-09-10.** See §9b below | 1–2 days |
| **V2** | Silence detection, the mic-level ring, per-stage latency instrumentation. **This is what turns the 7/10 into a reported number** | 1 day |
| **V3** | Deferred: streaming TTS, Tagalog, a neural voice if asked | — |

**Do V0 first and do not skip it.** Three things in this plan are assumptions
about a browser and a provider that cost ten minutes to check and half a day to
discover late: the recorder's actual output mimeType (Chrome gives
`audio/webm;codecs=opus`, Safari gives `audio/mp4` — both are on Groq's accepted
list, but *verify*), whether the gesture requirement in §5 behaves as documented,
and whether a real 5-second clip round-trips inside the §2 budget.

That is this project's own standing lesson: four documented claims were falsified
on 2026-08-03 alone, and three were found by checking something checkable in
seconds.

### 9a. What V0 is, and how to run it

Built 2026-09-10. Four files:

| File | What it does |
|---|---|
| `packages/ai/src/transcribe.ts` | Calls Groq Whisper. Returns text. Reports errors, never throws |
| `apps/console/src/app/api/voice/transcribe/route.ts` | The server route. Checks the session, keeps the key off the browser, stores nothing |
| `apps/console/src/components/voice-lab.tsx` | Records the clip and prints the result |
| `apps/console/src/app/voice-lab/page.tsx` | The page. Development only |

Plus 12 tests in `packages/ai/test/transcribe.test.ts`. The suite is now **553**,
and `tsc` and `next build` are both green.

**To run it:**

```bash
pnpm dev
```

Then open `http://localhost:3100/voice-lab`, signed in. Press the circle, say a
sentence, press stop.

**What it prints, and why those things:** the transcript, then the format the
browser actually recorded, the clip length, the upload size, Groq's own time,
and the full round trip. Those are the three unknowns §9 says to settle before
V1 gets built on top of them.

**What to check on the first run:**

1. **Is the recorded format on Groq's list?** It prints what the browser chose.
   Chrome should say `audio/webm;codecs=opus`.
2. **Is the round trip under about 900 ms?** The page says so directly. If it is
   much slower, §2's budget needs revisiting before V1.
3. **Is the transcript right?** Try a sentence with a name in it. Names are what
   Whisper gets wrong, and this product is full of them.

**One thing found while building it:** `GROQ_API_KEY` was set in
`apps/worker/.env` but **not** in `apps/console/.env.local`. The console reads it
too — the assistant has always needed it — so `/assistant` could not have worked
on this machine locally either. Copied across on 2026-09-10. Both files are
gitignored. It was presumably only ever set on Vercel.

CAUTION: **V0 has not been run by a person yet.** It compiles, the tests pass and
the route is registered, but the browser pane in this environment has no
microphone, so the record-and-send loop could not be exercised. The three checks
above are exactly what has not been confirmed. Do not treat V0 as done until
someone has pressed the button.

---

### 9b. What V1 is

Built 2026-09-10. `/assistant` is now one room: the orb asks out loud, the box
below types, both go through the same server action and the same retrieval.

**New files**

| File | What it does |
|---|---|
| `apps/console/src/lib/use-voice-capture.ts` | The recorder. Shared with `/voice-lab` so there is one implementation, not two |
| `apps/console/src/lib/speak.ts` | Reads the answer out. Picks a voice, strips citation markers |
| `apps/console/src/components/assistant-orb.tsx` | The circle. Seven states, CSS only |

**Changed**

| File | Change |
|---|---|
| `packages/ai/src/assistant.ts` | `AssistantMode`, and `VOICE_BREVITY_NOTE` appended only for voice |
| `packages/ai/src/assistant-provider.ts` | `GROQ_VOICE_MODEL`, and a `model` override |
| `apps/console/src/lib/assistant.ts` | `askAssistant` takes a mode. Returns `mode` and `transcript` |
| `apps/console/src/components/assistant-panel.tsx` | The orb, the voice loop, the "Heard" block |
| `apps/console/src/app/assistant/page.tsx` | Reads `mode` off the form |
| `apps/console/src/app/preview/page.tsx` | A `?state=spoken` fixture |
| `apps/console/src/components/voice-lab.tsx` | Rewritten onto the shared hook |

**569 tests**, up from 553. `tsc` and `next build` green.

#### The four decisions inside it

**1. The text prompt did not change, and a test enforces that.** A typed
question builds the byte-identical prompt it built before voice existed. The
brevity note is pushed onto the array only in the voice branch — pushing it
unconditionally, even as an empty string, would add a newline to every prompt
and forfeit the 6/6 and 7/7 baseline. `assistant-voice.test.ts` asserts a voice
prompt is exactly the text prompt plus the note.

**2. Voice answers still cite.** The obvious version of the brevity note says
"do not cite, you are being read aloud". That would break the product quietly:
`parseAnswer` decides a refusal by counting citations, so every spoken answer
would parse as a refusal. Instead the model still cites, the chips still render,
and `forSpeech` removes the `[n]` markers in the browser just before speaking.

**3. What was heard is shown on screen.** Whisper mishears names and this corpus
is mostly names. Without the transcript, a wrong answer to a misheard question
looks the same as a wrong answer to the right one.

**4. The 8B model is wired but OFF.** `VOICE_ASSISTANT_SMALL_MODEL=1` routes
spoken questions to `llama-3.1-8b-instant`, which is a different quota bucket and
costs the assistant's ~30/day nothing. It is off because nobody has measured its
refusal behaviour. Run `eval-assistant.ts` against it first.

#### A bug the tests caught

`forSpeech` stripped `[2026]` out of a sentence about an invoice, because the
first version matched `\[\d+\]`. The spoken answer still sounded like a fluent
sentence — with a fact missing from it. Citation indices never exceed
`MAX_CONTEXT_MESSAGES` (8), so the pattern is now bounded to one or two digits.
Worth noting because it is the failure mode voice makes worse: on screen you
would see the year was gone, aloud you would not.

CAUTION: **V1 has not been looked at.** The build is green and the tests pass, but the
preview tool in this environment stays pinned to a different project, so no page
was rendered and no answer was spoken. Two things to check first: whether the
orb's live ring actually tracks your voice, and whether the spoken answer is
short enough to be worth listening to. `/preview?screen=assistant&state=spoken`
shows the answer layout with no microphone and no quota spent.

---

**One synergy worth noting:** `/api/voice/transcribe` is most of what US-11
(*"voice notes transcribed and made searchable alongside text"*) needs. WhatsApp
voice notes are media attachments; once the transcription route exists, the
worker can call the same Groq endpoint on ingest. A stretch goal moves within
reach as a side effect of a required one — worth mentioning to Ms. Maria, since
it makes this feature pay for itself twice.

---

## 10. Open decisions for Yuri

1. **Groq Whisper instead of Gemini for transcription** (§4). Recommended, on
   published limits versus an unverifiable one. Needs a word to Ms. Maria.
2. **Voice answers on the 8B model** (§6). Recommended, flag-gated, measured
   before it becomes the default. This is the one that protects the demo.
3. **Browser TTS for now** (§5). Recommended. Revisit only if she says the voice
   sounds cheap, and re-measure §2 if so.

---

## 11. Vapi — the hosted voice agent (V2)

Added 2026-09-10, after Yuri found Vapi. This does **not** replace V1. V1 is
voice inside the console: free, private, no vendor. Vapi is a phone call you can
actually ring, which is a different capability and a much stronger demo.

The prompt is in `correspondence/2026-09-10-vapi-agent-prompt.md`.

### How it fits together

```
  phone / web call
        |
   +----------------+   Vapi hosts the call: speech in, model, speech out
   |     VAPI       |
   +-------+--------+
           |  POST, HMAC-signed, when the agent uses a tool
           v
  /api/webhooks/vapi          <-- no cookie, no session, service_role
        |
        |  1. verify HMAC over the raw body
        |  2. read message.call.id
        |  3. look it up in voice_call_sessions  <-- THE TENANT BOUNDARY
        |  4. no row or expired -> refuse
        v
  the four tools, every query filtered by owner_id
```

And the other half, which is what makes step 3 possible:

```
  console (signed in) -> vapi.start() -> call id
        -> POST /api/voice/call-session   <-- writes the row, RLS applies
```

### What was built

| File | What it is |
|---|---|
| `packages/db/migrations/0014_voice_call_sessions.sql` | The call-to-tenant table |
| `apps/console/src/lib/voice/call-session.ts` | TTL and call-id validation |
| `apps/console/src/lib/voice/tools.ts` | The four tools, each owner-filtered |
| `apps/console/src/app/api/webhooks/vapi/route.ts` | The webhook |
| `apps/console/src/app/api/voice/call-session/route.ts` | Registers a call |
| `apps/console/test/voice-tools.test.ts` | 16 tests, mostly on the tenant filter |

**585 tests.** `tsc` and `next build` green. `assert-rls.ts` updated for the new
table in the same commit, as ADR-012 requires.

### The one thing to understand about this route

Every other read in the console knows whose data it is looking at because a
session cookie arrives and RLS does the rest. **This one does not.** It runs as
`service_role`, where every policy in migration 0002 is inert.

So the tools in `lib/voice/tools.ts` are **separate functions**, not reuses of
`fetchAttention`, `searchMessages` and `fetchContactDetail`. Those three take no
owner argument and each carries a comment saying an owner filter would imply the
policy is not doing its job — true there, and the exact opposite of true here.
Calling them with a service client would return every tenant's rows and read
them down a phone line.

The duplication is deliberate. Two paths with opposite security models should
not share code, because sharing is how one silently inherits the other's
assumptions.

CAUTION: **`searchMessagesForVoice` does not use the `search_messages` RPC.** That
function is `SECURITY INVOKER` and takes no owner argument — it relies entirely
on RLS. An owner-filtered `ilike` is less clever and it is correct. The ranked
full-text path can come back the day that function learns to take an explicit
owner.

### Why HMAC and not a bearer token

Vapi offers Bearer, `X-Vapi-Secret`, OAuth and HMAC. Only HMAC proves the
**body** was not altered; the rest prove the caller holds a token and nothing
about what they sent. On a route that decides whose mail to read, that is the
whole difference. Same choice, same reasoning, as the WhatsApp webhook.

### What is left

1. **Apply migration 0014** to Supabase.
2. **Set `VAPI_WEBHOOK_SECRET`** in Vercel and as an HMAC credential in Vapi.
3. **Create the four tools in Vapi**, server URL
   `https://<domain>/api/webhooks/vapi`.
4. **Wire `vapi.start()`** in the console and call `/api/voice/call-session`
   with the returned id.
5. **Bring your own keys in Vapi** so STT, model and TTS bill at $0.

CAUTION: **A race worth knowing about.** The call exists at Vapi before the session
row exists here. A tool fired in that window is refused and the caller hears
"I can't reach your messages" — it fails in the safe direction, and a retry
works. The clean fix is creating the call server-side through Vapi's REST API so
the row always exists first. Worth doing before a demo, not worth blocking the
first working call on.

CAUTION: **None of this has been run against a live call.** The tests cover the tenant
filter, the empty-versus-error distinction and the call-id validation, but no
real Vapi request has hit this route. The first one will find something; that is
what first ones do.

---

*Sources verified 2026-09-10: Groq speech-to-text and rate-limit documentation;
Vapi custom tools, server authentication, and server events documentation;
Vapi pricing ($0.05/min hosting, $0 for STT/LLM/TTS with your own keys);
MDN `SpeechRecognition`. Gemini free-tier limits could NOT be verified — Google's
rate-limit page now defers to per-account values in AI Studio, so this project's
own 2026-08-02 measurement of 20 requests/day stands as the best evidence, and
should be re-measured in AI Studio before anyone relies on it either way.*

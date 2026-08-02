# Handoff — Phase 4B, the assistant, and what measurement disproved

**2026-08-02 (evening).** Written for a session joining cold, and for Yuri. Read
`AGENTS.md` first — especially **§7**, which carries the verified numbers — then
this.

**Phases 3 (search), 4A (summaries) and 4B (assistant) are all shipped and
deployed.** Phase 5 is next.

---

## 1. Where things actually are

Verified by querying the live system on 2026-08-02, not inferred from code:

| | |
|---|---|
| Messages | **75** · 63 conversations · 21 contacts · 2 users |
| Summaries | **66 / 66 eligible** (100%) |
| Embeddings | **75 / 75 messages, 397 chunks** (100%), 0 missing |
| Queue | 78 `raw_events` — **0 stuck, 0 failed** |
| Channels | 1 Gmail, 0 in error. Watch expires **2026-08-08** |
| Worker | revision `--0000013`, healthy, `{"embedder":true}` |
| Console | every route 307 → `/login` |
| Tests | **356** · typecheck, `next build`, worker bundle, `assert-rls` all green |
| CI | green |

**The pipeline runs unattended end to end.** A new email arrives → webhook →
`raw_events` → worker normalises → **summarises** → **chunks and embeds** →
timeline. All three steps were confirmed on the newest message, which nobody
backfilled.

---

## 2. ⚠ Two documented decisions that measurement disproved

This is the part worth reading. Both docs were right when written and quietly
stopped being right.

### The similarity floor cannot carry the refusal — ADR-016

ADR-007 specified: refuse when nothing clears a similarity threshold, without
calling the model. The roadmap says build the refusal before the happy path, so
it was built first — and measuring it showed it does not work:

```
lowest ANSWERABLE top score     0.8487   "what failed in CI?"
highest UNANSWERABLE top score  0.8563   "recipe for adobo my grandmother sent"
separation                     -0.0076
```

The question with **no answer anywhere in the corpus scored higher**. e5's
normalised embeddings sit in a 0.75–0.90 band, so absolute distance barely
signals relevance. **Ranking does** — every answerable question's top hit was the
correct message.

So the refusal moved onto the model, a **relative** floor replaced the absolute
one, and the low absolute floor survives only as an empty-corpus backstop.
`apps/worker/scripts/probe-floor.ts` re-measures it. **Re-run that after any
change to the model, the chunker, or the e5 prefixes** — all three move the
distribution.

### Gemini's free tier is 20 requests/day, not 250 — ADR-003 amended

Read straight off the quota error:

```json
"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
"quotaValue": "20", "model": "gemini-2.5-flash"
```

`docs/03-RESOURCES.md` recorded 250. One run of this project's own 15-case eval
needs 15 requests — 75% of a day — which is how it was found.

The assistant now defaults to **Groq `llama-3.3-70b-versatile`** (1,000/day).
Summaries stay on `llama-3.1-8b-instant`, so the two cannot exhaust each other —
ADR-003's isolation argument, satisfied inside one vendor.
`ASSISTANT_PROVIDER=gemini` reverts it in one variable.

---

## 3. ⚠ The assistant is capped at ~30 questions/day

Measured, not documented. One question costs **3,000–3,500 tokens** (system
prompt + 8 retrieved messages). Groq's 70B allows 12,000 tokens/min and
~100,000 tokens/day:

- **~30 questions per day** ← the real ceiling
- ~3–4 questions per minute
- 1,000 requests/day never binds

Observed directly: a request refused while `x-ratelimit-remaining-tokens: 12000`
— a full per-minute budget, rejected, which only the daily token cap explains.

**Do not burn the day's budget the morning of a demo.** Search, embeddings,
summaries and ingest have no such limit; embeddings are local and cannot fail.

Two levers if it needs raising: cut `MAX_CONTEXT_MESSAGES` 8 → 4 (roughly
doubles the questions, costs quality on broad ones), or move to the 8B model
(14,400/day, but measurably worse at refusing).

---

## 4. ⚠ The prompt owes one tuning pass

Stated plainly because it is the one loose end.

| | Answerable | Must-refuse |
|---|---|---|
| Before hardening | **7/7** | 3/8 — cited all 8 messages for a question about a submarine |
| After hardening | 5/7 | **5/5** |

It now over-refuses two answerable questions — *"do I have upcoming meetings?"*
and *"summarise what needs my attention"*. That is the **safe** direction to fail
(ADR-007: a fabricated meeting is worse than no answer), but it is not finished.

**Tune with `apps/worker/scripts/eval-assistant.ts`, never by eye.** Some runs
fail on `groq rate limit` — that is the daily token cap, not a logic failure;
re-run the next day rather than chasing it.

---

## 5. Things that will bite a future session

- **⚠ Graceful degradation cannot survive OOM.** `warmEmbedder()` is deliberately
  non-fatal so an image missing native ONNX binaries degrades to "no semantic
  search" instead of crashlooping. It did not help: the worker was sized
  0.25 vCPU / 0.5 GiB and the kernel SIGKILLed it (exit 137) with nothing logged.
  Now 0.5 / 1.0 GiB. **Size memory before loading a model** — an error handler
  is not a substitute. Cost roughly doubled to ~$20–30/month.
- **⚠ tsup's `noExternal` WINS over `external`.** While `noExternal` matched
  everything, the `external` list was silently ignored: the build inlined
  Transformers, emitted five native `.node` files, **reported success**, then
  failed at runtime with `(0, backend_2.listSupportedBackends) is not a
  function`. It now excludes them with a negative lookahead.
- **⚠ CI does not repoint the Container App.** It pushes an image to ghcr; the
  app runs one pinned by digest. Repoint by hand or the deployed worker runs old
  code while the commit looks deployed.
- **⚠ Changing any `package.json` means running `pnpm install` and committing
  `pnpm-lock.yaml` in the same commit.** A missing lockfile update kept CI red
  from 2026-07-28 to 2026-08-02 — every push failed at
  `pnpm install --frozen-lockfile` before running a single test, including four
  docs-only commits. It stayed invisible because `pnpm` was not installed
  locally, so the failing command could not be reproduced.
- **The e5 prefixes are applied inside `embedQuery`/`embedPassages`**, never at
  call sites. `query:` for questions, `passage:` for stored text. Omitting them
  does not error; it just ranks worse.
- **An answer that cites nothing renders as a refusal.** That is a success
  criterion (`docs/01-PRODUCT-SPEC.md` §7), not a UI detail.

---

## 6. What is next

**Phase 5 — extraction, "needs attention", calendar write-back.** Everything it
needs already exists: Groq is wired, `extractions` already takes new `kind`s
(migration 0008 widened the constraint), and the OAuth consent already carries
`calendar.events`, so no second consent screen is needed.

⚠ **ADR-010 is absolute: never auto-create a calendar event.** Propose, show the
source message beside it, let the user edit and confirm. `calendar_event_id` is
checked before every insert so re-running extraction cannot duplicate an event.

Also outstanding:

- **Phase 2 (WhatsApp)** — still Yuri's Meta clicks.
- **Phase 3 remainder** — contacts, manual identity merge, attachments (Azure
  Blob approved 2026-08-02, not provisioned), virtualization.
- **Search results do not show summaries yet** — the timeline does. The RPC needs
  a column added.
- **Ms. Maria** — her BRD / "answers and recommendations" (Q6) and the Fatima
  scope conversation (Q8) are still outstanding. The Notion write-up
  (`docs/00-CONTEXT.md` §6 item 2) is still pending.
- **⚠ Rotate the Groq and Gemini keys** before this repo is shown to iOzera. Both
  were pasted into a chat transcript on 2026-08-02 at Yuri's explicit
  instruction. Nothing was committed; `.env` is gitignored.

---

## 7. How this session verified things

Four documented decisions have now been contradicted by measurement on this
project — ADR-012, ADR-014, ADR-016, and ADR-003's provider choice. The pattern
is identical every time: **the doc was correct when written and quietly stopped
being correct.**

What caught them:

- **Reading a provider's own rate-limit headers** rather than its docs page.
  That is how both the Gemini 20/day and the tokens-vs-requests findings came
  out, and neither was discoverable any other way.
- **Querying the live database** rather than reasoning about the code. RLS
  scoping, constraint behaviour and coverage counts were all confirmed that way,
  and every schema change was **negative-controlled** — broken on purpose to
  prove the test fails.
- **Running it.** The chunker's mid-word split, the 3,690-chunk pathology, the
  tsup bundling failure and the OOM were all found by execution. None would have
  survived a code review either.
- **Measuring the DOM** instead of eyeballing, since there is no screenshot
  capability here. ⚠ Disable CSS transitions first — `getComputedStyle`
  immediately after toggling `.dark` returns a value interpolated from the
  *other* theme, which reads as a contrast failure that does not exist.

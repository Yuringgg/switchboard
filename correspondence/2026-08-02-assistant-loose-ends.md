# Handoff — the assistant's over-refusal was a misdiagnosis, and three loose ends

**2026-08-02 (late).** Written for a session joining cold, and for Yuri. Read
`AGENTS.md` first — especially **§7** — then `2026-08-02-phase-4b-assistant.md`,
then this.

Everything below was measured against the live system, not inferred.

---

## 1. The headline: the prompt was not the problem

Three documents — `AGENTS.md` §7, `docs/04-ROADMAP.md`, and Q9 in
`docs/06-OPEN-QUESTIONS.md` — all said the same thing: the hardened prompt
**over-refuses two answerable questions**, and owes one tuning pass. All three
prescribed the same fix: soften the prompt, re-measure.

**That diagnosis was wrong, and acting on it would have made the assistant
worse.**

The hypothesis was tested before it was acted on, using a new instrument that
costs **nothing**: `apps/worker/scripts/probe-context.ts` prints exactly what
reaches the model for every eval question. Embeddings are local and
`match_chunks` is Postgres, so the entire pipeline up to the model call is free.
That is what made it affordable to look before spending half a day's tokens.

### *"Summarise what needs my attention."*

The eight messages selected for the model were:

> a Deepgram welcome · a Coursera announcement · a Huawei promotion · two
> ScreenPal mails · a Nike SNKRS drop · a LevelBlue job alert

**Not one of the CI failures, deploy failures or the Supabase pause was in the
context at all.** The model was handed eight newsletters and asked what needs
attention. It refused. That is correct.

The cause is not the prompt. **e5 has no representation of *importance***, so the
nearest neighbours to "needs my attention" are prose that *sounds* urgent —
"Congrats!", "Ready to learn?", "Get ₱4,000 OFF". No prompt wording can summarise
a message the model was never given.

### *"Do I have any upcoming meetings?"*

Retrieval is fine here — four of six selected messages are meetings. The corpus
is the problem. Every meeting in it:

| Sent (Manila) | Subject | Body |
|---|---|---|
| **2026-08-02 19:59** | Meeting | "Meeting at 9pm tonight." |
| 2026-07-28 04:27 | Meeting | "Now" |
| 2026-07-27 23:17 | MEETING - 1AM | "YURI" |
| 2026-07-27 23:14 | MEETING | "YURI" |
| 2026-07-27 13:30 | (none) | "Meeting" |

All five outbound, four content-free. The model is shown the four from 27–28
July, told today is 2 August, and asked what is *upcoming*. **The refusal is
correct.**

And the one message naming a time was sent at 19:59; the eval ran at **22:40**.
Run it at 3pm and 9pm-tonight is upcoming; run it at 10pm and it is not. **The
case's expected outcome depended on the wall clock.** An instrument that changes
its verdict by the hour cannot be tuned against — and it was quietly inviting the
next session to keep softening the prompt until the model invented a meeting.

### Why this matters more than the two cases

Chasing 7/7 would have been **fabrication with a passing score**, and the
destination is already on record: the pre-hardening prompt scored 7/7 answerable
and **3/8 refusals**, citing all eight retrieved messages for a question about a
submarine. ADR-007's asymmetry is the whole product — a fabricated meeting is
worse than no answer.

Both questions are **Phase 5 features being asked of Phase 4B**:
`docs/01-PRODUCT-SPEC.md` US-7 (extracted meetings) and US-9 (a digest of what
needs attention), with **R14 already settling that upcoming meetings come from
extraction, not retrieval.** Full reasoning in **ADR-017**.

---

## 2. What actually changed in the assistant

**The prompt's decision is now three-way**, which is the part of the original
hypothesis that survived:

- **A.** Nothing here is about the question's subject → refuse
- **B.** One or more messages answer it directly → answer and cite
- **C.** Several are *about* the subject, none individually decisive → **report
  what they collectively show, citing each**

The discriminator is stated explicitly: *are these messages about the question's
**subject***, not *does any one settle it*. A two-way "does any message contain
the answer?" cannot tell A from C, and collapsing them is what refused questions
whose answer *is* the synthesis.

**Measured**, on a synthesis question retrieval can actually serve:

```
[PASS] What kinds of roles have I been sent job alerts about?
       retrieved=20 context=8 cited=8
       You have been sent job alerts about various IT roles, including Junior
       IT Systems Analyst [1], MIS/IT Specialist [2][7], IT Staff [3], …
```

Eight sources, every claim cited. Refusals held in the same run (Jakarta and
submarine both clean, 0 citations).

⚠ **A full 15-case run has NOT been done** — the daily token cap hit partway
through, with `x-ratelimit-remaining-tokens: 12000`, a *full* per-minute budget
refused. Run `eval-assistant.ts` unfiltered tomorrow before claiming a score.

### The eval is now an honest instrument

- **Three expectations**, not a boolean: `answer`, `refuse`, `known-gap`. Gaps
  are still asked and printed every run, **not scored**, each carrying its
  measured reason and what would close it.
- **Two scores, never one.** A combined figure reads identically for a prompt
  that refuses everything and one that answers everything.
- **Provider errors counted separately.** A run that lost cases to quota must not
  read as a regression.
- **`--only "a,b,c"`** runs a subset. A full run is ~half the day's tokens, so
  "re-run after every change" previously afforded about two iterations. It takes
  a *list* deliberately: the useful narrow run is the case a change should move
  **plus the refusals that must not move with it**.
- Cases live in `eval-cases.ts`, shared with the probe, so the thing that
  diagnoses cannot drift from the thing that scores.

### The tests that were missing

**356 tests, and not one touched `packages/ai/src/assistant.ts`** — the module
holding `selectContext` and `parseAnswer`, the two pure functions that decide
what the model sees and whether its answer counts as a refusal. That is the
property `docs/01-PRODUCT-SPEC.md` §7 judges the product on. Now 33 tests do,
including "an uncited answer is a refusal", "a confident uncited claim is a
refusal", and "`[9]` when six messages were supplied is dropped, never resolved".

### One thing deliberately NOT changed

The relative floor cut the most decision-relevant message for the meetings
question by **0.0039** (kept a Coursera announcement at 0.8239, dropped the only
message naming a time at 0.8191), on a smooth distribution with no cliff in it.

It is **left alone**. Widening it would not have changed that question's correct
answer — 9pm had already passed — so moving it would be tuning against a case it
does not decide, which ADR-016 already identifies as how a threshold ends up
fitting five examples and failing the sixth. The measurement is recorded in
`RELATIVE_FLOOR`'s comment with the numbers, so the next person starts from
evidence rather than rediscovering it.

---

## 3. The three loose ends

### a) Citations link somewhere — `/messages/[id]` (ADR-018)

`docs/02-ARCHITECTURE.md` §4 step 6 specified *"jumps to the message in the
timeline"*. **That cannot work**: the timeline is capped at the newest 50, so a
citation to anything older resolves to nothing — and a citation that silently
fails to resolve reads as an invented source, which is the impression ADR-007
exists to prevent, arriving through the UI instead of the model.

A route resolves any message regardless of age, survives being shared or opened
in a tab, renders the **whole** body (the 4,000-char ceiling bounds the *list*,
not the record — as `BODY_LIMIT`'s own note anticipated), and is what **Phase 5
needs anyway**: ADR-010 requires the source message beside every meeting
proposal.

⚠ **This amends the "bodies render in exactly one place" rule.** Amended in
`docs/02-ARCHITECTURE.md` §6 with both places enumerated, not quietly broken.

⚠ A message that is not yours and one that does not exist are the **same**
`notFound()`. RLS makes them indistinguishable and that is correct — confirming
which ids exist in another tenant's mailbox is a leak even without the content.

### b) Search results carry summaries — migration 0010

The same message showed a summary in the timeline and nothing in search. Two
traps in this migration, and **both fail by hiding messages rather than
erroring**:

1. **`create or replace function` cannot change a `RETURNS TABLE`.** So the
   function is dropped and recreated — **and DROP takes the grants with it.**
   Without re-granting EXECUTE to `authenticated`, PostgREST answers every search
   `42501` and search breaks for every user while the migration reports success.
2. **The `kind` filter must sit in the JOIN condition, not the WHERE.** An inner
   join returns only summarised messages; a WHERE on the right-hand table of a
   LEFT join *becomes* an inner join, because an unmatched row yields
   `ex.kind IS NULL`. Either one silently loses the 10 unsummarised messages.

Negative-controlled against the live database: **76 rows, 66 with a summary, 10
without**; still SECURITY INVOKER; `authenticated` can execute and `anon` cannot;
owner sees 76, **second account sees 0**.

### c) The rate-limit message told people the wrong thing

*"The assistant is busy right now. Try again in a moment."* — correct for the
per-minute window, **wrong for the daily allowance**, which is the limit that
actually binds this project at ~30 questions/day. "In a moment" sends someone
clicking Ask at a wall for hours.

**⚠ The two are genuinely hard to tell apart, and the headers cannot do it.**
Measured on the live API:

- Groq publishes **no tokens-per-day header at all** — a 200 returns only
  `limit-requests: 1000` (per *day*) and `limit-tokens: 12000` (per *minute*).
- A daily-token rejection arrives carrying a **full** per-minute budget
  (`remaining-tokens: 12000`), so every visible signal says the assistant is fine.
- When the *request* limit trips, the token headers **vanish entirely**.
- The reset fields show continuous replenishment (`reset-requests: 1m26.4s` is
  exactly 86400/1000), so **"resets at midnight UTC" would be a falsehood** — do
  not write it in UI copy.

The limit type is named **only in the 429 body**, recorded by provoking a real one
on the *summaries* model so the assistant's budget was untouched:

```
on requests per minute (RPM): Limit 30, Used 30, Requested 1. Please try again in 2s.
```

So `packages/ai` reads the body **only on a 429**, extracts **only** the
`(RPM|RPD|TPM|TPD)` code, and discards it. Nothing from the body is returned,
stored or logged. That is a deliberate bounded exception to
`docs/02-ARCHITECTURE.md` §6, and §6 now records it. Nine tests pin it, including
one asserting the body never reaches the `reason` string.

---

## 4. What Yuri needs to do

Nothing is blocked on you, but three things are worth your time.

**1 — Make Ms. Maria's demo question actually work (2 minutes).** Right now
*"do I have any upcoming meetings?"* correctly refuses, because the newest
meeting in the mailbox is six days old. Send yourself one email:

1. Open Gmail as `leiruychua@gmail.com`.
2. Click **Compose**.
3. **To:** `leiruychua@gmail.com`
4. **Subject:** `Project sync with Ms. Maria`
5. **Body**, pasted exactly — and change the date to a real one a few days ahead:

   ```
   Confirming our project sync on Friday 7 August 2026 at 3:00 PM,
   at the iOzera office. Agenda: Switchboard demo and Phase 5 scope.
   ```

6. **Send.** It appears in the timeline within seconds.
7. Ask the assistant *"do I have any upcoming meetings?"* — it should now answer
   with a citation.

⚠ Use a date that is genuinely in the future when you demo. A past date is
exactly the situation that produced the misdiagnosis above.

**2 — Reconnect Gmail on the morning of any demo.** Next lapse **2026-08-08**.
`/channels` → Connect. One click.

**3 — Still outstanding, unchanged:** Ms. Maria's BRD / "answers and
recommendations" (Q6), the Fatima scope conversation (Q8), the Notion write-up,
the Meta developer account for Phase 2, and **rotating the Groq and Gemini keys
before this repo is shown to iOzera**.

---

## 5. State at handoff

| | |
|---|---|
| Tests | **389** (was 356) — 26 files |
| Typecheck · `next build` · worker bundle · `assert-rls` | all green |
| Migrations | **0010** applied and negative-controlled |
| Corpus | 76 messages · 398 chunks · 76/76 embedded · 66/66 eligible summarised |
| Queue | 0 stuck, 0 failed |

⚠ **Not done, and deliberately so:** a full unfiltered `eval-assistant.ts` run.
The daily token cap hit during the targeted run. **Run it tomorrow before
quoting any score.** The targeted run measured 1/1 answerable and 2/2
must-refuse.

⚠ **The Container App still runs an image pinned by digest, and CI does not
repoint it.** Nothing in this session changed worker behaviour — the assistant
runs in the console — so a repoint is not required for these changes to take
effect. `EMBED_API_URL`, `EMBED_API_SECRET` and `GROQ_API_KEY` are **still unset
on Vercel**, so `/assistant` will not answer in production until they are added
**and a new deployment is created** (Vercel binds variables at build time). Values
are in `docs/04-ROADMAP.md` Phase 4B.

---

## 6. How this session verified things

The pattern that keeps paying on this project, and did again:

- **Measure before you tune.** Three docs agreed on a diagnosis and all three
  were wrong. The free probe took minutes and cost no quota; acting on the
  documented hypothesis would have cost half a day's tokens and regressed the one
  property the product is judged on.
- **Build the cheap instrument first.** `probe-context.ts` exists because the
  expensive instrument could only be run twice a day. The constraint was the
  reason to look for a better tool, not a reason to guess.
- **Provoke the failure rather than reading about it.** The 429's shape — which
  field names the limit, which headers disappear — was not on any docs page, and
  it was obtainable for about 1,200 tokens on a model whose budget did not matter.
- **Negative-control every schema change.** 0010 was verified by counting rows
  with *and* without summaries, and by confirming the second account still sees
  zero. The inner-join version would have looked perfectly healthy at 66 rows.
- **Read the corpus, not just the code.** The whole finding came from five rows
  of `select … where body_text ilike '%meeting%'`.

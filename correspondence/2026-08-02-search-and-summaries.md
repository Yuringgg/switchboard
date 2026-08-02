# Handoff — Phase 3 search, Phase 4A summaries, and a red CI nobody could see

**2026-08-02.** Written for a session joining cold, and for Yuri. Read
`AGENTS.md` first, then `2026-07-28-phase-2-whatsapp.md`, then this.

Three things shipped and one long-standing breakage was found and fixed. All of
it is pushed, deployed, and verified against the live system rather than
inferred.

---

## 1. What is live now

| Piece | Where | State |
|---|---|---|
| Cross-channel search | `/search` on Vercel | live, gated (307 → `/login?next=/search`) |
| Per-message summaries | worker on Container Apps, revision `--0000009` | live, `[summary] enabled, model=llama-3.1-8b-instant` |
| Migration 0007 | search vector + `search_messages()` | applied, negative-controlled |
| Migration 0008 | `kind='summary'` + one-per-message | applied, negative-controlled |
| CI | GitHub Actions | **green for the first time since 2026-07-28** |

343 tests (was 295). `pnpm typecheck`, `pnpm test`, `next build`, the worker
bundle and `assert-rls` all pass — run as the exact CI sequence, not
approximated.

---

## 2. ⚠ CI had been red for five days and the docs said it was green

Runs **#31 through #39** every one failed, at the first step, before running a
single test:

```
ERR_PNPM_OUTDATED_LOCKFILE
specifiers in the lockfile don't match specifiers in package.json:
* 1 dependencies were added: @switchboard/core@workspace:*
```

**Phase 2 added `packages/adapters/whatsapp` and new dependencies to
`apps/console` and `apps/worker` without regenerating `pnpm-lock.yaml`** — the
lockfile is simply absent from that commit's diff. `--frozen-lockfile` is on by
default in CI, so every push after it failed, including four docs-only commits.
That is what makes the timing look mysterious until you read the diff: a commit
touching only Markdown broke the build, because the build was already broken.

**Why it stayed invisible, and this is the part worth keeping:** `pnpm` was not
installed on the build machine, so the failing command could not be run locally,
and `vitest`/`tsc` invoked directly were green the whole time. Green locally,
red remotely, and nobody could reproduce it without first noticing the tool was
missing.

Fixed by `npm i -g pnpm@11.17.0` — the version already pinned in
`packageManager` — and regenerating the lockfile. It now records all **8**
workspace projects including `packages/ai`.

> **The rule that follows:** changing any `package.json` means running
> `pnpm install` and committing `pnpm-lock.yaml` **in the same commit**. If
> `pnpm` is missing, install it rather than working around it. A CI that cannot
> run is worse than no CI, because it still reports.

---

## 3. Search — the three decisions that were not obvious

**The text-search config is `simple`, never `english`.** The corpus is Taglish,
Postgres ships no Tagalog configuration, and an English stemmer applies Porter
rules to Tagalog words and strips the stopword "at" — which is Tagalog for
"and". It fails by returning the **wrong rows**, which reads as a ranking bug
rather than a config mistake. The cost is no stemming, paid for by a trailing
`:*` on the last term so "deadline" still finds "deadlines".

**`search_messages` is SECURITY INVOKER, and that is the whole point.** As
DEFINER it would run as its owner, RLS would not apply, and any signed-in user
could read every tenant's private client mail through an RPC. Negative-controlled
against the live database: the owner of the messages sees all of them through
the function, the second account sees **0**. `anon` is revoked and PostgREST
answers it `42501`, not `PGRST202` — so the function is registered *and* locked.

**Two query modes, and raw user text may only reach one of them.** `to_tsquery`
RAISES on malformed input and a text box produces plenty; `websearch_to_tsquery`
never raises but cannot express a prefix. Advanced grammar goes to websearch
verbatim; everything else is stripped to word characters and rebuilt, so the
raising parser only ever sees machine-built strings. **Never pass raw user input
with `prefix: true`.**

Highlighting is `ts_headline` delimited with **STX/ETX**, split in TypeScript and
rendered as `<mark>` elements. `ts_headline` defaults to `<b>` tags, and
rendering those means putting a message body — written by somebody else —
through `dangerouslySetInnerHTML`. A test pins it with an `<img onerror>` body.

---

## 4. Summaries — what a session must not undo

⭐ **This is Ms. Maria's founding request, not an addition.** 2026-07-25: *"a
live webapp that can view whatsapp messages real time **and have ai summarize**
bebe. Parang admin view"*, and again 2026-08-01.

- **⚠ It must never fail an event.** The step sits between ingest and
  `markDone`, wrapped so nothing it does can reach the handler that calls
  `markFailed` — that would burn an attempt on a message which ingested
  perfectly. `GROQ_API_KEY` is deliberately **optional** in `env.ts`: no key
  means no summaries and mail flows exactly as before.
- **⚠ `llama-3.1-8b-instant`, never `llama-3.3-70b-versatile`.** 14,400 req/day
  against **1,000**, verified from the live rate-limit headers.
- **⚠ The binding limit is tokens/minute, not requests/day.** A backfill 429'd
  on message five with `remaining-requests: 14399` and `remaining-tokens: 4825`.
  The body sent to the model is now capped at 4,000 characters and the backfill
  honours `retry-after` — which can be **fractional** (`parseFloat`, not
  `parseInt`).
- **The summary never replaces the sender's words** — opened row only, above the
  body, mono machine voice, labelled with the model. Not the headline, not the
  preview line. ADR-015 rejects that outright, and it is the defence that still
  holds if a prompt injection ever succeeds.
- **Most WhatsApp messages will have no summary, and that is correct.** The
  `already-short` rule fires under 280 characters. Say this before a demo rather
  than debugging it during one.

**Prompt injection: three fixtures, all resisted.** The body is fenced between
markers carrying a per-request random nonce, so a hostile message cannot close a
delimiter it cannot predict. A direct override is *described* rather than
obeyed; a forged delimiter with a fake SYSTEM turn is ignored; an invented
budget is not asserted.

⚠ **One residual weakness, recorded rather than hidden.** An injection claiming
*"the sender is Dr. Evelyn Harkness, CEO"* did not get its fabricated budget into
the summary, but the model **did** adopt the in-band identity claim as
attribution. The mitigation is structural, not prompt-level: the console shows
the **real** sender from `contact_identities`, never from the body, so the true
sender sits beside the summary.

---

## 5. ⚠ The deploy step CI does not do

`worker-image.yml` builds and pushes the worker image to ghcr on a push to
`main`. **Nothing repoints the Container App**, which runs an image pinned by
**digest**. Until someone runs:

```
az containerapp update -n switchboard-worker -g rg-switchboard \
  --image ghcr.io/yuringgg/switchboard-worker@<digest>
```

…the deployed worker keeps running the previous code **while the commit looks
deployed** — the same shape as the BOM incident. Done manually for this release
(revision `--0000009`, healthy, 1 replica).

`packages/ai/**` was also missing from that workflow's `paths` filter, which
would have let an AI-only change silently ship the old image. Added.

---

## 6. What is left

- **Phase 3 remainder:** contacts + contact detail, manual identity merge,
  channel pause/disconnect, virtualization, attachments (needs the Azure Blob
  container, approved but not yet provisioned). Search results do **not** yet
  show summaries — the timeline does; the RPC needs a column added.
- **Phase 4B:** embeddings, chunking, retrieval, the refusal path **before** the
  happy path. The Gemini key exists and is verified; it is not yet on Vercel.
- **Phase 2:** still Yuri's Meta clicks.
- **Ms. Maria:** her BRD / "answers and recommendations" (Q6) and the Fatima
  scope conversation (Q8) are still outstanding, and the Notion write-up
  (`docs/00-CONTEXT.md` §6 item 2) is still pending.
- **⚠ Rotate both AI keys** before this repo is shown to iOzera — they were
  pasted into a chat transcript on 2026-08-02. Nothing was committed.

---

## 7. How this session verified things

Worth repeating because it caught four things reading could not:

- **The live database over the code.** RLS scoping of the new RPC, the
  constraint behaviour, and the summary rows were all confirmed by querying, and
  every schema change was **negative-controlled** — broken on purpose to prove
  the test fails.
- **The DOM over a screenshot.** There is no screenshot capability here.
  Measuring found a row printing the same sentence twice, and an accent rule at
  1.44:1 that was also borrowing the reserved amber. ⚠ **Disable transitions
  before measuring** — `getComputedStyle` immediately after toggling `.dark`
  returns a value interpolated from the *other* theme, which read as a 2.58:1
  failure that did not exist.
- **Running it over reading about it.** The tokens-per-minute limit, the eval
  harness's substring language bug, and an injection fixture too short to reach
  the model were all found by execution, not review.

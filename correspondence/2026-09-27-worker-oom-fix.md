# The worker OOM crash loop — fixed in code, no resize

**2026-09-27.** Newer than `2026-09-24-pipeline-repair.md`, whose addendum
asked for a paid resize to 0.75 vCPU / 1.5 GiB. That resize is **not needed**
and was never applied. Read `AGENTS.md` §5 first.

---

## What was happening

Measured on the live system on 2026-09-27:

| | |
|---|---|
| Restarts of revision 0000017 since 2026-09-25 01:45 UTC | **197** (every ~16 minutes) |
| Exit code | 137 (OOM), with a liveness-probe timeout just before |
| Messages never embedded | **26** (3 are whitespace-only, correctly skipped; **23** are 10–22k-character newsletters) |
| `[embed-catchup] sweep:` lines in 48 h of logs | **0** — the sweep never once finished |
| `[extract-catchup] sweep:` lines in 48 h | ~30 — only on passes where the embed sweep deferred to a busy queue |

The pattern in the log was exact: start → wait 15 minutes → summary catch-up
sweep → the worker dies, before the embed catch-up logs anything → restart.

## The cause

`embedMessage` passed **every chunk of a message to the model in one call**.
A call's working memory grows with the batch (every chunk padded to the
longest, an attention matrix per chunk), and onnxruntime keeps its arena at
the high-water mark afterwards. A 22k-character newsletter is 26 chunks. On a
~725 MiB baseline in a 1 GiB container, that was the kill.

Then two things turned one crash into a loop:

- **The give-up list is in memory.** A message that kills the process is never
  recorded as failed, so every restart selects the same message first.
- **Embeddings sat between summaries and extraction** in the one catch-up loop,
  so extraction only got a turn when the embed sweep happened to defer.

The 2026-09-25 reading — "three catch-ups in one loop grew the peak" — was the
right symptom and the wrong cause.

## The measurement that decided the fix

One synthetic 22,478-character newsletter-shaped message (prose, tracking URLs,
Taglish; no real mail), 26 chunks, the real quantised model, **one process per
size** because the arena never shrinks. Rise in RSS over the warm model:

| chunks per model call | rise | time |
|---|---|---|
| all 26 (as shipped) | ~330 MiB | ~4.3 s |
| 8 | ~242 MiB | ~4.1 s |
| 4 | ~133 MiB | ~4.5 s |
| 2 | ~75 MiB | ~4.2 s |
| **1** | **~51 MiB** | ~4.0 s |

Stable across three runs. **Batching bought no speed** on this model, so one
chunk per call costs nothing and bounds the peak by the longest single chunk,
whatever the size of the message.

## What changed

- `packages/ai/src/embed.ts` — `EMBED_BATCH_SIZE = 1`; `embedPassages` feeds the
  model one text per call. `embedQuery` is unchanged (it was always one).
- `packages/ai/test/embed.test.ts` — six tests pinning the call size, order and
  prefix. Negative-controlled: with the size raised to 64, two fail.
- `apps/worker/src/index.ts` — the catch-up loop is now summaries → extraction →
  **embeddings last**. A `try` cannot catch the kernel, so the one step that
  loads a model runs where a crash starves nothing.
- `infra/main.bicep` — back to the live 0.5 vCPU / 1 GiB. It had said 1.5 GiB
  ahead of a resize that never happened, so a bicep deploy would have quietly
  raised the bill.

## Re-measuring

The script, run from `packages/ai` with the model cache on D::

```bash
MODEL_CACHE_DIR="D:/Claude Code/_scratch/model-cache" \
  node --expose-gc ../../apps/worker/node_modules/tsx/dist/cli.mjs embed-mem.mts all
```

`embed-mem.mts` warms the model, forces a GC, records RSS, embeds the 26 chunks
and samples RSS every 20 ms. It lived in the session's scratch folder, not the
repo. ⚠ The table above was measured by slicing the input to `embedPassages`
BEFORE this fix. Now that `embedPassages` always sends one text at a time, to
measure a larger size again you must temporarily raise `EMBED_BATCH_SIZE`.

## Still true, and not a bug

The summary and extraction catch-ups now fail mostly on
`groq rate limit (daily allowance …)` for `openai/gpt-oss-20b` — the model's
daily token cap on Groq's free tier, shared with live mail. The backlog (126
unextracted on 2026-09-27) drains at that pace. Faster would need a second key
or a paid tier; nothing in the code is wrong.

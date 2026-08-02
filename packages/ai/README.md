# packages/ai

Two interfaces, providers matched to workload rather than picked once (ADR-003).

```ts
interface CompletionProvider { complete(system, user, opts?): Promise<CompletionResult> }
interface EmbeddingProvider  { embed(texts: string[]): Promise<number[][]>; readonly dimensions: number }
```

| Workload | Provider | Why |
|---|---|---|
| Assistant Q&A | **Groq `llama-3.3-70b-versatile`** | 1,000 req/day · 12,000 tokens/min. ⚠ **Not Gemini** — see below. |
| Per-message summaries | **Groq `llama-3.1-8b-instant`** | 14,400 req/day. A *different model on purpose*. |
| Embeddings | **Local Transformers.js** | Free, unlimited, offline, cannot fail mid-demo. |

**Two different Groq models is the point, not an accident.** Groq's limits are
**per-model**, so heavy assistant use can never stop mail being summarised —
ADR-003's failure-isolation argument, satisfied inside one vendor. Embeddings are
local and cannot fail at all, so semantic search survives every provider outage.

> ⚠ **This file said Gemini until 2026-08-02, and it was wrong.** Gemini 2.5
> Flash's free tier measured **20 requests per DAY** — read off the quota error,
> not a docs page — against the 250 `docs/03-RESOURCES.md` had recorded. One run
> of this project's own eval needs 15. `ASSISTANT_PROVIDER=gemini` switches back
> in one variable if Google ever restores a usable tier.

## What is here

| File | Job |
|---|---|
| `assistant.ts` | The system prompt, context selection, citation parsing. **The refusal lives here.** |
| `assistant-provider.ts` | Which model answers questions, and why it is not Gemini |
| `summarize.ts` | Phase 4A's one-prompt-per-message summariser |
| `chunk.ts` · `embed.ts` | Overlapping chunks and the e5 prefixes |
| `groq.ts` · `gemini.ts` | Native `fetch`, no SDK — the worker's tsup bundle has already lost a container to a dependency that could not survive it |

## Things that are quiet when wrong

- **The embedding model must be multilingual** — the corpus is Taglish, and
  English-only defaults degrade in a way that looks like a ranking bug.
  `Xenova/multilingual-e5-small`, 384 dimensions.
- **e5 needs prefixes:** `"query: "` on searches, `"passage: "` on stored text.
  They are applied *inside* `embedQuery`/`embedPassages`, never at call sites,
  because omitting them does not error — it just ranks worse.
- **The refusal is NOT a threshold.** ADR-016: measured on the real corpus, the
  highest *unanswerable* similarity (0.8563) sits **above** the lowest
  *answerable* one (0.8487). e5's embeddings occupy a 0.75–0.90 band where
  absolute distance barely signals relevance. The model refuses, from context,
  and the eval set is what proves it.
- **An answer that cites nothing is a refusal.** `parseAnswer` decides that by
  counting citations, never by matching phrases — a phrase list is something the
  model can always sidestep, and it misfires on a real answer containing the
  words.
- **The prompt's decision is three-way** (ADR-017): "nothing here is about this"
  (refuse) versus "several things are, none individually decisive" (synthesise,
  citing each). A two-way test refuses questions whose answer *is* the synthesis.
- **Extraction output is validated, not trusted** — define the shape in Zod and
  parse the model's response through it. A parse failure is a job to retry, not
  a row to insert.

## Rate limits, and why a 429 is read carefully

`CompletionResult` carries a `limitScope` of `'minute' | 'day' | 'unknown'`,
because *"try again in a moment"* is correct for the per-minute window and
**misleading for the daily allowance** — the limit that actually binds this
project at ~30 assistant questions a day.

⚠ **No header can tell them apart.** Measured 2026-08-02: Groq publishes **no
tokens-per-day header at all**, a daily rejection arrives carrying a *full*
per-minute budget, and when the request limit trips the token headers vanish
entirely. So `groq.ts` reads the error body **only on a 429**, extracts **only**
the `(RPM|RPD|TPM|TPD)` code, and discards it — a deliberate bounded exception to
`docs/02-ARCHITECTURE.md` §6, recorded there. Nothing from the body is ever
returned, stored or logged.

## Testing

`packages/ai/test` covers chunking, summarisation, the refusal contract
(`assistant.test.ts`) and limit classification (`rate-limit.test.ts`) — all
offline, no key, no network.

The two that need a live model are **scripts, not tests**, deliberately: a suite
requiring a key and a network is one that starts getting skipped.

```bash
node --env-file=apps/worker/.env apps/worker/node_modules/tsx/dist/cli.mjs apps/worker/scripts/probe-context.ts
```

⚠ **Reach for `probe-context.ts` before `eval-assistant.ts`.** It prints what
actually reaches the model, costs **no quota**, and separates "the model judged
wrongly" from "the model never saw it" — opposite fixes, which the answer-level
eval cannot distinguish at any price.

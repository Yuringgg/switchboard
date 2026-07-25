# packages/ai

Two interfaces, three providers — matched to workload rather than picked once
(ADR-003).

```ts
interface CompletionProvider { complete(system, user, opts?): Promise<string> }
interface EmbeddingProvider  { embed(texts: string[]): Promise<number[][]>; readonly dimensions: number }
```

| Workload | Provider | Why |
|---|---|---|
| Assistant Q&A | **Gemini 2.5 Flash** | Long RAG prompts. 250K tokens/min, 1M context. |
| Per-message extraction | **Groq / Llama** | Many small prompts. 14.4K req/day, very low latency. |
| Embeddings | **Local Transformers.js** | Free, unlimited, offline, cannot fail mid-demo. |

Splitting isolates failure: if Groq degrades, search still works and only
extraction stops.

**Two things that are quiet when wrong:**

- The embedding model **must be multilingual** — the corpus is Taglish, and
  English-only defaults degrade in a way that looks like a ranking bug.
  `Xenova/multilingual-e5-small`, 384 dimensions.
- **e5 needs prefixes:** `"query: "` on searches, `"passage: "` on stored text.
  Omitting them doesn't error, it just quietly degrades retrieval.

Extraction output is **validated, not trusted** — define the shape in Zod and
parse the model's response through it. A parse failure is a job to retry, not a
row to insert.

Lands in Phase 4 (`docs/04-ROADMAP.md`) — currently a placeholder.

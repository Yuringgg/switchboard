import type { EmbeddingProvider } from './provider';

/**
 * Local embeddings, in-process (ADR-003).
 *
 * Free, unlimited, offline, and **impossible to exhaust mid-demo** — which is
 * the property that decided this, not the cost. Embedding is the highest-volume
 * operation in the system (every message, plus every re-index), so through an
 * API it would be a quota that can run out and a network call that can fail. It
 * also isolates failure: if Gemini degrades, search still works and only the
 * assistant's answers stop.
 */

/**
 * ⚠ MULTILINGUAL, and this is not a preference.
 *
 * The corpus is Taglish. `all-MiniLM-L6-v2` — the popular default — is English
 * only and degrades on code-switched text in a way that looks like a ranking
 * bug rather than a model problem, which is exactly why it is hard to catch
 * late. `docs/03-RESOURCES.md` §4c and ADR-003 both say so.
 *
 * Measured on 2026-08-02, against the query *"do I have any meetings coming
 * up?"*:
 *
 *   Tagalog  "Nasa office ka ba bukas? Dadaan sana ako around 10."   0.8544
 *   English  "Can we do 3pm Thursday to go through both?"           0.8243
 *   Unrelated "The container left port on Tuesday…"                 0.7715
 *
 * The Tagalog message scored **higher** than the English one. The model is
 * doing the job it was chosen for.
 */
export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';

/** Matches `message_chunks.embedding vector(384)` in the schema. */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * ⚠⚠ e5 REQUIRES THESE PREFIXES, AND OMITTING THEM DOES NOT ERROR.
 *
 * The model was trained with them. Without them retrieval quality quietly
 * drops — no exception, no warning, just worse ranking, which is
 * indistinguishable from "semantic search is a bit disappointing". Every
 * doc on this project that mentions e5 mentions this, and it is still the
 * easiest thing here to get wrong.
 *
 * The rule: **`query:` for a question, `passage:` for anything stored.** They
 * are not interchangeable — an asymmetric model puts questions and answers in
 * deliberately different places, and using one prefix for both collapses that.
 *
 * They are applied inside `embedQuery` / `embedPassages` rather than left to
 * callers, so there is no call site that can forget.
 */
const QUERY_PREFIX = 'query: ';
const PASSAGE_PREFIX = 'passage: ';

type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Load the model once per process, and never twice concurrently.
 *
 * The promise is cached rather than the resolved pipeline, so two callers
 * racing at startup await the same load instead of each starting their own —
 * loading 129 MB of weights twice is how a container gets OOM-killed on a
 * revision that worked yesterday.
 *
 * ⚠ Imported dynamically. `@huggingface/transformers` pulls in
 * `onnxruntime-node`, which ships native `.node` binaries — esbuild cannot
 * inline those, so a static import would be bundled by tsup and crash the
 * worker at startup. That is the same failure `apps/worker/test/import-boundary.test.ts`
 * exists to prevent for the Gmail adapter. The worker's tsup config marks this
 * package external and the Docker runtime stage ships its `node_modules`.
 */
async function getPipeline(): Promise<FeatureExtractionPipeline> {
  pipelinePromise ??= (async () => {
    const { env, pipeline } = await import('@huggingface/transformers');

    /*
     * Set the cache directory explicitly rather than trusting an environment
     * variable to be read.
     *
     * Transformers.js defaults to `./.cache` relative to the **current working
     * directory** — which in the container is `/app`, owned by `node`, so it
     * happens to work; and on a developer machine is wherever the script was
     * launched from, so the model is re-downloaded per directory. Naming it
     * removes both surprises, and `MODEL_CACHE_DIR` lets the image point it at
     * a path baked at build time.
     */
    const cacheDir = process.env.MODEL_CACHE_DIR;
    if (cacheDir) env.cacheDir = cacheDir;

    return (await pipeline('feature-extraction', EMBEDDING_MODEL, {
      // Quantised: ~129 MB on disk against ~470 MB for fp32, with no measurable
      // difference in ranking on a corpus this size, and it is the difference
      // between a container image that is awkward and one that is unusable.
      dtype: 'q8',
    })) as unknown as FeatureExtractionPipeline;
  })();

  return pipelinePromise;
}

/** Is the model already resident? Used by the health endpoint, never to gate. */
export function isEmbedderLoaded(): boolean {
  return pipelinePromise !== null;
}

/**
 * Warm the model at startup rather than on the first request.
 *
 * The worker runs `minReplicas: 1` precisely so these weights stay in memory
 * (ADR-011). Loading them lazily would put a ~5–35 second stall on whichever
 * unlucky request arrived first — which, for the assistant, is the demo.
 *
 * Returns rather than throws: a worker that cannot embed must still ingest
 * mail, exactly as it must still ingest when Groq is down.
 */
export async function warmEmbedder(): Promise<{ ok: boolean; ms: number; reason?: string }> {
  const started = Date.now();
  try {
    const extract = await getPipeline();
    await extract([`${PASSAGE_PREFIX}warmup`], { pooling: 'mean', normalize: true });
    return { ok: true, ms: Date.now() - started };
  } catch (cause) {
    pipelinePromise = null; // so a later attempt can retry rather than reuse a rejection
    return {
      ok: false,
      ms: Date.now() - started,
      reason: cause instanceof Error ? cause.message : 'embedder failed to load',
    };
  }
}

async function embedWithPrefix(prefix: string, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const extract = await getPipeline();

  const output = await extract(
    texts.map((text) => prefix + text),
    // Mean pooling and L2 normalisation are what e5 expects. Normalised vectors
    // make cosine distance and inner product equivalent, which is why the SQL
    // side can use `<=>` and read the result as a similarity.
    { pooling: 'mean', normalize: true },
  );

  return output.tolist();
}

/** Embed text to be STORED. Applies `passage: `. */
export async function embedPassages(texts: string[]): Promise<number[][]> {
  return embedWithPrefix(PASSAGE_PREFIX, texts);
}

/** Embed a QUESTION. Applies `query: `. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedWithPrefix(QUERY_PREFIX, [text]);
  if (!vector) throw new Error('embedding returned no vector');
  return vector;
}

/** The `EmbeddingProvider` shape from ADR-003, for anything generic. */
export const localEmbeddingProvider: EmbeddingProvider = {
  dimensions: EMBEDDING_DIMENSIONS,
  embed: embedPassages,
};

/**
 * Format a vector as a pgvector literal.
 *
 * pgvector accepts `'[0.1,0.2,…]'`. Sending a JS array through a driver that
 * renders it as a Postgres array (`{0.1,0.2}`) fails with a type error, and
 * sending it as JSON silently works for `jsonb` and not for `vector`.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

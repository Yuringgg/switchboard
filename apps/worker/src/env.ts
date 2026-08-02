/** Fail at startup with a name, not later with an opaque connection error. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * ⚠ This connection BYPASSES ROW LEVEL SECURITY. It is the reason the worker is
 * the one place a cross-tenant leak can happen. See src/claim.ts.
 */
export const DATABASE_URL = required('DATABASE_URL');

export const PORT = Number(process.env.PORT ?? 8080);

/** How long to sleep when the queue is empty, in ms. */
export const IDLE_POLL_MS = Number(process.env.IDLE_POLL_MS ?? 5_000);

/** Give up on an event after this many attempts and mark it failed. */
export const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 5);

/**
 * Groq, for per-message summaries (Phase 4A, ADR-015).
 *
 * ⚠ Optional on purpose — `required()` would be wrong here. Summaries are
 * additive: without a key the worker ingests mail exactly as it did before
 * Phase 4A and simply writes no summaries. Making this mandatory would turn a
 * missing optional feature into a container that will not start, which is the
 * precise opposite of the "a Groq outage must never stop mail" rule.
 */
export const GROQ_API_KEY = process.env.GROQ_API_KEY ?? '';

/**
 * Shared secret for `POST /embed` (Phase 4B).
 *
 * The console cannot run the embedding model itself — a 129 MB model plus
 * native ONNX binaries does not fit a serverless function with an acceptable
 * cold start — so it asks the worker, which holds the model warm precisely for
 * this (ADR-011). That endpoint is the only reason the worker has public
 * ingress, and this secret is the only thing gating it.
 *
 * ⚠ Optional, and when it is absent the endpoint is **disabled rather than
 * open**. An unset secret must never mean "no authentication required" — that
 * is the failure mode where a misconfiguration silently publishes a service.
 */
export const EMBED_API_SECRET = process.env.EMBED_API_SECRET ?? '';

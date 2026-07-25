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

import { createServer } from 'node:http';

import { createDbClient } from '@switchboard/db';

import { claimNextEvent, markDone, markFailed } from './claim';
import { DATABASE_URL, IDLE_POLL_MS, MAX_ATTEMPTS, PORT } from './env';

/**
 * The worker.
 *
 * Runs warm on Azure Container Apps with `minReplicas: 1` — deliberately not
 * scale-to-zero (ADR-011). It will hold ONNX embedding model weights in memory
 * from Phase 4, and reloading those on every cold start would blow the
 * "visible in under 10 seconds" target.
 *
 * Right now it consumes the queue and does nothing with the events. That is the
 * Phase 0 shape: prove the container runs, stays up, connects, and claims work
 * safely. Normalization, embedding and extraction land in Phases 1 and 4.
 */

const { db, sql } = createDbClient(DATABASE_URL);

let running = true;
let inFlight = false;

/**
 * Container Apps needs an HTTP endpoint to consider the revision healthy, even
 * for a process that is otherwise a background consumer.
 */
const server = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, running, inFlight }));
    return;
  }
  res.writeHead(404);
  res.end();
});

async function processOne(): Promise<boolean> {
  const event = await claimNextEvent(db);
  if (!event) return false;

  inFlight = true;
  try {
    // Message IDs only — never bodies. docs/02-ARCHITECTURE.md §6.
    console.info(
      `[worker] claimed event=${event.id} channel=${event.channelType} attempt=${event.attempts}`,
    );

    // TODO(Phase 1): adapter.normalize(event) → upsert messages on the
    // (channel_id, external_id) conflict target → resolve contact identity.
    // TODO(Phase 4): chunk + embed → message_chunks; extract → extractions.
    //
    // owner_id for every row written here comes from event.ownerId, which
    // claim.ts read from the channels row. Never from event.payload.

    await markDone(db, event.id);
    return true;
  } catch (error) {
    console.error(`[worker] event=${event.id} failed:`, error instanceof Error ? error.message : error);
    await markFailed(db, event.id, event.attempts, MAX_ATTEMPTS, error);
    return true;
  } finally {
    inFlight = false;
  }
}

async function loop(): Promise<void> {
  while (running) {
    try {
      const didWork = await processOne();
      // Drain the queue at full speed; only sleep once it is empty.
      if (!didWork) await sleep(IDLE_POLL_MS);
    } catch (error) {
      // A failure here is the database being unreachable, not a bad event.
      // Back off rather than spin.
      console.error('[worker] loop error:', error instanceof Error ? error.message : error);
      await sleep(IDLE_POLL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Container Apps sends SIGTERM before replacing a revision. Finishing the
 * current event first is what stops a deploy from stranding a row in
 * 'processing' — where nothing will ever pick it up again.
 */
async function shutdown(signal: string): Promise<void> {
  console.info(`[worker] ${signal} received, finishing current event`);
  running = false;

  server.close();

  const deadline = Date.now() + 10_000;
  while (inFlight && Date.now() < deadline) await sleep(100);

  await sql.end({ timeout: 5 });
  console.info('[worker] stopped');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

server.listen(PORT, () => {
  console.info(`[worker] health endpoint on :${PORT}`);
});

void loop();

import { createServer } from 'node:http';

import { createGroqProvider } from '@switchboard/ai';
import { createDbClient } from '@switchboard/db';

import { claimNextEvent, markDone, markFailed } from './claim';
import { DATABASE_URL, GROQ_API_KEY, IDLE_POLL_MS, MAX_ATTEMPTS, PORT } from './env';
import { ingestGmailEvent } from './gmail-ingest';
import { readGmailWatchConfig, renewExpiringWatches } from './gmail-watch';
import { summariseBatch } from './summarize';
import { ingestWhatsAppEvent } from './whatsapp-ingest';

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

/**
 * Phase 4A summariser, or null when no key is configured.
 *
 * Null is a supported state, not a broken one — a deployment with no Groq key
 * ingests mail exactly as it did before Phase 4A and simply has no summaries.
 * That is the whole design constraint of ADR-015: summarisation is additive and
 * its absence must never be an outage. Said once at startup rather than every
 * event, because an absent optional feature is not an error worth repeating.
 */
const summariser = GROQ_API_KEY ? createGroqProvider({ apiKey: GROQ_API_KEY }) : null;

if (summariser) {
  console.info(`[summary] enabled, model=${summariser.model}`);
} else {
  console.info('[summary] disabled: GROQ_API_KEY is not set. Mail still ingests.');
}

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

    /** Messages this event newly created, for the summariser below. */
    let createdIds: string[] = [];

    // owner_id for every row written here comes from event.ownerId, which
    // claim.ts read from the channels row. Never from event.payload.
    if (event.channelType === 'gmail') {
      const config = readGmailWatchConfig();
      if (!config) {
        throw new Error(
          'Gmail ingest is not configured: needs CHANNEL_CREDENTIALS_KEY, ' +
            'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
        );
      }

      const outcome = await ingestGmailEvent(db, config, event);
      createdIds = outcome.createdIds;
      console.info(
        `[worker] event=${event.id} fetched=${outcome.fetched} created=${outcome.created} ` +
          `skipped=${outcome.skipped}${outcome.fullSync ? ' (full sync)' : ''}`,
      );
    } else if (event.channelType === 'whatsapp') {
      /*
       * No config gate, unlike Gmail.
       *
       * Gmail cannot ingest without credentials to decrypt and an API to call,
       * so it checks first and throws a named error. WhatsApp's payload already
       * carries the message: there is nothing to configure and nothing to fetch,
       * so an event here can always be processed. That asymmetry is the whole
       * reason these two channels were paired.
       */
      const outcome = await ingestWhatsAppEvent(db, event);
      createdIds = outcome.createdIds;
      console.info(
        `[worker] event=${event.id} created=${outcome.created} skipped=${outcome.skipped}`,
      );
    } else {
      /*
       * A channel type the worker has no branch for.
       *
       * Marked done rather than failed, and said out loud. `channels.type` is
       * CHECK-constrained to the two channels in scope, so reaching this means
       * a migration widened it without the worker following — and retrying
       * will never grow the missing branch. Silently marking it done with no
       * log is how a channel ends up connected, ingesting, and invisible.
       */
      console.error(
        `[worker] event=${event.id} has channel type '${event.channelType}' with no ingest ` +
          `branch. It will be marked done and its message will never appear. Add a branch ` +
          `in apps/worker/src/index.ts.`,
      );
    }

    /*
     * ── Phase 4A: summaries (ADR-015) ────────────────────────────────────────
     *
     * ⚠⚠ AFTER `markDone` would be wrong, and BEFORE it must not be able to
     * fail. This sits between them and is wrapped so that nothing it does can
     * reach the `catch` below — because that `catch` calls `markFailed`, which
     * burns an attempt and eventually parks a message that ingested perfectly.
     *
     * `summariseBatch` already returns rather than throws on every path it
     * knows about. The try here is for the ones it does not: a summary is
     * additive, and "Groq is down" must degrade to "no summary", never to "no
     * mail". That is a requirement in docs/04-ROADMAP.md, not a preference.
     */
    if (summariser && createdIds.length > 0) {
      try {
        const summaries = await summariseBatch(db, summariser, createdIds);
        if (summaries.written > 0 || summaries.failed > 0) {
          console.info(
            `[summary] event=${event.id} written=${summaries.written} ` +
              `skipped=${summaries.skipped} failed=${summaries.failed}`,
          );
        }
      } catch (error) {
        // Unreachable by design. Logged rather than swallowed silently so that
        // if the guarantee above is ever broken, it is visible.
        console.error(
          `[summary] event=${event.id} escaped its own error handling:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    // TODO(Phase 4B): chunk + embed → message_chunks.

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
 * Gmail watch renewal, every 6 hours.
 *
 * Not daily: a watch lasts 7 days and is renewed at T-2, so four attempts a day
 * means a transient Google outage or a worker restart cannot consume the whole
 * margin. The cost is one indexed query against a handful of rows.
 */
const WATCH_SWEEP_MS = 6 * 60 * 60 * 1000;

async function watchRenewalLoop(): Promise<void> {
  while (running) {
    const config = readGmailWatchConfig();

    if (!config) {
      // Loud on purpose, every cycle. An unrenewed watch fails SILENTLY — Gmail
      // just stops publishing — so a quiet skip here would reproduce exactly
      // the failure this loop exists to prevent.
      console.error(
        '[watch] renewal DISABLED: needs CHANNEL_CREDENTIALS_KEY, GOOGLE_CLIENT_ID, ' +
          'GOOGLE_CLIENT_SECRET and GOOGLE_PUBSUB_TOPIC. Gmail watches will expire ' +
          'after 7 days and ingestion will stop with no other warning.',
      );
    } else {
      try {
        const result = await renewExpiringWatches(db, config);
        if (result.checked > 0) {
          console.info(
            `[watch] sweep: checked=${result.checked} renewed=${result.renewed} failed=${result.failed}`,
          );
        }
      } catch (error) {
        console.error(
          '[watch] sweep errored:',
          error instanceof Error ? error.message : error,
        );
      }
    }

    // Broken into short sleeps so SIGTERM is not waited out for six hours.
    const wakeAt = Date.now() + WATCH_SWEEP_MS;
    while (running && Date.now() < wakeAt) await sleep(1_000);
  }
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
void watchRenewalLoop();

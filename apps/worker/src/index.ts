import { createServer } from 'node:http';

import { timingSafeEqual } from 'node:crypto';

import {
  createGroqProvider,
  embedQuery,
  GROQ_EXTRACTION_MODEL,
  isEmbedderLoaded,
  warmEmbedder,
} from '@switchboard/ai';
import { createDbClient } from '@switchboard/db';

import { claimNextEvent, markDone, markFailed } from './claim';
import { catchUpEmbeddings } from './embed-catchup';
import { embedBatch } from './embed-messages';
import { extractBatch } from './extract';
import { catchUpExtractions } from './extract-catchup';
import {
  DATABASE_URL,
  EMBED_API_SECRET,
  GROQ_API_KEY,
  IDLE_POLL_MS,
  MAX_ATTEMPTS,
  PORT,
  RECALL_API_KEY,
  RECALL_REGION,
} from './env';
import { ingestGmailEvent } from './gmail-ingest';
import { readGmailWatchConfig, renewExpiringWatches } from './gmail-watch';
import { ingestMeetingEvent } from './meeting-ingest';
import { sweepMeetings } from './meeting-sweep';
import { reclaimStaleEvents, STALE_CLAIM_MINUTES } from './queue';
import { catchUpSummaries } from './summary-catchup';
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

/**
 * Phase 5 extractor, or null when no key is configured.
 *
 * ⚠ The SAME model as the summariser, and the same provider shape — but a
 * separate handle, because the two ask for different things: extraction needs
 * far more output tokens for JSON and runs at temperature 0.
 *
 * `GROQ_EXTRACTION_MODEL` is `llama-3.1-8b-instant`, deliberately **not** the
 * assistant's 70B: Groq's limits are per-model, this one allows 14,400
 * requests/day against the 70B's 1,000, and the assistant needs that 1,000.
 *
 * Null is a supported state, exactly as it is for summaries: no key means no
 * proposals and mail flows exactly as before.
 */
const extractor = GROQ_API_KEY
  ? createGroqProvider({ apiKey: GROQ_API_KEY, model: GROQ_EXTRACTION_MODEL })
  : null;

if (extractor) {
  console.info(`[extract] enabled, model=${extractor.model}`);
} else {
  console.info('[extract] disabled: GROQ_API_KEY is not set. Mail still ingests.');
}

let running = true;
let inFlight = false;

/**
 * Container Apps needs an HTTP endpoint to consider the revision healthy, even
 * for a process that is otherwise a background consumer.
 */
/**
 * Constant-time comparison of the bearer secret.
 *
 * `===` on a secret leaks its length and its matching prefix through timing.
 * The lengths are compared first because `timingSafeEqual` throws on unequal
 * buffers — that length check is itself a leak, which is why the secret is a
 * long random string rather than something whose length is meaningful.
 */
function secretMatches(provided: string): boolean {
  if (!EMBED_API_SECRET) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(EMBED_API_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    // No secrets and nothing tenant-scoped: this is reachable unauthenticated.
    res.end(JSON.stringify({ ok: true, running, inFlight, embedder: isEmbedderLoaded() }));
    return;
  }

  /*
   * ── POST /embed ───────────────────────────────────────────────────────────
   *
   * The one endpoint that exists for the console (Phase 4B, ADR-016). It turns
   * a question into a 384-dimension vector and returns it. Deliberately narrow:
   *
   *   · it takes text and returns numbers
   *   · it never touches the database
   *   · it has no notion of a user, so there is no tenant to get wrong
   *
   * Retrieval stays in the console, through `match_chunks` with the user's own
   * session, so RLS — not this process — decides whose messages are searched.
   * That is why this is an embedding endpoint rather than an assistant endpoint:
   * the narrower surface is worth more than the round trip it saves.
   */
  if (req.url === '/embed' && req.method === 'POST') {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    if (!secretMatches(token)) {
      // 404, not 401, when no secret is configured at all: an unconfigured
      // endpoint should not advertise that it exists and is merely locked.
      const status = EMBED_API_SECRET ? 401 : 404;
      console.warn(`[embed-api] rejected: ${EMBED_API_SECRET ? 'bad token' : 'not configured'}`);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: status === 401 ? 'unauthorized' : 'not found' }));
      return;
    }

    /*
     * 503, not 500, when the model never loaded.
     *
     * They mean different things to the caller and the difference is worth a
     * branch: 500 says "this request broke", 503 says "this capability is not
     * available here". The console shows the user a different message for each,
     * and — more practically — 503 with a named reason is what stops someone
     * debugging a question-answering bug that is really a missing native binary
     * in the container image.
     */
    if (!isEmbedderLoaded()) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'embedder unavailable on this worker' }));
      return;
    }

    let body = '';
    // Bounded: an unbounded read is a memory exhaustion vector on a process
    // that also holds 129 MB of model weights.
    const LIMIT = 8 * 1024;
    req.on('data', (chunk: Buffer) => {
      body += chunk;
      if (body.length > LIMIT) req.destroy();
    });

    req.on('end', () => {
      void (async () => {
        try {
          const parsed = JSON.parse(body) as { text?: unknown };
          const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';

          if (!text) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'text is required' }));
            return;
          }

          // ⚠ embedQuery applies the "query: " prefix. Never bypass it — e5 is
          // asymmetric and a passage-prefixed question ranks measurably worse,
          // with no error to tell you.
          const embedding = await embedQuery(text.slice(0, 2000));

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ embedding }));
        } catch (error) {
          // ⚠ Never echo the text back: it is a user's question about their
          // own private mail. docs/02-ARCHITECTURE.md §6.
          console.error(
            '[embed-api] failed:',
            error instanceof Error ? error.message : 'unknown',
          );
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'embedding failed' }));
        }
      })();
    });
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
    } else if (event.channelType === 'meeting') {
      /*
       * Like WhatsApp, not like Gmail: no config gate and no fetch.
       *
       * `meeting-sweep.ts` already did the fetching and wrote a payload that is
       * self-sufficient — transcript plus the recording's start time, which the
       * transcript itself does not carry. ADR-014's rule from Phase 2's
       * refactor checkpoint, applied deliberately this time rather than
       * discovered afterwards.
       */
      const outcome = await ingestMeetingEvent(db, event);
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

    /*
     * ── Phase 4B: chunk + embed → message_chunks ─────────────────────────────
     *
     * Same contract as summarisation above and for the same reason: wrapped so
     * nothing here can reach the `catch` that calls `markFailed`. Semantic
     * search degrading is a degradation; mail not arriving is an outage.
     *
     * Guarded on the embedder having loaded, so an image missing the native
     * ONNX binaries ingests mail exactly as before rather than logging a
     * failure per message forever.
     */
    if (isEmbedderLoaded() && createdIds.length > 0) {
      try {
        const embedded = await embedBatch(db, createdIds);
        if (embedded.embedded > 0 || embedded.failed > 0) {
          console.info(
            `[embed] event=${event.id} messages=${embedded.embedded} ` +
              `chunks=${embedded.chunks} skipped=${embedded.skipped} failed=${embedded.failed}`,
          );
        }
      } catch (error) {
        console.error(
          `[embed] event=${event.id} escaped its own error handling:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    /*
     * ── Phase 5: extraction → `extractions` (US-7, US-9, ADR-010) ────────────
     *
     * Same contract as the two steps above and for the same reason: wrapped so
     * nothing here can reach the `catch` that calls `markFailed`. A missing
     * proposal is a degradation; mail not arriving is an outage.
     *
     * ⚠ Runs LAST of the three, and that ordering is deliberate. Summaries and
     * embeddings are what the timeline and search need to look right the moment
     * a message lands; a proposal is read minutes or hours later on a different
     * screen. If the shared 6,000 tokens/minute window runs out mid-batch, the
     * step that should lose is this one.
     *
     * ⚠ Nothing here touches a calendar. Every row lands unconfirmed, with
     * `calendar_event_id` null. ADR-010: propose, never assert.
     */
    if (extractor && createdIds.length > 0) {
      try {
        const extracted = await extractBatch(db, extractor, createdIds);
        if (extracted.rows > 0 || extracted.failed > 0) {
          console.info(
            `[extract] event=${event.id} messages=${extracted.written} ` +
              `rows=${extracted.rows} skipped=${extracted.skipped} failed=${extracted.failed}`,
          );
        }
      } catch (error) {
        // Unreachable by design. Logged rather than swallowed silently so that
        // if the guarantee is ever broken, it is visible.
        console.error(
          `[extract] event=${event.id} escaped its own error handling:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

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
 * Catch-up — summaries, embeddings, then extraction — every 15 minutes.
 *
 * (Extraction came first and the reasoning below was written for it; summaries
 * and embeddings joined on 2026-09-24 after the same hole was measured in both.
 * See `catchUpLoop`.)
 *
 * ⚠ This loop is the answer to a measured hole, not a precaution. See the long
 * note in `extract-catchup.ts`: on 2026-08-03 the live database held 84
 * messages and 78 extraction runs, and four of the six gaps were ordinary mail
 * from the previous day that had been summarised and embedded but never
 * extracted. Nothing was ever going to come back for them.
 *
 * 15 minutes rather than 6 hours (the watch sweep's interval) because the two
 * failures are shaped differently: an unrenewed watch has two days of margin
 * built in, while a dropped extraction is already lost and a person may be
 * looking at `/attention` now. It is also far cheaper to be wrong about — a
 * sweep with nothing to do is one indexed count.
 */
const EXTRACT_SWEEP_MS = 15 * 60 * 1000;

/** Bounded so one sweep cannot monopolise the shared 6,000 tokens/minute. */
const CATCH_UP_BATCH = 5;

/** Comfortably under the ~1.7 requests/minute extraction actually sustains. */
const CATCH_UP_DELAY_MS = 20_000;

/**
 * Larger than `CATCH_UP_BATCH` because embedding is local: no token window to
 * share, only CPU, and ~22 ms per chunk once the model is warm.
 */
const EMBED_CATCH_UP_BATCH = 20;

/**
 * ── Phase 7: pulling meeting transcripts in ─────────────────────────────────
 *
 * ⚠ A POLL, because Recall cannot push. Their webhook portal cannot create an
 * endpoint on this account and there is no webhook path in their public API —
 * `meeting-sweep.ts` has the full account. `/api/webhooks/recall` stays built
 * and tested for the day that changes.
 *
 * Five minutes rather than the extraction sweep's fifteen: a meeting ends and
 * somebody wants the brief, whereas a missed extraction is read hours later on
 * another screen. Recall's read endpoints run at 300/min, so a handful of
 * requests every five minutes is nothing.
 *
 * ⚠ Unlike `catchUpLoop` this does NOT wait for an idle queue. It
 * spends no LLM tokens — the shared 6,000/minute window it would be competing
 * for is not a resource this touches at all.
 */
const MEETING_SWEEP_MS = 5 * 60 * 1000;

/** Bounded so one tenant's busy day cannot make one pass unbounded. */
const MEETING_SWEEP_BATCH = 10;

async function meetingSweepLoop(): Promise<void> {
  if (!RECALL_API_KEY) {
    console.info('[meeting] sweep disabled: RECALL_API_KEY is not set. Mail still ingests.');
    return;
  }

  while (running) {
    // Short sleeps so SIGTERM is not waited out, and sleeping first keeps the
    // sweep clear of startup.
    const wakeAt = Date.now() + MEETING_SWEEP_MS;
    while (running && Date.now() < wakeAt) await sleep(1_000);
    if (!running) return;

    try {
      const result = await sweepMeetings(db, RECALL_API_KEY, RECALL_REGION, MEETING_SWEEP_BATCH);

      // Silent when there was nothing to do, which is the healthy steady state.
      // A line every five minutes saying "0" trains people to skim.
      if (result.requested > 0 || result.queued > 0 || result.failed > 0) {
        console.info(
          `[meeting] sweep: considered=${result.considered} requested=${result.requested} ` +
            `queued=${result.queued} pending=${result.pending} failed=${result.failed}`,
        );
      }
    } catch (error) {
      // Must never take the worker down. Meetings are additive and mail
      // ingests perfectly well without them.
      console.error(
        '[meeting] sweep errored:',
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/**
 * Messages each catch-up gave up on in this process's life — see the `giveUp`
 * parameter on each. Module-level so they survive between sweeps, and in memory
 * so a restart or a new model gives every one of them another try.
 */
const summaryGiveUp = new Set<string>();
const embedGiveUp = new Set<string>();
const extractGiveUp = new Set<string>();

/**
 * One loop for all three catch-ups, in the same order ingest runs them:
 * summaries, then embeddings, then extraction.
 *
 * ⚠ One loop, not three, because summaries and extraction share a model and so
 * a per-minute token window. Three independent loops would wake together and
 * hit Groq at once — the contention each of them is already careful to avoid
 * with live ingest, recreated between themselves. Sequential, they cannot.
 *
 * ⚠ Each step is wrapped separately. A summary sweep that throws must not cost
 * the embedding and extraction sweeps behind it their turn.
 */
async function catchUpLoop(): Promise<void> {
  while (running) {
    // Broken into short sleeps so SIGTERM is not waited out. Sleeping FIRST
    // also keeps the sweep clear of startup, when the queue is likeliest busy.
    const wakeAt = Date.now() + EXTRACT_SWEEP_MS;
    while (running && Date.now() < wakeAt) await sleep(1_000);
    if (!running) return;

    if (summariser) {
      try {
        const result = await catchUpSummaries(
          db,
          summariser,
          CATCH_UP_BATCH,
          CATCH_UP_DELAY_MS,
          summaryGiveUp,
        );
        // Silent when there is nothing outstanding — a line every 15 minutes
        // saying "0" would train people to skim.
        if (result.considered > 0) {
          console.info(
            `[summary-catchup] sweep: considered=${result.considered} ` +
              `written=${result.written} skipped=${result.skipped} failed=${result.failed}`,
          );
        }
      } catch (error) {
        console.error(
          '[summary-catchup] sweep errored:',
          error instanceof Error ? error.message : error,
        );
      }
    }

    try {
      const result = await catchUpEmbeddings(db, EMBED_CATCH_UP_BATCH, embedGiveUp);
      if (result.considered > 0) {
        console.info(
          `[embed-catchup] sweep: considered=${result.considered} ` +
            `embedded=${result.embedded} chunks=${result.chunks} ` +
            `skipped=${result.skipped} failed=${result.failed}`,
        );
      }
    } catch (error) {
      console.error(
        '[embed-catchup] sweep errored:',
        error instanceof Error ? error.message : error,
      );
    }

    if (!extractor) continue;

    try {
      const result = await catchUpExtractions(
        db,
        extractor,
        CATCH_UP_BATCH,
        CATCH_UP_DELAY_MS,
        extractGiveUp,
      );

      if (result.considered > 0) {
        console.info(
          `[extract-catchup] sweep: considered=${result.considered} ` +
            `written=${result.written} rows=${result.rows} ` +
            `skipped=${result.skipped} failed=${result.failed}`,
        );
      }
    } catch (error) {
      // Must never take the worker down: this is a repair loop for an additive
      // feature, and mail ingests perfectly well without it.
      console.error(
        '[extract-catchup] sweep errored:',
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/**
 * Stranded-event reaper, at startup and then every five minutes.
 *
 * ⚠ The answer to 27 events found stuck in 'processing' on 2026-09-24, the
 * oldest since 4 August — and to the extraction catch-up having been switched
 * off by them for all of that time. The full account is in `queue.ts`.
 *
 * At STARTUP first, because a restart is exactly when a row has just been
 * stranded: the process that claimed it is the one that died. `STALE_CLAIM_MINUTES`
 * still applies, so a row the previous revision is finishing during a deploy is
 * left alone.
 *
 * Cheap enough to run forever: one UPDATE over a few hundred rows that matches
 * nothing in the healthy steady state, and says nothing when it does.
 */
const RECLAIM_SWEEP_MS = 5 * 60 * 1000;

async function reclaimLoop(): Promise<void> {
  while (running) {
    try {
      const result = await reclaimStaleEvents(db, MAX_ATTEMPTS);
      if (result.requeued > 0 || result.failed > 0) {
        // Loud, because every one of these is an event a worker died holding.
        console.warn(
          `[reclaim] ${result.requeued} event(s) stuck in processing for over ` +
            `${STALE_CLAIM_MINUTES} minutes returned to the queue` +
            (result.failed > 0 ? `; ${result.failed} were out of attempts and parked as failed` : ''),
        );
      }
    } catch (error) {
      console.error('[reclaim] sweep errored:', error instanceof Error ? error.message : error);
    }

    const wakeAt = Date.now() + RECLAIM_SWEEP_MS;
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

/**
 * Load the embedding model at startup, not on first use.
 *
 * ⚠ **Deliberately not awaited, and deliberately not fatal.** The worker runs
 * `minReplicas: 1` so these 129 MB of weights stay resident (ADR-011), and
 * loading them takes seconds — blocking the ingest loop on that would stall
 * mail behind a feature mail does not depend on.
 *
 * A failure here is logged loudly and the worker carries on: the container
 * image may legitimately not carry the native ONNX binaries, and when it does
 * not, the right behaviour is "no semantic search" rather than a crashloop.
 * That is what turns a Dockerfile mistake into a degraded feature instead of an
 * outage — which matters, because this image cannot be built locally to check.
 */
void warmEmbedder().then((result) => {
  if (result.ok) {
    console.info(`[embed] model ready in ${(result.ms / 1000).toFixed(1)}s`);
    if (!EMBED_API_SECRET) {
      console.warn(
        '[embed-api] /embed is DISABLED: EMBED_API_SECRET is not set. ' +
          'The assistant cannot embed questions until it is.',
      );
    }
  } else {
    console.error(
      `[embed] DISABLED: the model failed to load after ${(result.ms / 1000).toFixed(1)}s — ` +
        `${result.reason}. Mail still ingests; semantic search and the assistant will not work.`,
    );
  }
});

void reclaimLoop();
void loop();
void watchRenewalLoop();
void catchUpLoop();
void meetingSweepLoop();

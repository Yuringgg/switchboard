/**
 * Watch a Recall bot and write down what it actually sends back (Phase 7A).
 *
 * Run:
 *   node --env-file=apps/worker/.env \
 *     apps/worker/node_modules/tsx/dist/cli.mjs \
 *     apps/worker/scripts/probe-recall.ts --bot <uuid>
 *
 * Flags:
 *   --bot ID       the bot to watch                    (required)
 *   --every MS     pause between polls                 (default 15000)
 *   --for MS       give up after this long             (default 1800000 — 30m)
 *   --out PATH     where to write the shapes           (default D:/Claude Code/_scratch/recall)
 *
 * ── ⚠ WHY THIS EXISTS, AND WHY IT IS A SCRIPT ───────────────────────────────
 *
 * Phase 7A is written against a payload shape **nobody has seen**. Recall's
 * webhook schemas live in doc components their docs API does not expand, and
 * their dashboard's webhook page — an embedded Svix portal — cannot currently
 * create an endpoint at all: the Create button does nothing in two browsers,
 * and the equivalent API call returns an empty error. Notably there is no
 * webhook path anywhere in `list_rate_limits`, which is every public endpoint
 * they document. So the push route is stuck on their side.
 *
 * **But nothing about Phase 7A actually requires push.** `GET /bot/{id}`,
 * `/recording/{id}` and `/transcript/{id}` are all public, all at 300/min. A
 * webhook is Recall telling us; polling is us asking. The answer is the same.
 *
 * This script asks, and **writes the answers to disk untouched** — the same
 * discipline `/api/webhooks/recall` follows with `raw_events`. It exists to end
 * an argument with evidence rather than to ship a feature:
 *
 *   · does `recording.done`-shaped data carry a bot id, or only a recording id?
 *     (the open question in `lib/meetings/payload.ts`, and the one that decides
 *     whether the tenant lookup works at all)
 *   · what does a transcript actually look like once downloaded?
 *   · which fields are present on a real bot versus documented?
 *
 * ⚠ It writes NOTHING to the database. Reading a shape and deciding what it
 * means are two jobs, and doing them in one pass is how a guess becomes a
 * schema.
 *
 * ⚠ Output goes to disk outside the repo by default, because a real transcript
 * is somebody's private conversation and does not belong in git.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const BOT_ID = flag('bot');
const EVERY_MS = Number(flag('every') ?? 15_000);
const FOR_MS = Number(flag('for') ?? 30 * 60_000);
const OUT_DIR = flag('out') ?? 'D:/Claude Code/_scratch/recall';

const REGION = process.env.RECALL_REGION ?? 'ap-northeast-1';
const BASE = `https://${REGION}.recall.ai/api/v1`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Terminal states — polling past these only burns rate limit. */
const FINISHED = new Set(['done', 'fatal', 'media_expired', 'analysis_done', 'analysis_failed']);

async function get(apiKey: string, path: string): Promise<unknown> {
  // ⚠ No `Bearer`. Recall's own examples use the bare key, and adding the
  // prefix produces a 401 that reads exactly like a wrong key.
  const response = await fetch(`${BASE}${path}`, {
    headers: { authorization: apiKey, accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`GET ${path} → HTTP ${response.status}`);
  }

  return response.json();
}

/** Every key present, nested, so a shape can be read at a glance. */
function shapeOf(value: unknown, depth = 0): unknown {
  if (depth > 4) return '…';
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [shapeOf(value[0], depth + 1), `…${value.length} total`];
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, shapeOf(v, depth + 1)]),
    );
  }
  return value === null ? null : typeof value;
}

async function save(name: string, data: unknown): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  saved → ${path}`);
}

async function main(): Promise<void> {
  const apiKey = process.env.RECALL_API_KEY;
  if (!apiKey) throw new Error('RECALL_API_KEY is not set');
  if (!BOT_ID) throw new Error('--bot <uuid> is required');

  console.log(`[probe] watching bot ${BOT_ID} in ${REGION}`);

  const startedAt = Date.now();
  let bot: Record<string, unknown> | null = null;

  while (Date.now() - startedAt < FOR_MS) {
    bot = (await get(apiKey, `/bot/${BOT_ID}/`)) as Record<string, unknown>;

    const status =
      typeof bot.status_changes === 'object'
        ? JSON.stringify(shapeOf(bot.status_changes))
        : String((bot as { status?: unknown }).status ?? 'unknown');

    // The last status code is the useful part; the whole array is saved anyway.
    const changes = Array.isArray(bot.status_changes) ? bot.status_changes : [];
    const latest = changes.length
      ? ((changes[changes.length - 1] as { code?: string })?.code ?? 'unknown')
      : status;

    console.log(`[probe] ${new Date().toISOString()}  ${latest}`);

    if (FINISHED.has(latest)) break;
    await sleep(EVERY_MS);
  }

  if (!bot) throw new Error('never got a bot back');

  await save('bot.json', bot);
  await save('bot.shape.json', shapeOf(bot));

  /*
   * ⚠⚠ THE QUESTION THIS SCRIPT EXISTS TO ANSWER.
   *
   * `lib/meetings/payload.ts` looks the tenant up by BOT id. If a recording
   * only knows its own id, that lookup returns nothing for the one delivery
   * that carries the meeting — failing closed, which is right, and useless.
   */
  const recordings = Array.isArray(bot.recordings) ? bot.recordings : [];
  console.log(`[probe] ${recordings.length} recording(s) on this bot`);

  for (const [index, entry] of recordings.entries()) {
    const id = (entry as { id?: string })?.id;
    if (!id) continue;

    const recording = (await get(apiKey, `/recording/${id}/`)) as Record<string, unknown>;
    await save(`recording-${index}.json`, recording);
    await save(`recording-${index}.shape.json`, shapeOf(recording));

    const hasBotId = JSON.stringify(recording).includes(String(BOT_ID));
    console.log(
      `[probe] recording ${id}: ${hasBotId ? 'DOES' : 'does NOT'} mention the bot id — ` +
        'this is what decides how the tenant lookup has to work',
    );
  }

  console.log('\n[probe] done. Read the *.shape.json files before writing any mapping.');
}

main().catch((cause) => {
  console.error(`[probe] ${cause instanceof Error ? cause.message : 'failed'}`);
  process.exit(1);
});

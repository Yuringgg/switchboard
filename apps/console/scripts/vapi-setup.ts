/**
 * Create the four voice tools in Vapi, and attach them to the assistant.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The dashboard form is long, it does not keep a draft while you navigate away
 * to create a credential, and there are four of these to fill in identically.
 * Two attempts were lost that way on 2026-09-10. The API takes a whole tool in
 * one POST, so there is nothing to half-finish.
 *
 * It is also the version that can be re-run, read, and reviewed. A tool created
 * by clicking is a tool nobody can diff.
 *
 * ── Running it ──────────────────────────────────────────────────────────────
 *
 *   VAPI_API_KEY=<private key> npx tsx apps/console/scripts/vapi-setup.ts
 *
 * Flags:
 *   --clean   also delete leftover tools literally named `function_tool`
 *             (the empty drafts the dashboard leaves behind)
 *
 * ⚠ The PRIVATE key, from Vapi → Settings → API Keys. Not the public one. It is
 * read from the environment and never written anywhere by this script.
 *
 * ── Idempotent ──────────────────────────────────────────────────────────────
 *
 * Re-running updates the four tools in place rather than creating duplicates,
 * so it is safe to run again after changing a description or the server URL.
 */

const API = 'https://api.vapi.ai';

/** Where Vapi sends tool calls. Override for a tunnel during local testing. */
const SERVER_URL =
  process.env.VAPI_SERVER_URL ??
  'https://switchboard-console-beryl.vercel.app/api/webhooks/vapi';

/** The HMAC credential created in Settings → Integrations. Matched by name. */
const CREDENTIAL_NAME = process.env.VAPI_CREDENTIAL_NAME ?? 'switchboard-webhook';

/** Which assistant gets the tools. Matched by name. */
const ASSISTANT_NAME = process.env.VAPI_ASSISTANT_NAME ?? 'Switchboard';

/**
 * The five tools, and nothing else.
 *
 * ⚠ These names are the contract. `apps/console/src/lib/voice/tools.ts` has the
 * same four in `VOICE_TOOLS` and the webhook refuses anything not on that list,
 * so a name changed here without changing it there produces an agent that calls
 * a tool and is told it does not exist.
 *
 * ⚠ `get_meeting_brief` is deliberately absent. It has no implementation, and
 * an agent that offers it fails mid-sentence — aloud, with no screen to notice
 * on. Add it here the day the feature exists, not before.
 */
const TOOLS = [
  {
    name: 'resolve_person',
    description:
      "Turn a spoken name into a specific person. Call this first whenever the user says someone's name.",
    properties: {
      name: { type: 'string', description: 'The name the user said.' },
    },
    required: ['name'],
  },
  {
    name: 'get_attention_items',
    description:
      "What needs the user's attention today: meetings, commitments, action items and questions pulled out of their messages.",
    properties: {},
    required: [],
  },
  {
    name: 'get_recent_messages',
    description:
      "The latest messages in the user's inbox, newest first. Use this for \"what's in my inbox\", \"any new emails\", \"what did I get today\" — anything asking what has arrived rather than searching for a specific thing.",
    properties: {
      channel: {
        type: 'string',
        description:
          "Optional. \"gmail\" or \"whatsapp\" to narrow it. Leave empty for both.",
      },
    },
    required: [],
  },
  {
    name: 'search_messages',
    description: 'Find messages across Gmail and WhatsApp by keyword.',
    properties: {
      query: { type: 'string', description: 'What to search for.' },
    },
    required: ['query'],
  },
  {
    name: 'get_person_activity',
    description:
      'What one person has recently been in touch about. Requires a person_id from resolve_person.',
    properties: {
      person_id: {
        type: 'string',
        description: 'The personId returned by resolve_person.',
      },
    },
    required: ['person_id'],
  },
] as const;

const apiKey = process.env.VAPI_API_KEY;
if (!apiKey) {
  console.error(
    'Missing VAPI_API_KEY.\n\n' +
      '  Vapi dashboard → Settings → API Keys → the PRIVATE key.\n' +
      '  Then: VAPI_API_KEY=<key> npx tsx apps/console/scripts/vapi-setup.ts\n',
  );
  process.exit(1);
}

const clean = process.argv.includes('--clean');

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    /*
     * The body is read here because Vapi's validation errors name the offending
     * field, which is the whole value of running this rather than clicking. It
     * is a config API, not a completion API — no message content passes through
     * it, so the never-log-content rule is not in play.
     */
    const detail = await response.text().catch(() => '');
    throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}\n${detail}`);
  }

  return (await response.json()) as T;
}

/*
 * ⚠ Prefixed, because `Credential` and `Assistant` are DOM globals and a bare
 * `interface Credential` MERGES with the built-in one rather than shadowing it
 * — which fails with "All declarations of 'id' must have identical modifiers",
 * an error that names neither the collision nor the global.
 */
interface VapiTool {
  id: string;
  type?: string;
  function?: { name?: string };
}
interface VapiCredential {
  id: string;
  name?: string;
}
interface VapiAssistant {
  id: string;
  name?: string;
  model?: Record<string, unknown> & { toolIds?: string[] };
}

async function main(): Promise<void> {
  console.info(`server url  ${SERVER_URL}`);

  // ── The credential ────────────────────────────────────────────────────────
  const credentials = await call<VapiCredential[]>('/credential');
  const credential = credentials.find((row) => row.name === CREDENTIAL_NAME);

  if (!credential) {
    console.error(
      `\nNo custom credential named "${CREDENTIAL_NAME}".\n\n` +
        '  Vapi → Settings → Integrations → Custom Credential, type HMAC.\n' +
        '  Fill in the name and your secret; leave every other field default.\n' +
        '  The route expects Vapi\'s defaults: x-signature, x-timestamp,\n' +
        '  {timestamp}.{body}, hex.\n',
    );
    process.exit(1);
  }

  console.info(`credential  ${CREDENTIAL_NAME} ✓`);

  // ── The tools ─────────────────────────────────────────────────────────────
  const existing = await call<VapiTool[]>('/tool');
  const byName = new Map(
    existing.filter((tool) => tool.function?.name).map((tool) => [tool.function!.name!, tool]),
  );

  const toolIds: string[] = [];

  for (const spec of TOOLS) {
    const body = {
      type: 'function',
      async: false,
      function: {
        name: spec.name,
        description: spec.description,
        parameters: {
          type: 'object',
          properties: spec.properties,
          required: spec.required,
        },
      },
      server: {
        url: SERVER_URL,
        credentialId: credential.id,
        timeoutSeconds: 20,
      },
    };

    const found = byName.get(spec.name);

    // Update in place rather than creating a second one. Re-running this script
    // must not leave the assistant with two tools of the same name, which is
    // ambiguous and picked between silently.
    const saved = found
      ? await call<VapiTool>(`/tool/${found.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      : await call<VapiTool>('/tool', { method: 'POST', body: JSON.stringify(body) });

    toolIds.push(saved.id);
    console.info(`tool        ${spec.name} ${found ? 'updated' : 'created'}`);
  }

  // ── The empty drafts the dashboard leaves behind ──────────────────────────
  const junk = existing.filter((tool) => tool.function?.name === 'function_tool');

  if (junk.length > 0 && clean) {
    for (const tool of junk) {
      await call(`/tool/${tool.id}`, { method: 'DELETE' });
      console.info(`deleted     function_tool (${tool.id.slice(0, 8)}…)`);
    }
  } else if (junk.length > 0) {
    console.info(
      `\n${junk.length} leftover tool(s) named "function_tool". Re-run with --clean to remove them.`,
    );
  }

  // ── Attach to the assistant ───────────────────────────────────────────────
  const assistants = await call<VapiAssistant[]>('/assistant');
  const assistant = assistants.find((row) => row.name === ASSISTANT_NAME);

  if (!assistant) {
    console.info(
      `\nTools are ready, but no assistant named "${ASSISTANT_NAME}" was found.\n` +
        '  Attach them by hand: Assistants → your assistant → Tools → Add Tool.\n',
    );
    return;
  }

  /*
   * ⚠ The existing `model` object is spread back in, not replaced.
   *
   * PATCHing `{ model: { toolIds } }` on its own would drop the provider, the
   * model name and the system prompt — everything else that lives on that
   * object. The assistant would keep working just differently enough that
   * nobody would connect it to this script.
   */
  const currentModel = assistant.model ?? {};
  const currentIds = new Set(currentModel.toolIds ?? []);
  for (const id of toolIds) currentIds.add(id);

  await call(`/assistant/${assistant.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ model: { ...currentModel, toolIds: [...currentIds] } }),
  });

  console.info(`assistant   ${ASSISTANT_NAME} → ${toolIds.length} tools attached ✓`);
  console.info('\nDone. Talk to the assistant to test it.');
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

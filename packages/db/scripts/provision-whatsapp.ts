/**
 * Provision a WhatsApp business number as a channel for one owner.
 *
 * ── Why this is a script and not a Connect button ────────────────────────────
 *
 * Gmail is self-serve: a user consents, and the OAuth callback writes a channel
 * scoped to them. WhatsApp cannot work that way and it is not an oversight.
 * A WhatsApp number belongs to the **business**, is registered to a WABA, and
 * is what customers message — a user cannot connect "their own WhatsApp" any
 * more than they could connect their employer's switchboard. `docs/03-RESOURCES
 * .md` §2 and ADR-009: **admin-provisioned, not self-serve.**
 *
 * So assigning a number to a tenant is an administrative act, done deliberately,
 * with the operator holding the credentials. That is a script.
 *
 * ── What it writes ───────────────────────────────────────────────────────────
 *
 *   display_name         the number a human reads          +63 917 000 0001
 *   external_account_id  Meta's phone_number_id            106540352242922
 *   credentials          ENCRYPTED access token + ids      AES-256-GCM
 *
 * ⚠ `external_account_id` is the **tenant lookup key**. `/api/webhooks/whatsapp`
 * matches an inbound `phone_number_id` against it and takes `owner_id` from the
 * row it finds. Point it at the wrong owner and that tenant receives another
 * business's messages — the worker runs as `service_role`, so no RLS policy
 * will catch it. Migration 0006 makes it unique per channel type so the same
 * number cannot be provisioned twice.
 *
 * Run:
 *   node --experimental-strip-types packages/db/scripts/provision-whatsapp.ts \
 *     --owner <uuid> --phone-number-id <id> --display "+63 917 000 0001"
 *
 * Needs DATABASE_URL, CHANNEL_CREDENTIALS_KEY and WHATSAPP_ACCESS_TOKEN in the
 * environment — `apps/worker/.env` already holds the first two.
 *
 * ⚠ The access token is read from the environment, never from an argument.
 * Command lines end up in shell history, in `ps` output, and in CI logs.
 */
import { encryptSecret } from '@switchboard/core';
import postgres from 'postgres';

interface Args {
  owner: string;
  phoneNumberId: string;
  display: string;
  wabaId?: string;
}

function readArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  const owner = get('--owner');
  const phoneNumberId = get('--phone-number-id');
  const display = get('--display');

  if (!owner || !phoneNumberId || !display) {
    throw new Error(
      'Usage: provision-whatsapp.ts --owner <uuid> --phone-number-id <id> ' +
        '--display "+63 917 000 0001" [--waba-id <id>]',
    );
  }

  // A phone_number_id is Meta's own opaque numeric string. Catching a display
  // number pasted here is worth one regex: the two are easy to confuse and the
  // mistake is silent — every webhook lookup simply misses forever.
  if (!/^\d{5,}$/.test(phoneNumberId)) {
    throw new Error(
      `--phone-number-id must be Meta's numeric phone_number_id (e.g. 106540352242922), ` +
        `not the display number. Got: ${phoneNumberId}`,
    );
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner)) {
    throw new Error(`--owner must be a user uuid from auth.users. Got: ${owner}`);
  }

  return { owner, phoneNumberId, display, ...(get('--waba-id') ? { wabaId: get('--waba-id') } : {}) };
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  const credentialsKey = process.env.CHANNEL_CREDENTIALS_KEY;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  if (!credentialsKey) throw new Error('CHANNEL_CREDENTIALS_KEY is not set.');
  if (!accessToken) {
    throw new Error(
      'WHATSAPP_ACCESS_TOKEN is not set. Provide it in the environment, never as ' +
        'a command-line argument — argv reaches shell history and process listings.',
    );
  }

  // Encrypted the same way and with the same key as a Gmail refresh token.
  // The column is `bytea` precisely so that assigning plaintext looks wrong.
  const credentials = encryptSecret(
    JSON.stringify({
      access_token: accessToken,
      phone_number_id: args.phoneNumberId,
      ...(args.wabaId ? { waba_id: args.wabaId } : {}),
    }),
    credentialsKey,
  );

  const sql = postgres(databaseUrl, { prepare: false });

  try {
    /*
     * Verify the owner exists before writing.
     *
     * `channels.owner_id` references `auth.users`, so a bad uuid would fail on
     * the foreign key anyway — but it would fail as a constraint violation
     * naming a table this script never mentions. A typo'd uuid is the most
     * likely mistake here and it deserves a sentence, not a stack trace.
     */
    const owners = await sql<{ id: string; email: string | null }[]>`
      select id, email from auth.users where id = ${args.owner}::uuid
    `;

    if (owners.length === 0) {
      throw new Error(
        `No user with id ${args.owner}. List them with: ` +
          `select id, email from auth.users;`,
      );
    }

    const [row] = await sql<{ id: string; created: boolean }[]>`
      insert into channels (owner_id, type, display_name, external_account_id, credentials, status)
      values (
        ${args.owner}::uuid, 'whatsapp', ${args.display},
        ${args.phoneNumberId}, ${credentials}, 'active'
      )
      -- Re-running with a rotated token must update, not fail and not duplicate.
      -- Migration 0003 already stops a second row for the same display name;
      -- 0006's index is the one that matters here, because the number is the
      -- identity and the display name is only what it is called.
      on conflict (type, external_account_id) where external_account_id is not null
      do update set
        credentials  = excluded.credentials,
        display_name = excluded.display_name,
        owner_id     = excluded.owner_id,
        status       = 'active',
        last_error   = null
      returning id, (xmax = 0) as created
    `;

    if (!row) throw new Error('channel upsert returned no row');

    console.info(
      `${row.created ? 'Provisioned' : 'Updated'} WhatsApp channel ${row.id}\n` +
        `  number       ${args.display}\n` +
        `  owner        ${owners[0]?.email ?? args.owner}\n` +
        `  lookup key   ${args.phoneNumberId}\n\n` +
        `Next: point the Meta app's webhook at /api/webhooks/whatsapp, subscribe the\n` +
        `"messages" field, and send a message to this number from a verified recipient.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  // The message only — an error here can carry a connection string.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

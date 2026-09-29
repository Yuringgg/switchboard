import { randomBytes } from 'node:crypto';

import type { ContainerClient } from '@azure/storage-blob';
import { encryptSecret } from '@switchboard/core';
import type { Database } from '@switchboard/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  blobName,
  MAX_FILE_BYTES,
  MIN_IMAGE_BYTES,
  sweepFiles,
  whySkip,
} from '../src/file-sweep';

/**
 * The file sweep — Ms. Maria's research task 5.
 *
 * What matters: real documents are kept and logos are not; a message with
 * nothing worth keeping is still marked done (or it is re-downloaded forever);
 * every row carries the owner from the MESSAGE row, because this runs as
 * service role; and a blob name cannot be steered by a filename.
 */

describe('whySkip', () => {
  it('keeps real documents', () => {
    expect(whySkip({ filename: 'Q3 quote.pdf', mimeType: 'application/pdf', sizeBytes: 120_000 })).toBeNull();
    expect(whySkip({ filename: 'budget.xlsx', mimeType: 'application/vnd.ms-excel', sizeBytes: 9_000 })).toBeNull();
  });

  it('keeps a real photo but skips a logo-sized image', () => {
    expect(whySkip({ filename: 'site.jpg', mimeType: 'image/jpeg', sizeBytes: MIN_IMAGE_BYTES + 1 })).toBeNull();
    expect(whySkip({ filename: 'image001.png', mimeType: 'image/png', sizeBytes: 4_200 })).toBe('small-image');
  });

  it('skips calendar invites — they are already read as meetings', () => {
    expect(whySkip({ filename: 'invite.ics', mimeType: 'text/calendar', sizeBytes: 2_000 })).toBe('calendar-invite');
    expect(whySkip({ filename: 'meeting.ICS', mimeType: 'application/octet-stream', sizeBytes: 2_000 })).toBe('calendar-invite');
  });

  it('skips anything past Gmail’s own 25 MB ceiling, and anything unnamed', () => {
    expect(whySkip({ filename: 'huge.zip', mimeType: 'application/zip', sizeBytes: MAX_FILE_BYTES + 1 })).toBe('too-large');
    expect(whySkip({ filename: '  ', mimeType: 'application/pdf', sizeBytes: 10 })).toBe('unnamed');
  });
});

describe('blobName', () => {
  const OWNER = '11111111-1111-4111-8111-111111111111';
  const MESSAGE = '22222222-2222-4222-8222-222222222222';

  it('puts the owner first, so one tenant is one prefix', () => {
    expect(blobName(OWNER, MESSAGE, 0, 'quote.pdf')).toBe(`${OWNER}/${MESSAGE}/0-quote.pdf`);
  });

  it('cannot be steered into another folder by a filename', () => {
    const name = blobName(OWNER, MESSAGE, 1, '../../other-tenant/x.pdf');
    expect(name.startsWith(`${OWNER}/${MESSAGE}/1-`)).toBe(true);
    expect(name.split('/')).toHaveLength(3);
  });

  it('keeps the extension when it shortens a long name', () => {
    const name = blobName(OWNER, MESSAGE, 2, `${'a'.repeat(300)}.docx`);
    expect(name.endsWith('.docx')).toBe(true);
    expect(name.length).toBeLessThan(250);
  });

  it('names an unnamed file rather than leaving a trailing dash', () => {
    expect(blobName(OWNER, MESSAGE, 3, undefined)).toBe(`${OWNER}/${MESSAGE}/3-file`);
  });
});

/* ── One whole pass, with Gmail and Azure faked ─────────────────────────── */

const KEY = randomBytes(32).toString('base64');
const OWNER = 'ec7645a6-11b8-456a-bbcc-03b94e5841db';

function candidate(id: string, externalId: string) {
  return {
    id,
    owner_id: OWNER,
    channel_id: 'ch-1',
    external_id: externalId,
    mailbox: 'me@example.com',
    credentials: encryptSecret(JSON.stringify({ refresh_token: 'rt' }), KEY),
  };
}

/** A Gmail message whose attachments are these parts. */
function gmailMessage(id: string, parts: { filename: string; mimeType: string; size: number }[]) {
  return {
    id,
    threadId: `t-${id}`,
    internalDate: '1790000000000',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Maria <maria@acme.ph>' },
        { name: 'To', value: 'me@example.com' },
        { name: 'Subject', value: 'Files' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { size: 5, data: Buffer.from('hello').toString('base64url') } },
        ...parts.map((part, i) => ({
          mimeType: part.mimeType,
          filename: part.filename,
          body: { size: part.size, attachmentId: `att-${i}` },
        })),
      ],
    },
  };
}

/** Records every SQL statement; answers the candidate query and nothing else. */
function stubDb(candidates: unknown[]) {
  const statements: { text: string; params: unknown[] }[] = [];
  const toStatement = (query: unknown) => {
    const chunks = (query as { queryChunks: unknown[] }).queryChunks;
    const text = chunks
      .map((c) => (typeof c === 'object' && c && 'value' in c ? (c as { value: string[] }).value.join('') : '?'))
      .join('');
    const params = chunks.filter((c) => !(typeof c === 'object' && c && 'value' in c));
    return { text, params };
  };
  let first = true;
  const execute = async (query: unknown) => {
    statements.push(toStatement(query));
    if (first) {
      first = false;
      return candidates;
    }
    return [];
  };
  const db = {
    execute,
    transaction: async (fn: (tx: { execute: typeof execute }) => Promise<void>) => fn({ execute }),
  } as unknown as Database;
  return { db, statements };
}

function stubContainer() {
  const uploads: { name: string; bytes: number; type?: string }[] = [];
  const container = {
    getBlockBlobClient: (name: string) => ({
      uploadData: async (data: Buffer, options?: { blobHTTPHeaders?: { blobContentType?: string } }) => {
        uploads.push({ name, bytes: data.length, type: options?.blobHTTPHeaders?.blobContentType });
      },
    }),
  } as unknown as ContainerClient;
  return { container, uploads };
}

function stubGmail(messages: Record<string, unknown>) {
  const pdf = Buffer.alloc(40_000, 1).toString('base64url');
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
    }
    const attachment = /\/messages\/([^/]+)\/attachments\//.exec(url);
    if (attachment) return new Response(JSON.stringify({ size: 40_000, data: pdf }), { status: 200 });
    const message = /\/messages\/([^/?]+)\?format=full/.exec(url);
    if (message && messages[message[1]!]) {
      return new Response(JSON.stringify(messages[message[1]!]), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
}

const CONFIG = { credentialsKey: KEY, clientId: 'id', clientSecret: 'secret' };

afterEach(() => vi.unstubAllGlobals());

describe('sweepFiles', () => {
  it('saves the document, skips the logo, and records both in one run', async () => {
    stubGmail({
      g1: gmailMessage('g1', [
        { filename: 'Quote.pdf', mimeType: 'application/pdf', size: 40_000 },
        { filename: 'image001.png', mimeType: 'image/png', size: 3_000 },
      ]),
    });
    const { db, statements } = stubDb([candidate('m1', 'g1')]);
    const { container, uploads } = stubContainer();

    const result = await sweepFiles(db, container, CONFIG, 10);

    expect(result).toMatchObject({ considered: 1, done: 1, saved: 1, skipped: 1, failed: 0 });
    expect(uploads).toEqual([{ name: `${OWNER}/m1/0-Quote.pdf`, bytes: 40_000, type: 'application/pdf' }]);

    const insert = statements.find((s) => s.text.includes('insert into attachments'));
    // ⚠ The owner comes from the message row. This runs as service role.
    expect(insert?.params).toContain(OWNER);
    const run = statements.find((s) => s.text.includes('insert into message_attachment_runs'));
    expect(run?.params).toEqual(expect.arrayContaining(['m1', OWNER, 1, 1]));
  });

  it('marks a message with nothing worth keeping as DONE, so it is not fetched forever', async () => {
    stubGmail({
      g2: gmailMessage('g2', [{ filename: 'invite.ics', mimeType: 'text/calendar', size: 900 }]),
    });
    const { db, statements } = stubDb([candidate('m2', 'g2')]);
    const { container, uploads } = stubContainer();

    const result = await sweepFiles(db, container, CONFIG, 10);

    expect(uploads).toHaveLength(0);
    expect(result).toMatchObject({ done: 1, saved: 0, skipped: 1 });
    expect(statements.some((s) => s.text.includes('insert into message_attachment_runs'))).toBe(true);
  });

  it('marks a message deleted from Gmail as done rather than failing it every pass', async () => {
    stubGmail({});
    const { db, statements } = stubDb([candidate('m3', 'gone')]);
    const { container } = stubContainer();

    const result = await sweepFiles(db, container, CONFIG, 10);

    expect(result).toMatchObject({ done: 1, failed: 0 });
    expect(statements.some((s) => s.text.includes('insert into message_attachment_runs'))).toBe(true);
  });

  it('gives up on a message that fails, for this process, and records nothing for it', async () => {
    stubGmail({ g4: gmailMessage('g4', [{ filename: 'a.pdf', mimeType: 'application/pdf', size: 40_000 }]) });
    const { db, statements } = stubDb([candidate('m4', 'g4')]);
    const container = {
      getBlockBlobClient: () => ({
        uploadData: async () => {
          throw new Error('azure is down');
        },
      }),
    } as unknown as ContainerClient;
    const giveUp = new Set<string>();

    const result = await sweepFiles(db, container, CONFIG, 10, giveUp);

    expect(result.failed).toBe(1);
    expect(giveUp.has('m4')).toBe(true);
    expect(statements.some((s) => s.text.includes('insert into message_attachment_runs'))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { EXPECTED_VARS, buildConfigReport, inspectVar } from '../src/lib/config-report';

const ORIGIN = 'https://switchboard-console-beryl.vercel.app';

function good(): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: 'https://ytrkpcryztwgflmbhfdu.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxxxxxxxxxxxxxx',
    CHANNEL_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64'),
    GOOGLE_CLIENT_ID: '468794256088-abc.apps.googleusercontent.com',
    // Short on purpose: long enough to carry the GOCSPX- prefix the shape
    // check looks for, short enough not to trip the pre-commit secret scan.
    // A fixture that looks exactly like a real credential trains people to
    // wave the scanner through.
    GOOGLE_CLIENT_SECRET: 'GOCSPX-fake',
    GOOGLE_OAUTH_REDIRECT_URI: `${ORIGIN}/api/auth/google/callback`,
    GOOGLE_PUBSUB_TOPIC: 'projects/switchboard-503613/topics/gmail-push',
    GOOGLE_PUBSUB_PUSH_AUDIENCE: `${ORIGIN}/api/webhooks/gmail`,
    GOOGLE_PUBSUB_SERVICE_ACCOUNT: 'gmail-push-invoker@switchboard-503613.iam.gserviceaccount.com',
    CRON_SECRET: 'a-long-random-value',
  };
}

describe('buildConfigReport', () => {
  it('reports ok when everything is present and well formed', () => {
    const report = buildConfigReport(good(), ORIGIN);
    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.malformed).toEqual([]);
  });

  it('names every missing variable', () => {
    const env = good();
    delete env.GOOGLE_CLIENT_ID;
    delete env.GOOGLE_PUBSUB_SERVICE_ACCOUNT;

    const report = buildConfigReport(env, ORIGIN);
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_PUBSUB_SERVICE_ACCOUNT']);
  });

  it('never includes a value anywhere in the output', () => {
    // The whole point: this can be pasted into a chat safely.
    const env = good();
    const serialised = JSON.stringify(buildConfigReport(env, ORIGIN));
    for (const value of Object.values(env)) {
      // Origin-derived values legitimately appear in "expected ..." messages.
      if (value.startsWith(ORIGIN)) continue;
      expect(serialised).not.toContain(value);
    }
  });

  it('covers exactly the variables the app reads', () => {
    const report = buildConfigReport({}, ORIGIN);
    expect(Object.keys(report.detail).sort()).toEqual([...EXPECTED_VARS].sort());
  });
});

describe('inspectVar', () => {
  it('distinguishes unset from set-but-empty', () => {
    expect(inspectVar('CRON_SECRET', undefined, ORIGIN)).toMatchObject({
      present: false,
      issues: ['not set on this deployment'],
    });
    expect(inspectVar('CRON_SECRET', '', ORIGIN)).toMatchObject({ present: true, length: 0 });
    expect(inspectVar('CRON_SECRET', '', ORIGIN).issues).toContain('set but empty');
  });

  it('catches a trailing newline from a paste', () => {
    const key = `${Buffer.alloc(32, 1).toString('base64')}\n`;
    const issues = inspectVar('CHANNEL_CREDENTIALS_KEY', key, ORIGIN).issues;
    expect(issues).toContain('contains a line break');
    expect(issues).toContain('has leading or trailing whitespace');
  });

  it('catches an encryption key of the wrong length', () => {
    // AES-256 needs 32 bytes. A 16-byte key is valid base64 and fails only at
    // first use, long after the paste that caused it.
    const short = Buffer.alloc(16, 1).toString('base64');
    expect(inspectVar('CHANNEL_CREDENTIALS_KEY', short, ORIGIN).issues.join(' ')).toMatch(
      /decodes to 16 bytes, must be 32/,
    );
  });

  it('accepts a correct 32-byte key even with surrounding whitespace flagged separately', () => {
    const key = Buffer.alloc(32, 9).toString('base64');
    expect(inspectVar('CHANNEL_CREDENTIALS_KEY', key, ORIGIN).issues).toEqual([]);
  });

  it('catches a localhost redirect URI left on a production deployment', () => {
    const issues = inspectVar(
      'GOOGLE_OAUTH_REDIRECT_URI',
      'http://localhost:3100/api/auth/google/callback',
      ORIGIN,
    ).issues;
    expect(issues.join(' ')).toMatch(/does not match this deployment/);
    expect(issues.join(' ')).toContain(`${ORIGIN}/api/auth/google/callback`);
  });

  it('catches a push audience that does not match the deployment', () => {
    // Must equal what Pub/Sub was configured with, or every delivery 401s.
    const issues = inspectVar(
      'GOOGLE_PUBSUB_PUSH_AUDIENCE',
      'https://example.com/api/webhooks/gmail',
      ORIGIN,
    ).issues;
    expect(issues.join(' ')).toMatch(/does not match this deployment/);
  });

  it('catches client id and secret that were swapped', () => {
    expect(
      inspectVar('GOOGLE_CLIENT_ID', 'GOCSPX-secret-value', ORIGIN).issues.join(' '),
    ).toMatch(/does not look like a Google client id/);
    expect(
      inspectVar('GOOGLE_CLIENT_SECRET', '123-abc.apps.googleusercontent.com', ORIGIN).issues.join(' '),
    ).toMatch(/does not look like a Google client secret/);
  });

  it('catches a bare topic name instead of the full path', () => {
    expect(inspectVar('GOOGLE_PUBSUB_TOPIC', 'gmail-push', ORIGIN).issues.join(' ')).toMatch(
      /projects\/<project>\/topics\/<topic>/,
    );
  });

  it('passes an unknown variable through without inventing rules', () => {
    expect(inspectVar('SOMETHING_ELSE', 'value', ORIGIN).issues).toEqual([]);
  });
});

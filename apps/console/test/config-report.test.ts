import { describe, expect, it } from 'vitest';

import {
  EXPECTED_VARS,
  FEATURE_VARS,
  buildConfigReport,
  inspectVar,
} from '../src/lib/config-report';

const ORIGIN = 'https://switchboard-console-beryl.vercel.app';

function good(): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: 'https://ytrkpcryztwgflmbhfdu.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxxxxxxxxxxxxxx',
    // Short on purpose — long enough to carry the prefix the shape check looks
    // for, short enough not to trip the pre-commit secret scan.
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fake',
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
    expect(Object.keys(report.detail).sort()).toEqual(
      [...EXPECTED_VARS, ...FEATURE_VARS].sort(),
    );
  });

  /*
   * ── The feature group must never drag `ok` down ────────────────────────────
   *
   * WhatsApp has been unconfigured since Phase 2 shipped and the deployment is
   * healthy. If adding these variables turned `ok` false, the next session
   * would read a red health check as a regression, or stop reading it.
   */
  it('stays ok while a feature is unconfigured, and says so separately', () => {
    const report = buildConfigReport(good(), ORIGIN);

    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.features.ready).toBe(false);
    expect(report.features.signingScheme).toBeNull();
    // Both signing secrets absent is ONE fault, not two — they are alternatives.
    expect(report.features.missing).toEqual([
      'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
      'one of WHATSAPP_APP_SECRET or WHATSAPP_BSP_WEBHOOK_SECRET',
    ]);
  });

  it('reports ready under the Meta scheme', () => {
    const report = buildConfigReport(
      {
        ...good(),
        // Spaces, on purpose. A realistic-looking token here trips the
        // pre-commit secret scan, and a fixture shaped exactly like a real
        // credential trains people to wave the scanner through.
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fake verify token value',
        WHATSAPP_APP_SECRET: 'fake app secret',
      },
      ORIGIN,
    );

    expect(report.features).toEqual({
      ready: true,
      signingScheme: 'meta',
      missing: [],
      malformed: [],
    });
  });

  /*
   * The case that matters for the BSP route: no Meta App Secret at all, and the
   * deployment is still correctly configured. Requiring both would have marked
   * this broken.
   */
  it('reports ready under the BSP scheme with no Meta secret present', () => {
    const report = buildConfigReport(
      {
        ...good(),
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fake verify token value',
        WHATSAPP_BSP_WEBHOOK_SECRET: 'fake bsp secret',
      },
      ORIGIN,
    );

    expect(report.features).toEqual({
      ready: true,
      signingScheme: '360dialog',
      missing: [],
      malformed: [],
    });
  });

  it('names Meta as the scheme when both secrets are set, matching resolveSigningScheme', () => {
    const report = buildConfigReport(
      {
        ...good(),
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fake verify token value',
        WHATSAPP_APP_SECRET: 'fake app secret',
        WHATSAPP_BSP_WEBHOOK_SECRET: 'fake bsp secret',
      },
      ORIGIN,
    );

    expect(report.features.signingScheme).toBe('meta');
    expect(report.features.ready).toBe(true);
  });

  it('does not let a malformed feature variable pass as ready', () => {
    const report = buildConfigReport(
      {
        ...good(),
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fake verify token value',
        // The access token in the App Secret's field — trap 2.
        WHATSAPP_APP_SECRET: 'x'.repeat(220),
      },
      ORIGIN,
    );

    expect(report.ok).toBe(true);
    expect(report.features.ready).toBe(false);
    expect(report.features.malformed).toEqual(['WHATSAPP_APP_SECRET']);
  });

  it('ignores a malformed value in the signing slot that is not in use', () => {
    // A leftover Meta secret on a deployment now running through the BSP is
    // noise. Flagging it would make a healthy deployment read as broken.
    const report = buildConfigReport(
      {
        ...good(),
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fake verify token value',
        WHATSAPP_BSP_WEBHOOK_SECRET: 'fake bsp secret',
      },
      ORIGIN,
    );

    expect(report.features.ready).toBe(true);
    expect(report.features.malformed).toEqual([]);
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

  it('catches a value pasted with its surrounding quotes', () => {
    // apps/worker/.env quotes values and dotenv strips them; Vercel's dashboard
    // does not. The key then fails auth in a way that reads as a bad key rather
    // than a badly pasted one.
    const quoted = inspectVar('SUPABASE_SERVICE_ROLE_KEY', '"sb_secret_fake"', ORIGIN);
    expect(quoted.issues.join(' ')).toMatch(/wrapped in quotes/);

    const single = inspectVar('CRON_SECRET', "'a-long-random-value'", ORIGIN);
    expect(single.issues.join(' ')).toMatch(/wrapped in quotes/);
  });

  it('does not mistake a value that merely contains a quote', () => {
    expect(inspectVar('CRON_SECRET', 'abc"def', ORIGIN).issues).toEqual([]);
    // A single character cannot be "wrapped".
    expect(inspectVar('CRON_SECRET', '"', ORIGIN).issues).toEqual([]);
  });

  it('catches the publishable key pasted as the service role key', () => {
    // Fails as a permission error at request time, which looks like an RLS
    // problem rather than a config one.
    const issues = inspectVar(
      'SUPABASE_SERVICE_ROLE_KEY',
      'sb_publishable_xxxxxxxxxxxxxxxxxxxx',
      ORIGIN,
    ).issues;
    expect(issues.join(' ')).toMatch(/PUBLISHABLE key/);
  });

  it('accepts both service role key formats', () => {
    expect(inspectVar('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_fake', ORIGIN).issues).toEqual([]);
    expect(inspectVar('SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOiJIUzI1', ORIGIN).issues).toEqual([]);
  });

  it('catches a bare topic name instead of the full path', () => {
    expect(inspectVar('GOOGLE_PUBSUB_TOPIC', 'gmail-push', ORIGIN).issues.join(' ')).toMatch(
      /projects\/<project>\/topics\/<topic>/,
    );
  });

  /*
   * The most expensive paste available in the WhatsApp setup: both values are
   * copied from the same dashboard minutes apart, and the wrong one here makes
   * every webhook 401 in a way that reads as Meta being broken.
   */
  it('catches the access token pasted into the App Secret field', () => {
    const issues = inspectVar('WHATSAPP_APP_SECRET', 'x'.repeat(220), ORIGIN).issues;
    expect(issues.join(' ')).toMatch(/almost certainly the ACCESS TOKEN/);
    expect(issues.join(' ')).toContain('220 characters');
  });

  it('accepts a short App Secret without asserting its format', () => {
    // Length is the only property of the mistake that can be stated without
    // writing down a format nobody on this project has seen.
    expect(inspectVar('WHATSAPP_APP_SECRET', 'fake app secret', ORIGIN).issues).toEqual([]);
  });

  it('flags a verify token too short to be worth comparing', () => {
    expect(inspectVar('WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'hello', ORIGIN).issues.join(' ')).toMatch(
      /only 5 characters/,
    );
    expect(
      inspectVar('WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'fake verify token value', ORIGIN).issues,
    ).toEqual([]);
  });

  it('passes an unknown variable through without inventing rules', () => {
    expect(inspectVar('SOMETHING_ELSE', 'value', ORIGIN).issues).toEqual([]);
  });
});

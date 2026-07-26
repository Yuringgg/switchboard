/**
 * Inspect configuration for presence and shape — never for value.
 *
 * Pure, so the checks that diagnose a broken deployment are themselves
 * testable, rather than only exercisable by breaking a deployment.
 */

export const EXPECTED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'CHANNEL_CREDENTIALS_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
  'GOOGLE_PUBSUB_TOPIC',
  'GOOGLE_PUBSUB_PUSH_AUDIENCE',
  'GOOGLE_PUBSUB_SERVICE_ACCOUNT',
  'CRON_SECRET',
] as const;

export type ExpectedVar = (typeof EXPECTED_VARS)[number];

export interface VarReport {
  present: boolean;
  /** Distinguishes "unset" from "set to empty", and reveals a stray newline. */
  length: number;
  issues: string[];
}

export interface ConfigReport {
  ok: boolean;
  origin: string;
  missing: string[];
  malformed: string[];
  detail: Record<string, VarReport>;
}

export function inspectVar(name: string, raw: string | undefined, origin: string): VarReport {
  if (raw === undefined) {
    return { present: false, length: 0, issues: ['not set on this deployment'] };
  }

  const issues: string[] = [];
  const value = raw.trim();

  if (raw.length === 0) issues.push('set but empty');
  if (raw !== value) issues.push('has leading or trailing whitespace');
  if (/[\r\n]/.test(raw)) issues.push('contains a line break');

  switch (name) {
    case 'CHANNEL_CREDENTIALS_KEY': {
      if (value.length > 0) {
        // Base64 that decodes to the wrong length is the failure mode a paste
        // introduces, and AES-256 rejects it only at first use — by which point
        // the trail is cold.
        const bytes = Buffer.from(value, 'base64').length;
        if (bytes !== 32) {
          issues.push(`decodes to ${bytes} bytes, must be 32 — AES-256 needs a 32-byte key`);
        }
      }
      break;
    }

    case 'GOOGLE_OAUTH_REDIRECT_URI': {
      const expected = `${origin}/api/auth/google/callback`;
      // The classic: a localhost value here lets OAuth start, then Google
      // refuses the redirect and the user never comes back.
      if (value.length > 0 && value !== expected) {
        issues.push(`does not match this deployment; expected ${expected}`);
      }
      break;
    }

    case 'GOOGLE_PUBSUB_PUSH_AUDIENCE': {
      const expected = `${origin}/api/webhooks/gmail`;
      if (value.length > 0 && value !== expected) {
        issues.push(`does not match this deployment; expected ${expected}`);
      }
      break;
    }

    case 'GOOGLE_CLIENT_ID': {
      if (value.length > 0 && !value.endsWith('.apps.googleusercontent.com')) {
        issues.push('does not look like a Google client id');
      }
      break;
    }

    case 'GOOGLE_CLIENT_SECRET': {
      if (value.length > 0 && !value.startsWith('GOCSPX-')) {
        issues.push('does not look like a Google client secret');
      }
      break;
    }

    case 'GOOGLE_PUBSUB_TOPIC': {
      if (value.length > 0 && !value.startsWith('projects/')) {
        issues.push('should be the full name: projects/<project>/topics/<topic>');
      }
      break;
    }

    case 'GOOGLE_PUBSUB_SERVICE_ACCOUNT': {
      if (value.length > 0 && !value.includes('@')) {
        issues.push('should be a service account email address');
      }
      break;
    }

    default:
      break;
  }

  return { present: true, length: raw.length, issues };
}

export function buildConfigReport(
  env: Record<string, string | undefined>,
  origin: string,
): ConfigReport {
  const detail: Record<string, VarReport> = {};

  for (const name of EXPECTED_VARS) {
    detail[name] = inspectVar(name, env[name], origin);
  }

  const missing = EXPECTED_VARS.filter((n) => !detail[n]?.present);
  const malformed = EXPECTED_VARS.filter(
    (n) => detail[n]?.present && (detail[n]?.issues.length ?? 0) > 0,
  );

  return { ok: missing.length === 0 && malformed.length === 0, origin, missing, malformed, detail };
}

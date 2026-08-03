/**
 * Inspect configuration for presence and shape — never for value.
 *
 * Pure, so the checks that diagnose a broken deployment are themselves
 * testable, rather than only exercisable by breaking a deployment.
 */

export const EXPECTED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  // Ingest cannot persist without it: a Pub/Sub push has no session for RLS to
  // scope. Server-side only — never prefixed NEXT_PUBLIC_.
  'SUPABASE_SERVICE_ROLE_KEY',
  'CHANNEL_CREDENTIALS_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
  'GOOGLE_PUBSUB_TOPIC',
  'GOOGLE_PUBSUB_PUSH_AUDIENCE',
  'GOOGLE_PUBSUB_SERVICE_ACCOUNT',
  'CRON_SECRET',
] as const;

/**
 * Variables a **feature** needs, which a healthy deployment can legitimately be
 * without.
 *
 * ⚠ Reported in `detail`, listed under `features`, and deliberately **not**
 * counted in the top-level `ok`. WhatsApp being unconfigured is not a broken
 * deployment — it is Phase 2 waiting on a Meta account, and folding it into `ok`
 * would make the one field people glance at read `false` for months. A health
 * check that is always red is a health check nobody reads.
 *
 * ── Why these two are here at all ────────────────────────────────────────────
 *
 * Until 2026-08-03 this file listed neither, so `/api/health/config` — the
 * instrument this project reaches for to answer *"did my change actually
 * deploy?"* — could not answer it for the WhatsApp variables specifically. That
 * matters more here than for most: Vercel binds variables when a deployment is
 * **created**, and the symptom of forgetting to redeploy is a `503 Not
 * configured` from one route while everything else is fine.
 *
 * `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` are absent on purpose —
 * nothing in the deployed app reads them (the id lives in
 * `channels.external_account_id`, the token in `channels.credentials`), and
 * listing a variable here that no code reads is how "set all four on Vercel"
 * survived in the docs for a week.
 */
export const FEATURE_VARS = ['WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET'] as const;

export type ExpectedVar = (typeof EXPECTED_VARS)[number];
export type FeatureVar = (typeof FEATURE_VARS)[number];

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
  /**
   * `FEATURE_VARS`, reported separately so an unconfigured feature never turns
   * `ok` false. `ready` answers one question — will the WhatsApp webhook stop
   * answering 503 on this deployment?
   */
  features: { ready: boolean; missing: string[]; malformed: string[] };
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

  // ⚠ Wrapping quotes.
  //
  // apps/worker/.env quotes some values and dotenv strips them, so copying a
  // line out of that file carries the quotes along. Vercel's dashboard does NOT
  // strip them: the value becomes literally `"sb_secret_…"`, and the resulting
  // failure reads as a rejected key rather than a malformed one — you go
  // looking for a rotation problem that does not exist.
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      issues.push('is wrapped in quotes — paste the value without them');
    }
  }

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

    case 'SUPABASE_SERVICE_ROLE_KEY': {
      // Both formats are valid: `sb_secret_…` (current) and a JWT (legacy).
      // What is NOT valid is the publishable key pasted here by mistake, which
      // would make ingest fail with a permission error rather than a config one.
      if (value.length > 0) {
        if (value.startsWith('sb_publishable_')) {
          issues.push('this is the PUBLISHABLE key, not the service role key');
        } else if (!value.startsWith('sb_secret_') && !value.startsWith('eyJ')) {
          issues.push('does not look like a Supabase service role key');
        }
      }
      break;
    }

    case 'GOOGLE_PUBSUB_SERVICE_ACCOUNT': {
      if (value.length > 0 && !value.includes('@')) {
        issues.push('should be a service account email address');
      }
      break;
    }

    /*
     * ⚠ The App Secret is NOT the access token, and this is the single most
     * expensive mistake available in the WhatsApp setup.
     *
     * Both are copied from the same dashboard minutes apart. Paste the token
     * here and the HMAC never matches, so **every** webhook 401s — which reads
     * as "Meta is broken" or "the signature code is wrong", not as one field
     * holding the other field's value. The only trace is one log line,
     * `rejected: bad or missing signature`, in Vercel's runtime logs.
     *
     * ⚠ The check is on LENGTH, not on format, and that is deliberate. Meta's
     * App Secret is short and its access tokens are long — a token is hundreds
     * of characters. Asserting the App Secret's exact character set would mean
     * writing down a format nobody here has ever seen, which is precisely the
     * habit `AGENTS.md` §5 keeps catching. Length is a property of the mistake
     * that can be stated without inventing anything.
     */
    case 'WHATSAPP_APP_SECRET': {
      if (value.length > 100) {
        issues.push(
          `is ${value.length} characters — far too long for an App Secret. ` +
            'This is almost certainly the ACCESS TOKEN. App settings → Basic → App Secret.',
        );
      }
      break;
    }

    /*
     * Invented by us, compared byte for byte against what Meta echoes back. Any
     * value works, so there is nothing to validate except that a real one is
     * there — a two-character token would verify perfectly and be worthless.
     */
    case 'WHATSAPP_WEBHOOK_VERIFY_TOKEN': {
      if (value.length > 0 && value.length < 16) {
        issues.push(`is only ${value.length} characters — use a long random string`);
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

  for (const name of [...EXPECTED_VARS, ...FEATURE_VARS]) {
    detail[name] = inspectVar(name, env[name], origin);
  }

  const faulty = (names: readonly string[]) => ({
    missing: names.filter((n) => !detail[n]?.present),
    malformed: names.filter((n) => detail[n]?.present && (detail[n]?.issues.length ?? 0) > 0),
  });

  const core = faulty(EXPECTED_VARS);
  const features = faulty(FEATURE_VARS);

  return {
    ok: core.missing.length === 0 && core.malformed.length === 0,
    origin,
    ...core,
    features: {
      ready: features.missing.length === 0 && features.malformed.length === 0,
      ...features,
    },
    detail,
  };
}

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signature verification.
 *
 * Lives in core rather than in the route because it is security-critical and
 * therefore has to be testable without spinning up a Next request — and because
 * the WhatsApp adapter needs the same function.
 */

/**
 * Constant-time string comparison.
 *
 * `===` short-circuits at the first differing byte, so how long it takes leaks
 * how much of the secret you guessed correctly. That is enough to recover a
 * signature one byte at a time.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, and the throw is itself a
  // timing signal, so lengths are checked separately and first.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify Meta's `X-Hub-Signature-256` header: `sha256=<hex>`, HMAC-SHA256 over
 * the **raw request body**, keyed with the app secret.
 *
 * ⚠ `rawBody` must be the exact bytes received. A `JSON.parse` →
 * `JSON.stringify` round trip reorders keys and drops whitespace, and the
 * resulting digest will never match. Read the body as text, verify, and only
 * then parse.
 */
export function verifyHubSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;

  const digest = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  return safeEqual(signatureHeader, `sha256=${digest}`);
}

/**
 * ── Who signs the webhook, and how ───────────────────────────────────────────
 *
 * Meta's Cloud API is not the only thing that can deliver a Cloud-API payload.
 * A Business Solution Provider — 360dialog, verified 2026-08-04 against their
 * own webhook reference — forwards Meta's envelope **verbatim**: same `object`,
 * `entry[]`, `changes[]`, `value.metadata.phone_number_id`, `wamid`, and
 * string-seconds `timestamp`. So `parseWebhookPayload` and all 13 fixtures hold
 * unchanged, and the *only* thing that differs is the signature: a different
 * header name, a different secret, and no `sha256=` prefix.
 *
 * ⚠ This exists so the provider is CONFIGURATION, not a second code path.
 * Hardcoding `x-hub-signature-256` meant "support a BSP" read as "fork the
 * route", and a forked verification path is exactly where a fail-open creeps
 * in — the branch nobody exercises is the branch that stops checking.
 *
 * ⚠⚠ It must stay impossible to express "do not verify". There is no `none`
 * scheme and no nullable secret: a caller with nothing configured gets no
 * `SigningScheme` at all, and the route answers 503. Unset config must never
 * mean skip.
 */
export interface SigningScheme {
  /**
   * How the header proves the caller is genuine.
   *
   * `hmac` — the header carries HMAC-SHA256 of the raw body. Proves the sender
   * holds the secret **and** that the body was not altered.
   *
   * `shared-token` — the header carries the secret itself, compared
   * timing-safely. Proves the sender holds the secret and **nothing about the
   * body**. ⚠ Strictly weaker, and it exists only because a provider may offer
   * nothing better: 360dialog's sandbox issues an API key and no signing
   * secret, but its webhook config accepts **custom headers**, so a 256-bit
   * random token registered there is the strongest control actually available.
   * Over HTTPS the token is not observable in transit. It is still not HMAC,
   * and this comment is here so nobody later mistakes it for equivalent.
   */
  kind: 'hmac' | 'shared-token';
  /** Lowercase header carrying the digest or token. */
  header: string;
  /** HMAC key, or the expected token value. */
  secret: string;
  /** Literal prefix on the header value — `sha256=` for Meta, empty otherwise. */
  prefix: string;
  /** Name for logs. Never the secret, never a digest. */
  label: string;
}

/**
 * Verify an HMAC-SHA256-over-raw-body signature under any of the schemes above.
 *
 * ── ⚠ Why both hex and base64 are accepted ───────────────────────────────────
 *
 * Meta documents its encoding: `sha256=` followed by lowercase hex, and that is
 * what `verifyHubSignature` has always asserted. **360dialog does not publish
 * theirs.** Their docs name the header — *"signed exactly like your normal
 * message callbacks — with the `x-360dialog-signature` header"* — and their
 * partner documentation describes HMAC-SHA256 over the raw body, but neither
 * states hex versus base64.
 *
 * Guessing would produce a route that 401s every real delivery and reads as a
 * wrong secret. So rather than encode a guess, both encodings of *the same
 * digest* are compared.
 *
 * **This does not weaken the check.** Both candidates are derived from one HMAC
 * of the exact bytes received, keyed with a secret the caller must already
 * possess. Accepting two renderings of a value you cannot forge adds no
 * forgeries — an attacker's difficulty is unchanged, because it was never the
 * encoding that stopped them. What it removes is a documentation guess sitting
 * on the security path.
 *
 * ⚠ Once a real 360dialog delivery has been observed, narrow this to the
 * encoding actually sent and delete the other branch. An accepted-but-unused
 * comparison is dead code on a security path, and dead code there rots quietly.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  scheme: SigningScheme,
): boolean {
  if (!signatureHeader || !scheme.secret) return false;

  /*
   * The token is the secret itself, so there is nothing to derive — but the
   * comparison must still be timing-safe, and for exactly the reason
   * `safeEqual` exists: `===` would leak the token one byte at a time, and
   * unlike an HMAC digest this value does not change per request, so an
   * attacker gets unlimited attempts at the same target.
   */
  if (scheme.kind === 'shared-token') {
    return safeEqual(signatureHeader, `${scheme.prefix}${scheme.secret}`);
  }

  const mac = createHmac('sha256', scheme.secret).update(rawBody, 'utf8');
  const digest = mac.digest();

  // ⚠ Both comparisons always run. Returning early on the hex match would make
  // the time taken reveal which encoding arrived, and `safeEqual` exists
  // precisely so this path leaks nothing.
  const hexMatch = safeEqual(signatureHeader, `${scheme.prefix}${digest.toString('hex')}`);
  const b64Match = safeEqual(signatureHeader, `${scheme.prefix}${digest.toString('base64')}`);

  return hexMatch || b64Match;
}

/**
 * Decide which scheme this deployment is running under, from the environment.
 *
 * ⚠⚠ **The order is strongest-first, and that is the rule, not an accident.**
 *
 *   1. `WHATSAPP_APP_SECRET`        Meta      HMAC          strongest
 *   2. `WHATSAPP_BSP_WEBHOOK_SECRET` 360dialog HMAC
 *   3. `WHATSAPP_BSP_SHARED_TOKEN`   360dialog shared token  weakest
 *
 * So **adding a weaker credential can never downgrade a deployment.** Leaving a
 * shared token set while a real Meta App Secret arrives is harmless — Meta
 * wins, and the BSP path becomes unreachable without anyone remembering to
 * clean up. The failure this prevents is the quiet one: a forgotten fallback
 * silently becoming the live scheme because it happened to be checked first.
 *
 * Meta therefore stays the default. If a developer account ever comes through,
 * setting one variable restores exactly the behaviour this route has had since
 * Phase 2.
 *
 * Returns `null` when nothing is configured — the caller must then refuse the
 * request. It cannot return a scheme that skips verification, by construction.
 */
export interface SigningEnv {
  readonly WHATSAPP_APP_SECRET?: string | undefined;
  readonly WHATSAPP_BSP_WEBHOOK_SECRET?: string | undefined;
  readonly WHATSAPP_BSP_SHARED_TOKEN?: string | undefined;
  /**
   * ⚠ The index signature is load-bearing, not laziness. Without it TypeScript
   * applies weak-type detection — every declared property is optional, so a
   * `process.env` sharing none of them is rejected outright with *"has no
   * properties in common"*, which reads as the wrong argument rather than a
   * variance rule. The named keys above stay so the contract is still readable.
   */
  readonly [key: string]: string | undefined;
}

export function resolveSigningScheme(env: SigningEnv): SigningScheme | null {
  if (env.WHATSAPP_APP_SECRET) {
    return {
      kind: 'hmac',
      header: 'x-hub-signature-256',
      secret: env.WHATSAPP_APP_SECRET,
      prefix: 'sha256=',
      label: 'meta',
    };
  }

  if (env.WHATSAPP_BSP_WEBHOOK_SECRET) {
    return {
      kind: 'hmac',
      header: 'x-360dialog-signature',
      secret: env.WHATSAPP_BSP_WEBHOOK_SECRET,
      prefix: '',
      label: '360dialog-hmac',
    };
  }

  if (env.WHATSAPP_BSP_SHARED_TOKEN) {
    /*
     * The header name is ours, not theirs: 360dialog's webhook config takes an
     * arbitrary `headers` object and replays it on every delivery, so this is a
     * token we chose, registered with them, and expect back. Verified against
     * the live sandbox 2026-08-04 — the config endpoint echoed it.
     */
    return {
      kind: 'shared-token',
      header: 'x-switchboard-webhook-token',
      secret: env.WHATSAPP_BSP_SHARED_TOKEN,
      prefix: '',
      label: '360dialog-token',
    };
  }

  return null;
}

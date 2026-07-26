import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Encryption for `channels.credentials` — Gmail refresh tokens and WhatsApp
 * access tokens. docs/02-ARCHITECTURE.md §6.
 *
 * A refresh token is a long-lived key to someone's entire inbox. Anyone who can
 * read the database row must not be able to read the token, which includes
 * anyone with the `service_role` key, a database backup, or a log line.
 *
 * ⚠ Server-side only. Never import this into a client component — the key must
 * not reach a browser bundle.
 */

/** AES-256-GCM. GCM's 96-bit IV is the spec-recommended size, not an arbitrary choice. */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

function parseKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_BYTES) {
    // Deliberately does not echo the key or its contents.
    throw new Error(
      `CHANNEL_CREDENTIALS_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

/**
 * Encrypt a credential for storage.
 *
 * Layout: `iv (12) || authTag (16) || ciphertext`. Self-contained, so the column
 * needs no companion fields and a row can never be half-migrated.
 *
 * A fresh random IV per call is mandatory — reusing an IV under the same key in
 * GCM is catastrophic, not merely weak: it leaks the XOR of the plaintexts and
 * can expose the authentication subkey.
 */
export function encryptSecret(plaintext: string, keyBase64: string): Buffer {
  const key = parseKey(keyBase64);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * Decrypt a stored credential.
 *
 * Throws if the ciphertext, IV or auth tag has been altered — GCM authenticates
 * as well as encrypts, so a tampered row fails loudly instead of yielding
 * plausible garbage that gets sent to Google as a token.
 */
export function decryptSecret(payload: Buffer, keyBase64: string): string {
  const key = parseKey(keyBase64);

  // Strictly less-than: a payload of exactly IV + tag is the valid encryption
  // of an empty string, not a truncated one. `<=` here rejected a well-formed
  // ciphertext and blamed it for being corrupt.
  //
  // Whether an empty credential is *acceptable* is a question for the caller;
  // this function's job is to decrypt faithfully, including to ''.
  if (payload.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error('Encrypted credential is truncated.');
  }

  const iv = payload.subarray(0, IV_BYTES);
  const authTag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // `final()` is what verifies the tag; it throws on any tampering.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Whether two credentials are identical, without leaking how much of one
 * matches the other through timing.
 */
export function secretsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

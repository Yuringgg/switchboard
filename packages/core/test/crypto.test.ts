import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, secretsEqual } from '../src/crypto';

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

// Shaped like the thing this actually protects.
const REFRESH_TOKEN = '1//0gFakeRefreshToken-abcdefghijklmnop_qrstuvwxyz0123456789';

/** Corrupt one byte. `buf[i] ^= x` trips noUncheckedIndexedAccess. */
function flipByte(buf: Buffer, index: number): Buffer {
  buf.writeUInt8(buf.readUInt8(index) ^ 0xff, index);
  return buf;
}

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a credential', () => {
    expect(decryptSecret(encryptSecret(REFRESH_TOKEN, KEY), KEY)).toBe(REFRESH_TOKEN);
  });

  it('never stores the plaintext in the output', () => {
    // The failure this guards against is an "encrypt" that silently no-ops.
    const encrypted = encryptSecret(REFRESH_TOKEN, KEY);
    expect(encrypted.toString('utf8')).not.toContain(REFRESH_TOKEN);
    expect(encrypted.toString('base64')).not.toContain(
      Buffer.from(REFRESH_TOKEN).toString('base64'),
    );
  });

  it('produces different ciphertext each time for the same input', () => {
    // A fresh IV per call. Identical output would mean a fixed IV, which under
    // GCM leaks the XOR of plaintexts and can expose the auth subkey.
    const a = encryptSecret(REFRESH_TOKEN, KEY);
    const b = encryptSecret(REFRESH_TOKEN, KEY);
    expect(a.equals(b)).toBe(false);
    expect(decryptSecret(a, KEY)).toBe(decryptSecret(b, KEY));
  });

  it('refuses to decrypt with the wrong key', () => {
    expect(() => decryptSecret(encryptSecret(REFRESH_TOKEN, KEY), OTHER_KEY)).toThrow();
  });

  it('detects a tampered ciphertext rather than returning garbage', () => {
    const encrypted = encryptSecret(REFRESH_TOKEN, KEY);
    flipByte(encrypted, encrypted.length - 1);
    // GCM authenticates. Without the tag check this would return plausible
    // nonsense that gets sent to Google as a token.
    expect(() => decryptSecret(encrypted, KEY)).toThrow();
  });

  it('detects a tampered IV', () => {
    const encrypted = encryptSecret(REFRESH_TOKEN, KEY);
    flipByte(encrypted, 0);
    expect(() => decryptSecret(encrypted, KEY)).toThrow();
  });

  it('detects a tampered auth tag', () => {
    const encrypted = encryptSecret(REFRESH_TOKEN, KEY);
    flipByte(encrypted, 12); // first byte of the tag
    expect(() => decryptSecret(encrypted, KEY)).toThrow();
  });

  it('rejects a truncated payload instead of reading out of bounds', () => {
    expect(() => decryptSecret(Buffer.alloc(0), KEY)).toThrow(/truncated/);
    expect(() => decryptSecret(Buffer.alloc(20), KEY)).toThrow(/truncated/);
    // IV + tag exactly is NOT truncated — it is a valid empty plaintext.
    expect(decryptSecret(encryptSecret('', KEY), KEY)).toBe('');
  });

  it('rejects a key of the wrong length, naming the problem', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => encryptSecret(REFRESH_TOKEN, short)).toThrow(/must decode to 32 bytes/);
    expect(() => encryptSecret(REFRESH_TOKEN, '')).toThrow(/must decode to 32 bytes/);
  });

  it('handles empty and unicode payloads', () => {
    expect(decryptSecret(encryptSecret('', KEY), KEY)).toBe('');
    const unicode = 'token-ñ-日本語-🔑';
    expect(decryptSecret(encryptSecret(unicode, KEY), KEY)).toBe(unicode);
  });
});

describe('secretsEqual', () => {
  it('matches identical secrets', () => {
    expect(secretsEqual(REFRESH_TOKEN, REFRESH_TOKEN)).toBe(true);
  });

  it('rejects different secrets of equal length', () => {
    expect(secretsEqual('abcdef', 'abcdeg')).toBe(false);
  });

  it('rejects different lengths without throwing', () => {
    expect(() => secretsEqual('short', 'much longer value')).not.toThrow();
    expect(secretsEqual('short', 'much longer value')).toBe(false);
  });
});

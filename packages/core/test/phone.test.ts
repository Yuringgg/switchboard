import { describe, expect, it } from 'vitest';

import { digitsOnly, samePhoneNumber } from '../src/phone';

describe('digitsOnly', () => {
  it('strips punctuation, spaces and the plus', () => {
    expect(digitsOnly('+1 (555) 078-3881')).toBe('15550783881');
    expect(digitsOnly('+63 917 000 0001')).toBe('639170000001');
  });

  it('is a no-op on the bare form WhatsApp actually sends', () => {
    expect(digitsOnly('639170000001')).toBe('639170000001');
  });

  it('handles absent input without throwing', () => {
    expect(digitsOnly(null)).toBe('');
    expect(digitsOnly(undefined)).toBe('');
    expect(digitsOnly('')).toBe('');
  });
});

describe('samePhoneNumber', () => {
  it('matches the same number written two ways', () => {
    /*
     * This is the real case: a single WhatsApp payload reports the business
     * number as `display_phone_number` and the sender as bare digits in
     * `from`. If those are compared with ===, every inbound client message is
     * marked outbound and the whole timeline renders as "You" — which makes
     * the product's central claim false on every row.
     */
    expect(samePhoneNumber('+1 (555) 078-3881', '15550783881')).toBe(true);
    expect(samePhoneNumber('15550783881', '+1-555-078-3881')).toBe(true);
  });

  it('distinguishes different numbers', () => {
    expect(samePhoneNumber('639170000001', '639170000002')).toBe(false);
  });

  it('never matches when either side is empty', () => {
    // An absent display_phone_number must not make an arbitrary sender look
    // like the business itself.
    expect(samePhoneNumber('', '')).toBe(false);
    expect(samePhoneNumber(null, undefined)).toBe(false);
    expect(samePhoneNumber('639170000001', '')).toBe(false);
    expect(samePhoneNumber('', '639170000001')).toBe(false);
  });

  it('does not guess at numbering plans', () => {
    // Deliberately crude: both sides come from the same provider describing
    // E.164 numbers, so the only thing to erase is punctuation. Stripping a
    // leading zero or inferring a country code would make claims this system
    // has no basis for.
    expect(samePhoneNumber('09170000001', '639170000001')).toBe(false);
  });
});

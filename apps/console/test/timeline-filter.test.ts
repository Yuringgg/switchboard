import { describe, expect, it } from 'vitest';

// Relative, not the `@/` alias: the root vitest config has no path mapping, so
// an aliased import here fails to resolve while typechecking perfectly.
import { parseChannelFilter } from '../src/lib/timeline';

/**
 * The timeline's channel filter (Ms. Maria, 2026-08-05).
 *
 * ⚠ Every case here fails by showing the WRONG MESSAGES rather than by
 * erroring, which is the only reason it is worth a test file. A filter that
 * quietly widens is a console that claims to be showing one line and is showing
 * both; a filter that quietly narrows is mail you have received and cannot see.
 */

const KNOWN = ['gmail', 'whatsapp'] as const;

describe('parseChannelFilter', () => {
  it('treats a missing parameter as no filter', () => {
    expect(parseChannelFilter(undefined, KNOWN)).toEqual([]);
  });

  it('accepts a single value and a repeated one', () => {
    // `?channel=gmail` arrives as a string; `?channel=gmail&channel=whatsapp`
    // arrives as an array. Next does not normalise this.
    expect(parseChannelFilter('gmail', KNOWN)).toEqual(['gmail']);
    expect(parseChannelFilter(['whatsapp'], KNOWN)).toEqual(['whatsapp']);
  });

  it('collapses "every line" back to no filter', () => {
    /*
     * Selecting both is the same view as selecting neither, and normalising it
     * here is what keeps the Clear control and the "is a filter active?" flag
     * agreeing with each other. Without it the console shows a "Show both"
     * button next to a filter that is already showing both.
     */
    expect(parseChannelFilter(['gmail', 'whatsapp'], KNOWN)).toEqual([]);
  });

  it('drops an unknown channel rather than passing it through', () => {
    /*
     * ⚠ This comes off the query string, so it is user input. An unrecognised
     * value reaching the query resolves to no channel ids and returns nothing —
     * which on this screen reads as "you have no mail", not as "that link had a
     * typo in it".
     */
    expect(parseChannelFilter('telegram', KNOWN)).toEqual([]);
    expect(parseChannelFilter(['gmail', 'telegram'], KNOWN)).toEqual(['gmail']);
  });

  it('de-duplicates a repeated value', () => {
    // `?channel=gmail&channel=gmail` must not count as "both lines selected"
    // and collapse to no filter via the length check above.
    expect(parseChannelFilter(['gmail', 'gmail'], KNOWN)).toEqual(['gmail']);
  });

  it('treats an empty string as no filter', () => {
    expect(parseChannelFilter('', KNOWN)).toEqual([]);
  });
});

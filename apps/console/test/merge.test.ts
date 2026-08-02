import { describe, expect, it } from 'vitest';

import { suggestMerges } from '../src/lib/merge';

/**
 * The merge suggestion heuristic (Q3).
 *
 * ⚠ Q3 is explicit about the failure this must not have: *"Same display name
 * across channels is weak evidence — two different Marias exist. Auto-merging
 * wrong contacts corrupts data in a way that's tedious to unwind."*
 *
 * So the property under test is not "does it find matches" — it is **does it
 * stay quiet when it should**. A suggestion list that offers everyone trains
 * people to click through it, and then the manual gate Q3 chose is decorative.
 */

const subject = { id: 'a', displayName: 'Maria Santos' };

describe('suggestMerges', () => {
  it('offers an exact name match', () => {
    const out = suggestMerges(subject, [{ id: 'b', displayName: 'maria santos' }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe('same name');
  });

  it('does NOT offer two different people who share a first name', () => {
    /*
     * ⚠ The case Q3 names by hand. "Maria Santos" and "Maria dela Cruz" are two
     * people, and merging them puts one client's messages under another's name.
     */
    const out = suggestMerges(subject, [{ id: 'b', displayName: 'Maria dela Cruz' }]);
    expect(out).toHaveLength(0);
  });

  it('offers an abbreviated surname', () => {
    // "Maria S." is worth offering — it is the same surname, shortened.
    const out = suggestMerges(subject, [{ id: 'b', displayName: 'Maria S.' }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toContain('surname');
  });

  it('never suggests on a handle, in either direction', () => {
    /*
     * Matching handles is meaningless: "+63 917 000 0001" and "+63 917 000
     * 0002" share nothing that identifies a person, and two addresses at one
     * company share a domain, not a human. This corpus is full of both.
     */
    expect(suggestMerges(subject, [{ id: 'b', displayName: 'maria@iozera.com' }])).toHaveLength(0);
    expect(
      suggestMerges({ id: 'a', displayName: '+63 917 000 0001' }, [
        { id: 'b', displayName: '+63 917 000 0002' },
      ]),
    ).toHaveLength(0);
    expect(
      suggestMerges({ id: 'a', displayName: 'ar@vendor.example' }, [
        { id: 'b', displayName: 'ap@vendor.example' },
      ]),
    ).toHaveLength(0);
  });

  it('never suggests the contact itself', () => {
    // The select would offer a merge into itself, which the action rejects —
    // but a suggestion chip for it reads as a bug.
    expect(suggestMerges(subject, [{ id: 'a', displayName: 'Maria Santos' }])).toHaveLength(0);
  });

  it('puts exact matches above partial ones', () => {
    const out = suggestMerges(subject, [
      { id: 'b', displayName: 'Maria S.' },
      { id: 'c', displayName: 'Maria Santos' },
    ]);
    expect(out.map((s) => s.id)).toEqual(['c', 'b']);
  });

  it('is bounded, so the panel cannot become a second contact list', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `x${i}`,
      displayName: 'Maria Santos',
    }));
    expect(suggestMerges(subject, many).length).toBeLessThanOrEqual(5);
  });

  it('ignores case and extra whitespace', () => {
    const out = suggestMerges(subject, [{ id: 'b', displayName: '  MARIA   SANTOS ' }]);
    expect(out).toHaveLength(1);
  });
});

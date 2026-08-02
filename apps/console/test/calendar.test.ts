import { describe, expect, it } from 'vitest';

import { eventIdFor } from '../src/lib/google/calendar';
import { manilaInputToRfc3339, toManilaInput } from '../src/lib/manila';

/**
 * The two pure things standing between a proposal and a real Google Calendar
 * (US-7b, ADR-010).
 *
 * ⚠ This is the only place Switchboard writes to the outside world, and both of
 * these fail *silently* when wrong: a bad event id duplicates a real event, and
 * a bad offset puts a real meeting eight hours from where the user approved it.
 * Neither raises anything.
 */

describe('eventIdFor', () => {
  const ID = '4403f0e3-f841-494d-85bf-f0d57e8c0872';

  it('produces an id Google will accept', () => {
    /*
     * Google's rules, read from the events.insert reference rather than
     * assumed: the characters allowed are those of base32hex — **lowercase
     * a-v and digits 0-9** — and the length must be between 5 and 1024.
     *
     * A hex UUID is entirely inside that set (f is well below v), and "sb" is
     * too. An id outside it is rejected with a 400 whose message does not
     * mention the character set.
     */
    const id = eventIdFor(ID);
    expect(id).toMatch(/^[a-v0-9]+$/);
    expect(id.length).toBeGreaterThanOrEqual(5);
    expect(id.length).toBeLessThanOrEqual(1024);
  });

  it('is deterministic — the same proposal always yields the same id', () => {
    /*
     * ⚠⚠ The property the whole second-line-of-defence rests on.
     *
     * `calendar_event_id` is the primary guard, but it has a real gap: the
     * window between a successful insert and the database write recording it.
     * A crash there leaves an event with nothing pointing at it, so the next
     * Confirm sees null and creates a TWIN. A deterministic id turns that into
     * a 409 `duplicate`, which the caller adopts.
     *
     * Anything random here — a nonce, a timestamp — reopens that window.
     */
    expect(eventIdFor(ID)).toBe(eventIdFor(ID));
  });

  it('gives different proposals different ids', () => {
    expect(eventIdFor(ID)).not.toBe(eventIdFor('cb49b2f5-b2b6-4424-b952-93a08e72fa3a'));
  });

  it('strips the dashes a UUID carries', () => {
    // '-' is not in base32hex. Left in, every insert 400s.
    expect(eventIdFor(ID)).not.toContain('-');
  });

  it('normalises case, because base32hex is lowercase only', () => {
    expect(eventIdFor(ID.toUpperCase())).toBe(eventIdFor(ID));
  });
});

describe('manilaInputToRfc3339', () => {
  it('appends the Manila offset', () => {
    /*
     * ⚠ Not optional. Without it Google interprets the value in the CALENDAR'S
     * timezone — a setting on the user's Google account this code cannot see.
     * A machine set to UTC would put every confirmed meeting eight hours out,
     * silently and consistently.
     */
    expect(manilaInputToRfc3339('2026-08-07T15:00')).toBe('2026-08-07T15:00:00+08:00');
  });

  it('rejects anything that is not the input format', () => {
    for (const bad of ['', 'tomorrow', '2026-08-07', '07/08/2026 15:00', '2026-08-07T15']) {
      expect(manilaInputToRfc3339(bad)).toBeNull();
    }
  });

  it('rejects a date that matches the shape but does not exist', () => {
    /*
     * ⚠ `new Date('2026-02-30T10:00:00+08:00')` does NOT produce NaN in V8 — it
     * rolls over to 2 March. So the pattern check passes, the parse check
     * passes, and a meeting quietly lands two days from where it was typed.
     * The round-trip comparison is what catches it.
     */
    expect(manilaInputToRfc3339('2026-02-30T10:00')).toBeNull();
    expect(manilaInputToRfc3339('2026-13-01T10:00')).toBeNull();
  });

  it('round-trips with toManilaInput', () => {
    // These two are inverses and they are the pair that has to agree. If they
    // drift, the user approves one time and a different one is created.
    const local = '2026-08-07T15:00';
    const rfc = manilaInputToRfc3339(local)!;
    expect(toManilaInput(new Date(rfc).toISOString())).toBe(local);
  });
});

describe('toManilaInput', () => {
  it('renders a stored instant in Manila, not UTC', () => {
    // 07:00Z is 15:00 in Manila. Pre-filling the form with 07:00 is the bug
    // this exists to prevent — and it is invisible unless the user notices.
    expect(toManilaInput('2026-08-07T07:00:00.000Z')).toBe('2026-08-07T15:00');
  });

  it('adds the default duration for the end field', () => {
    expect(toManilaInput('2026-08-07T07:00:00.000Z', 60)).toBe('2026-08-07T16:00');
  });

  it('carries an offset across a day boundary', () => {
    // 20:00Z on the 6th is 04:00 on the 7th in Manila. An implementation that
    // shifted only the clock and not the date would read 2026-08-06T04:00.
    expect(toManilaInput('2026-08-06T20:00:00.000Z')).toBe('2026-08-07T04:00');
  });
});

import { describe, expect, it } from 'vitest';

import { NAV_ITEMS, navHrefFor } from '../src/lib/nav';

describe('navHrefFor — which rail entry a path lights', () => {
  it('lights each entry on its own page', () => {
    for (const item of NAV_ITEMS) {
      expect(navHrefFor(item.href)).toBe(item.href);
    }
  });

  it('lights the list a record was opened from', () => {
    expect(navHrefFor('/messages/9b1f')).toBe('/');
    expect(navHrefFor('/contacts/4c2e')).toBe('/contacts');
  });

  it('falls back to Timeline for a page that is not in the nav', () => {
    expect(navHrefFor('/voice-lab')).toBe('/');
  });

  it('does not light Search for a path that merely starts with the same letters', () => {
    expect(navHrefFor('/searching')).toBe('/');
  });
});

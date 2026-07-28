import { describe, expect, it } from 'vitest';

import {
  isTheme,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  THEMES,
} from '../src/lib/theme';

describe('isTheme', () => {
  it('accepts the three real states', () => {
    for (const theme of THEMES) expect(isTheme(theme)).toBe(true);
  });

  it('rejects anything else', () => {
    // This guards a value read straight out of localStorage, which any other
    // script on the origin can write to. A stale or hand-edited entry must
    // fall back to 'system', not be trusted into the DOM.
    for (const value of ['', 'Dark', 'auto', null, undefined, 0, {}, []]) {
      expect(isTheme(value)).toBe(false);
    }
  });
});

/**
 * The init script is a hand-written string that runs before React exists, so
 * nothing else typechecks it. These are the properties that make it correct.
 */
describe('THEME_INIT_SCRIPT', () => {
  it('reads the same storage key the store writes', () => {
    // The script cannot import the constant — it is serialized into HTML — so
    // the two could drift into reading and writing different keys, which
    // presents as "my theme resets on every reload".
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it('falls back to the OS preference when nothing is stored', () => {
    expect(THEME_INIT_SCRIPT).toContain('prefers-color-scheme: dark');
  });

  it('sets color-scheme as well as the class', () => {
    // Without it the browser keeps painting its own surfaces light — most
    // visibly a white scrollbar down the console's one scrolling column.
    expect(THEME_INIT_SCRIPT).toContain('colorScheme');
  });

  it('cannot throw', () => {
    // localStorage access throws outright in a partitioned or cookie-blocked
    // context. This script blocks the first paint, so an exception here is a
    // blank page rather than a missing preference.
    expect(THEME_INIT_SCRIPT).toContain('try{');
    expect(THEME_INIT_SCRIPT).toContain('catch');
  });

  it('is a self-contained IIFE that leaks no globals', () => {
    expect(THEME_INIT_SCRIPT.startsWith('(function(){')).toBe(true);
    expect(THEME_INIT_SCRIPT.trimEnd().endsWith('})()')).toBe(true);
  });

  it('actually resolves each stored value correctly when run', () => {
    // Executed for real against stubbed globals, rather than pattern-matched:
    // the point of this script is behaviour before hydration, and a regex
    // cannot tell whether the boolean logic is right.
    const run = (stored: string | null, osDark: boolean) => {
      const classes = new Set<string>();
      const element = {
        classList: {
          toggle: (name: string, on: boolean) =>
            on ? classes.add(name) : classes.delete(name),
        },
        style: { colorScheme: '' },
      };

      new Function(
        'localStorage',
        'matchMedia',
        'document',
        THEME_INIT_SCRIPT,
      )(
        { getItem: () => stored },
        () => ({ matches: osDark }),
        { documentElement: element },
      );

      return { dark: classes.has('dark'), colorScheme: element.style.colorScheme };
    };

    // An explicit choice wins over the OS. This is the whole reason the tokens
    // moved off a media query onto a class.
    expect(run('dark', false)).toEqual({ dark: true, colorScheme: 'dark' });
    expect(run('light', true)).toEqual({ dark: false, colorScheme: 'light' });

    expect(run('system', true)).toEqual({ dark: true, colorScheme: 'dark' });
    expect(run('system', false)).toEqual({ dark: false, colorScheme: 'light' });

    /*
     * Nothing stored, and a junk value, must BOTH follow the OS — because
     * `readStored()` maps an unrecognised value to 'system', and if the script
     * disagreed the page would paint light while the control showed "System"
     * selected against an OS asking for dark. The key is writable by any script
     * on the origin, so "unrecognised" is a real state, not a hypothetical.
     */
    expect(run(null, true)).toEqual({ dark: true, colorScheme: 'dark' });
    expect(run('nonsense', true)).toEqual({ dark: true, colorScheme: 'dark' });
    expect(run('nonsense', false)).toEqual({ dark: false, colorScheme: 'light' });
  });
});

/**
 * Theme preference — the store, and the only thing that writes it.
 *
 * ── Three states, not two ────────────────────────────────────────────────────
 *
 * "System" is a real choice and it is the default, because following the OS is
 * what this console did before there was a control and it is right most of the
 * time — a machine that dims at sunset should dim this too. A two-state toggle
 * would quietly delete that behaviour the first time anyone touched it, with
 * no way back.
 *
 * ── Why the class strategy ───────────────────────────────────────────────────
 *
 * The tokens used to switch inside `@media (prefers-color-scheme: dark)`, which
 * cannot be overridden from JavaScript — a media query is not a preference, it
 * is a fact about the device. So `globals.css` now switches on a `.dark` class
 * on <html>. That is also shadcn's convention, so `pnpm dlx shadcn@latest add
 * <component>` keeps working and any `dark:` utility it ships resolves.
 *
 * ── Why a store rather than component state ──────────────────────────────────
 *
 * The control renders TWICE — once in the sidebar footer for desktop, once in
 * the header cluster for mobile, since the desktop footer is `hidden` on a
 * phone. With `useState` in each, changing one left the other showing a stale
 * selection, which surfaces the moment a window is resized across the
 * breakpoint. One module-level value, many subscribers.
 *
 * It also makes cross-tab sync fall out for free: the `storage` event fires in
 * every *other* tab, so a console open twice does not disagree with itself.
 */

export const THEME_STORAGE_KEY = 'switchboard-theme';

export type Theme = 'light' | 'dark' | 'system';

export const THEMES: Theme[] = ['light', 'dark', 'system'];

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Applies a resolved preference to the document. */
export function applyTheme(theme: Theme) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.classList.toggle('dark', dark);

  /*
   * Not cosmetic: `color-scheme` is what tells the browser to render its OWN
   * surfaces — scrollbars, the caret, form controls, the space behind an
   * over-scroll — in the matching mode. Without it a dark console keeps a
   * bright white scrollbar down its one scrolling column, which is the most
   * visible thing on the screen.
   */
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

// ── Store ───────────────────────────────────────────────────────────────────

type Listener = () => void;

const listeners = new Set<Listener>();
let current: Theme | null = null;
let wired = false;

function readStored(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : 'system';
  } catch {
    // Storage throws outright in a partitioned or cookie-blocked context.
    return 'system';
  }
}

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Registered once, not per subscriber.
 *
 * The media listener is what keeps "system" honest: the OS can change under us
 * at sunset or from another window, and without it the console holds whatever
 * it resolved at load while still claiming to follow the system.
 */
function wire() {
  if (wired) return;
  wired = true;

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system');
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    current = readStored();
    applyTheme(current);
    emit();
  });
}

export function getTheme(): Theme {
  if (current === null) current = readStored();
  return current;
}

/**
 * What `useSyncExternalStore` renders on the server and during hydration.
 *
 * It must be a constant: the server cannot read `localStorage`, so any other
 * answer is a guess, and a wrong guess is a hydration mismatch. React renders
 * this, then immediately reconciles against the real client value — so the
 * highlight lands a frame late while nothing moves.
 *
 * The COLOURS are never late. The blocking script below has already applied
 * the theme before first paint; what settles here is only which segment of the
 * control looks pressed.
 */
export function getServerTheme(): Theme {
  return 'system';
}

export function subscribeTheme(listener: Listener): () => void {
  wire();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTheme(next: Theme) {
  current = next;
  applyTheme(next);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // The choice still applies to this page; only persistence failed. Losing
    // it on reload beats throwing inside a click handler.
  }

  emit();
}

/**
 * Runs blocking in <head>, before the browser paints anything.
 *
 * ⚠ It must stay inline and synchronous. Deferred, imported, or moved after
 * the first paint, the page renders light and then flips — and the flash is
 * worst in exactly the case the feature is for, someone who chose dark.
 *
 * Written as a string because it has to execute before React exists, and
 * wrapped in try/catch because `localStorage` throws in a partitioned context.
 * Falling through leaves the OS preference applied, which is the behaviour
 * this console had before the control existed — the right thing to degrade to.
 *
 * ⚠ The test is `t !== "light"`, not `!t || t === "system"`. Anything that is
 * neither "dark" nor "light" must fall through to the OS, because that is what
 * `readStored()` above does with an unrecognised value — and a stored key any
 * script on the origin can write is not guaranteed to hold one of the three.
 * When the two disagreed, a junk value painted light while the control showed
 * "System" selected and the OS asked for dark.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){}})()`;

'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useId, useSyncExternalStore } from 'react';

import {
  getServerTheme,
  getTheme,
  setTheme,
  subscribeTheme,
  type Theme,
} from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * Light · Dark · System.
 *
 * ── Why real radio inputs ────────────────────────────────────────────────────
 *
 * Three mutually exclusive options is what a radio group *is*, and using the
 * native element buys the whole keyboard contract for free: arrow keys move
 * between options, the group is one tab stop rather than three, and a screen
 * reader announces "2 of 3". Rebuilding that on three buttons and
 * `aria-pressed` means writing roving tabindex by hand and getting it slightly
 * wrong.
 *
 * The inputs are `sr-only`, never `hidden` — `display: none` removes an
 * element from the accessibility tree and from focus, which would throw away
 * the exact thing they are here for.
 *
 * ── Where the state lives ────────────────────────────────────────────────────
 *
 * In `lib/theme.ts`, not here, because this component is on screen twice — the
 * sidebar footer is `hidden` on mobile, so the header carries its own copy.
 * `useSyncExternalStore` keeps both, and any other tab, showing the same
 * answer. The `name` is still per-instance: two radio groups sharing a name
 * would be one group split across the document.
 */

const OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const name = useId();
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);

  return (
    <fieldset className={cn('flex items-center', className)}>
      <legend className="sr-only">Theme</legend>

      <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = theme === value;

          return (
            <label
              key={value}
              title={label}
              className={cn(
                'flex size-6 cursor-pointer items-center justify-center rounded-[5px] transition-colors',
                'has-focus-visible:ring-[3px] has-focus-visible:ring-ring/45',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <input
                type="radio"
                name={name}
                value={value}
                checked={active}
                onChange={() => setTheme(value)}
                className="sr-only"
              />
              <Icon className="size-3.5" aria-hidden />
              <span className="sr-only">{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

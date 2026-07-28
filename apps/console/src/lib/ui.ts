import { cn } from '@/lib/utils';

/**
 * Shared control styling.
 *
 * Deliberately a class *function* rather than a `<Button>` component, for two
 * reasons that both come from this app specifically:
 *
 * 1. The console's actions are split almost evenly between `<button>` (sign
 *    out, catch up), `<a>` (the Gmail OAuth start, which must be a real
 *    navigation) and `<Link>` (connect a channel). A component would have to
 *    grow an `asChild` escape hatch to cover all three; a class string covers
 *    them for free.
 * 2. `@/components/ui` is shadcn's namespace — `pnpm dlx shadcn@latest add
 *    button` writes `ui/button.tsx` and would silently replace anything of the
 *    same name living there. Keeping the project's own vocabulary out of that
 *    folder means the two can never collide.
 */

type Variant = 'primary' | 'subtle' | 'ghost';
type Size = 'sm' | 'md' | 'icon';

const BASE =
  'focus-ring inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md ' +
  'font-medium whitespace-nowrap transition-[background-color,border-color,opacity,color] ' +
  'duration-150 disabled:pointer-events-none disabled:opacity-60';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  subtle:
    'border border-border bg-panel text-foreground hover:bg-accent hover:border-input',
  ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-note',
  md: 'h-9 px-4 text-sm',
  icon: 'size-8',
};

export function buttonClass(
  options: { variant?: Variant; size?: Size; className?: string } = {},
) {
  const { variant = 'primary', size = 'md', className } = options;
  return cn(BASE, VARIANT[variant], SIZE[size], className);
}

/**
 * The stencilled label voice — mono, uppercase, widely tracked.
 *
 * This is what the console uses for everything the *machine* knows, as opposed
 * to everything a *person* wrote. It appears often enough (channel status, day
 * counts, connection state, the "soon" marker, section labels) that having it
 * in one place is what stops the tracking from drifting between screens.
 *
 * Note it sets a real colour rather than an opacity. Set at 10px these are the
 * smallest text on screen, so they need MORE contrast help than body copy, not
 * less — the previous `text-muted-foreground/60` landed near 2.3:1.
 */
export const LABEL = 'font-mono text-label uppercase text-muted-foreground';

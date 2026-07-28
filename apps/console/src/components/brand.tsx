import { cn } from '@/lib/utils';

/**
 * The mark and the wordmark, in one place.
 *
 * They were duplicated in `app-shell` and `auth-card`, which is how the two
 * halves of a product start to look like two products. Anything wearing the
 * name renders this, and `app/icon.tsx` redraws the same figure for the tab.
 */

/**
 * Many lines in, one operator's view out.
 *
 * A cord patched from a line on the left across to a trunk on the right, with
 * the second line dropping away unanswered — and the lamp above the jack lit.
 * The lamp is the one amber thing in the product, the same `--live` used by
 * the connection indicator and the new-message pill, so the logo is saying the
 * board is up rather than decorating itself.
 */
export function SwitchboardMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-[18px] shrink-0 text-foreground', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 5h6a4 4 0 0 1 4 4v6a4 4 0 0 0 4 4h4" />
      <path d="M3 19h6a4 4 0 0 0 4-4" opacity={0.4} />
      <circle cx="20.5" cy="5" r="1.75" className="fill-live" stroke="none" />
    </svg>
  );
}

/**
 * Set in the mono face, spaced out and in caps — the way a name is stencilled
 * onto equipment rather than the way it is set on a poster. It is the same
 * voice the console uses for everything the machine knows, which is what the
 * name is here: the label on the panel.
 */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <SwitchboardMark />
      <span className="font-mono text-[12px] leading-none font-medium tracking-[0.2em] uppercase">
        Switchboard
      </span>
    </span>
  );
}

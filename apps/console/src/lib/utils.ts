import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * shadcn/ui's class helper. Merges conditional classes, last Tailwind rule wins.
 *
 * ⚠ The type scale has to be declared here as well as in `globals.css`.
 *
 * tailwind-merge resolves a conflict by deciding which *group* a class belongs
 * to, and it only knows the groups shipped by stock Tailwind. `text-label`,
 * `text-row`, `text-subject` and the rest of the console's scale are not in
 * that list, so it falls back to matching them as `text-{color}` — which puts
 * them in the same group as `text-muted-foreground` and keeps only the last
 * one written.
 *
 * The failure is silent and it is a good deal worse than it sounds: a class
 * string is dropped, no error is raised, and the element renders at the
 * browser default of 16px inside a 10px stencilled label. It hit four elements
 * — the connection indicator, the channel legend's status, the nav's "soon"
 * marker and the timeline's channel label — while identical classes written
 * without `cn()` were fine, which is about as confusing as a styling bug gets.
 *
 * Anything added to the `--text-*` tokens in `globals.css` must be added here
 * in the same commit.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'label',
            'meta',
            'note',
            'row',
            'subject',
            'heading',
            'display',
            // The landing page's headline. Added 2026-08-06 in the same commit
            // as `--text-hero` in globals.css, per the warning above — without
            // this line `cn('text-hero', …)` drops it and the hero renders at
            // 16px with nothing logged.
            'hero',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

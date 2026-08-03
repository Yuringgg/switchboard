'use client';

import { useEffect, useState } from 'react';

import { InteractiveMenu } from '@/components/ui/modern-mobile-menu';
import { NAV_ITEMS } from '@/lib/nav';

/**
 * The console's navigation, in the two shapes the frame takes.
 *
 * `vertical` is the desktop rail inside the sidebar; `horizontal` is the dock
 * along the bottom edge of a phone. One component renders both, because they
 * name the same six destinations and the moment they are two implementations is
 * the moment they start to disagree — which is exactly what happened to the
 * "soon" markers before Phase 3 filled the routes in.
 *
 * ── Which entry is lit ───────────────────────────────────────────────────────
 *
 * The route decides, never the click. A nav that highlights whatever you
 * touched is telling you where you asked to go rather than where you are, and
 * the two differ for as long as the navigation takes. `pending` covers only
 * that gap and is cleared by `activeHref` changing, so it can never disagree
 * with the URL for longer than one navigation.
 */
export function ConsoleNav({
  activeHref,
  orientation,
  className,
}: {
  activeHref: string;
  orientation: 'horizontal' | 'vertical';
  className?: string;
}) {
  const routeIndex = NAV_ITEMS.findIndex((item) => item.href === activeHref);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => setPending(null), [activeHref]);

  return (
    <InteractiveMenu
      aria-label="Primary"
      orientation={orientation}
      className={className}
      items={NAV_ITEMS.map(({ label, icon, href, ready }) => ({
        label,
        icon,
        href,
        ready,
      }))}
      activeIndex={pending ?? (routeIndex >= 0 ? routeIndex : 0)}
      onSelect={setPending}
    />
  );
}

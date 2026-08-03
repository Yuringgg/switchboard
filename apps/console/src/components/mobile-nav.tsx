'use client';

import { useEffect, useState } from 'react';

import { InteractiveMenu } from '@/components/ui/modern-mobile-menu';
import { NAV_ITEMS } from '@/lib/nav';

/**
 * The console's navigation on a phone: a dock along the bottom edge.
 *
 * ── Why it replaces the strip, and only on a phone ───────────────────────────
 *
 * The sidebar's nav becomes a horizontally scrolling row of six items under the
 * wordmark at narrow widths — which puts navigation at the top of the screen,
 * furthest from the thumb, and hides whichever entries did not fit behind a
 * scroll with no affordance saying so. The desktop sidebar is untouched: a
 * horizontal dock is not a thing a 240px rail wants to be.
 *
 * ── Which entry is lit ───────────────────────────────────────────────────────
 *
 * The route decides, never the tap. A dock that highlights whatever you touched
 * is telling you where you asked to go rather than where you are, and the two
 * differ for as long as the navigation takes — which on a cold route is long
 * enough to see. `pending` exists only to cover that gap, and it is cleared by
 * `activeHref` changing, so it can never disagree with the URL for longer than
 * one navigation.
 */
export function MobileNav({ activeHref }: { activeHref: string }) {
  const routeIndex = NAV_ITEMS.findIndex((item) => item.href === activeHref);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => setPending(null), [activeHref]);

  return (
    <InteractiveMenu
      aria-label="Primary"
      className="md:hidden"
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

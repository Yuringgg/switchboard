'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useRef } from 'react';

/**
 * A compact icon dock: every entry shows its icon, the active one also shows
 * its label with a rule underneath sized to the word.
 *
 * ── What was changed from the source snippet, and why ────────────────────────
 *
 * 1. **The 2–5 item cap silently replaced the caller's menu with demo data.**
 *    `items.length >= 2 && items.length <= 5` failing meant a `console.warn`
 *    and a fall back to `defaultItems` — so this console's six entries would
 *    have rendered as *"home · strategy · period · security · settings"*, in
 *    production, with nothing but a warning in a console nobody has open. The
 *    cap is gone. A caller's items are now always the items.
 * 2. **`ref={(el) => (itemRefs.current[i] = el)}` is a React 19 error.** An
 *    arrow function with an expression body *returns* the assignment, and React
 *    19 reads a returned function as the ref's cleanup — "Unexpected return
 *    value from a callback ref". This app is on React 19.2. Both callbacks have
 *    block bodies now.
 * 3. **It navigated nowhere.** `activeIndex` was local state set by a click, so
 *    the dock highlighted whatever you tapped and stayed on the same page.
 *    Entries carrying an `href` render as `Link`s, and which one is active is
 *    now the caller's to say — see `components/mobile-nav.tsx`, where it comes
 *    from the route.
 * 4. **`tw-animate-css` and the `--color-chart-*` block were dropped.** The
 *    first is not a dependency of this project and nothing here needs it; the
 *    second was `--color-chart-2: var(--color-chart-2)`, which defines a
 *    variable as itself, for a palette this console does not have.
 *
 * The class names are the snippet's own (`menu`, `menu__item`, `menu__icon`,
 * `menu__text`). The rules behind them were **not** in the CSS it shipped with
 * — only the custom properties were — so they are written against this
 * console's tokens in `globals.css`.
 */

type IconComponentType = React.ElementType<{ className?: string }>;

export interface InteractiveMenuItem {
  label: string;
  icon: IconComponentType;
  /** Renders the entry as a link. Without one it is a plain button. */
  href?: string;
  /** False renders the entry visibly inert rather than hiding it. */
  ready?: boolean;
}

export interface InteractiveMenuProps {
  items: InteractiveMenuItem[];
  /** Which entry is current. Controlled — the dock never decides this itself. */
  activeIndex: number;
  /** Optimistic feedback on tap, before the route resolves. */
  onSelect?: (index: number) => void;
  /**
   * `horizontal` is the dock along the bottom of a phone: icons only, with the
   * current entry alone showing its label.
   *
   * `vertical` is the desktop rail. Every label stays visible — a 240px column
   * has the room, and a stack of six unlabelled icons is a worse sidebar than
   * the one it replaced. The active entry keeps the treatment that makes this
   * component itself: the filled pill, the icon's bounce, and a rule under its
   * label.
   */
  orientation?: 'horizontal' | 'vertical';
  accentColor?: string;
  className?: string;
  'aria-label'?: string;
}

export function InteractiveMenu({
  items,
  activeIndex,
  onSelect,
  orientation = 'horizontal',
  accentColor,
  className,
  'aria-label': ariaLabel,
}: InteractiveMenuProps) {
  const textRefs = useRef<(HTMLElement | null)[]>([]);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  /**
   * The rule under the active label is as wide as the label.
   *
   * It has to be measured rather than declared, because the width of "Needs
   * attention" is a fact about the font, and this console swaps a webfont in
   * after first paint. `document.fonts.ready` is why the rule does not settle
   * at the fallback face's width and stay there.
   */
  useEffect(() => {
    const setLineWidth = () => {
      const item = itemRefs.current[activeIndex];
      const text = textRefs.current[activeIndex];
      if (item && text) {
        item.style.setProperty('--lineWidth', `${text.offsetWidth}px`);
      }
    };

    setLineWidth();
    document.fonts?.ready.then(setLineWidth).catch(() => {});
    window.addEventListener('resize', setLineWidth);
    return () => window.removeEventListener('resize', setLineWidth);
  }, [activeIndex, items]);

  const navStyle = useMemo(
    () =>
      ({
        '--component-active-color': accentColor || 'var(--component-active-color-default)',
      }) as React.CSSProperties,
    [accentColor],
  );

  return (
    <nav
      className={`menu${orientation === 'vertical' ? ' menu--vertical' : ''} ${className ?? ''}`}
      aria-label={ariaLabel}
      style={navStyle}
    >
      {items.map((item, index) => {
        const isActive = index === activeIndex;
        const Icon = item.icon;
        const inert = item.ready === false;

        const inner = (
          <>
            <span className="menu__icon">
              <Icon className="icon" />
            </span>
            {/*
              Present in the DOM even while collapsed — it is clipped by width,
              not removed. That is what makes an icon-only control still have an
              accessible name, so a screen reader announces "Search" rather than
              an unlabelled button.
            */}
            <strong
              className="menu__text"
              ref={(el) => {
                textRefs.current[index] = el;
              }}
            >
              {item.label}
            </strong>
          </>
        );

        /*
         * ⚠ No inline `style` here, unlike the snippet this came from.
         *
         * It seeded `--lineWidth: 0px` as a React prop, which meant every
         * re-render re-asserted 0 over the width the effect had just measured —
         * so the rule under the label stayed invisible until something
         * unrelated (a resize) happened to run the measurement again. The
         * default now lives on `.menu__item` in CSS, where an inline value set
         * by the effect simply outranks it and nothing can race it.
         */
        const shared = {
          className: `menu__item${isActive ? ' active' : ''}${inert ? ' inert' : ''}`,
        };

        if (item.href && !inert) {
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelect?.(index)}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              {...shared}
            >
              {inner}
            </Link>
          );
        }

        return (
          <button
            key={item.label}
            type="button"
            disabled={inert}
            aria-disabled={inert || undefined}
            onClick={() => onSelect?.(index)}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            {...shared}
          >
            {inner}
          </button>
        );
      })}
    </nav>
  );
}

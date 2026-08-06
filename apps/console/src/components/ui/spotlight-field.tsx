'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The frame around an auth input, lit under the pointer.
 *
 * ── ⚠ What changed from the supplied component, and why ─────────────────────
 *
 * The original wrapped every input in a `motion.div` whose background was a
 * `useMotionTemplate` radial gradient driven by two `useMotionValue`s. That is
 * a per-frame React subscription to do what two CSS custom properties and the
 * compositor already do — and it fails closed here, because framer-motion runs
 * its own rAF loop and this project's browser pane delivers no rAF callbacks.
 *
 * So the coordinates are written straight onto the element with
 * `style.setProperty` and the gradient lives in `globals.css`. If scripting
 * never runs, the field renders with its ordinary border and every input still
 * works — which is the correct failure for a sign-in form.
 *
 * ⚠ The spotlight colour is `--ring`, not the snippet's `#3b82f6`. This is a
 * focus affordance, and the console already has exactly one colour for that.
 * Introducing a fifth hue on a screen whose whole discipline is "colour means
 * channel identity or liveness" is the change this design refuses.
 */
export function SpotlightField({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      // `pointermove`, not `mousemove`: it covers pen and touch, and on touch it
      // simply fires once on contact rather than never.
      onPointerMove={(event) => {
        const el = ref.current;
        if (!el) return;
        const box = el.getBoundingClientRect();
        el.style.setProperty('--x', `${event.clientX - box.left}px`);
        el.style.setProperty('--y', `${event.clientY - box.top}px`);
      }}
      className={cn('field-spotlight', className)}
    >
      {children}
    </div>
  );
}

/**
 * The password field's show/hide control.
 *
 * ⚠ It toggles the input's own `type` through React state rather than through
 * the DOM, so the value is never re-mounted and a password manager's fill is
 * never dropped. The supplied version hoisted this state to the whole form,
 * which on a two-password screen (there is only one here, but the pattern
 * spreads) reveals every field at once.
 *
 * ⚠ `autoComplete` is passed through and matters: `current-password` asks a
 * manager for a SAVED password, `new-password` asks it to generate one and
 * offer to save. Getting that wrong on signup means the manager never offers
 * to store the account being created.
 */
export function PasswordInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={cn(className, 'pr-10')}
      />

      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // ⚠ Announced as a state, not as an icon. "Button, eye" tells a screen
        // reader user nothing about whether their password is currently on
        // screen — which is the only thing this control is for.
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className={cn(
          'focus-ring absolute top-1/2 right-1 flex size-7 -translate-y-1/2',
          'items-center justify-center rounded-md text-muted-foreground',
          'transition-colors hover:text-foreground',
        )}
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

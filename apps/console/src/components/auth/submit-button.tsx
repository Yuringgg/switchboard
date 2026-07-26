'use client';

import { Loader2 } from 'lucide-react';
import { useFormStatus } from 'react-dom';

/**
 * Submit button with a real pending state.
 *
 * Without this the form gives no feedback between click and navigation, and on
 * a slow connection the natural response is to click again — which fires the
 * action twice.
 *
 * `useFormStatus` must be rendered *inside* the `<form>` it reports on, which
 * is why this is its own component rather than a prop on the page.
 *
 * Deliberately not disabled until `pending` — a button disabled before the
 * request starts can swallow the very click that would have submitted it.
 */
export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      // aria-disabled rather than relying on `disabled` alone would remove it
      // from the tab order mid-interaction; `disabled` is correct here because
      // it only applies once the request is already in flight.
      className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60"
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

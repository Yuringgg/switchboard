import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Brand } from '@/components/brand';
import { Callout } from '@/components/callout';
import { ThemeToggle } from '@/components/theme-toggle';
import { AuthAside, AuthGlow } from '@/components/ui/auth-backdrop';
import { buttonClass } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * Frame shared by /login and /signup, so the two pages cannot drift visually.
 *
 * ── The shape ────────────────────────────────────────────────────────────────
 *
 * Two panels. The left is the flowing-lines backdrop with the mark and one
 * sentence; the right is the form, centred, over a soft radial light. Below
 * `lg` the left panel is not rendered at all — on a phone it would push the
 * form the visitor actually came for below the fold.
 *
 * ── ⚠ The entrance animation is gone, and the reason is worth keeping ────────
 *
 * This screen briefly had a `BoxReveal` shutter on every element: a bar that
 * covered each one and slid off to the right. It shipped **visibly broken**.
 * At rest the bar sat at `translateX(101%)`, which is only hidden if something
 * clips it, and nothing did — `overflow: hidden` had been left off on purpose
 * so the bar could not clip the focus ring on the inputs beneath it. Every
 * element therefore rendered with a solid rectangle parked next to it, straight
 * down the right edge of the form.
 *
 * The motion lives in the backdrop now, where it cannot cover a control and
 * costs nothing. **Do not reintroduce a per-element wipe here** without a
 * wrapper that clips it *and* leaves room for a 3px focus ring.
 *
 * ── ⚠ What did NOT change, and must not ─────────────────────────────────────
 *
 * **The forms are still server actions.** Every component this styling has been
 * adapted from ships a form that holds its fields in `useState`, validates in
 * the browser and calls `onSubmit`. Adopting one would move this project's
 * authentication into the client and throw away the server-side validation, the
 * redirect-carried error messages, and the deliberate refusal to distinguish
 * "no such account" from "wrong password".
 *
 * **There are no social sign-in buttons.** The latest source offered Google,
 * Apple and GitHub. This product federates with none of them — Google OAuth
 * exists here to *connect a Gmail channel* once you are already signed in, a
 * different consent for different scopes on a different screen. Three buttons
 * that cannot work, on the one screen a visitor cannot get past, is not a
 * styling choice.
 *
 * **There is no Terms / Privacy line.** The source has one. Neither document
 * exists for this project, and linking to a policy that is not written is a
 * claim rather than a placeholder.
 */
export function AuthCard({
  title,
  subtitle,
  error,
  notice,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  error?: string;
  notice?: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,32rem)]">
      <AuthAside />

      <main className="relative flex flex-col justify-center px-5 py-14 sm:px-10">
        <AuthGlow />

        {/* The way back out. A visitor who arrived from a bookmark or a `next=`
            redirect has no other route to the page that explains what this is. */}
        <Link
          href="/welcome"
          className={cn(
            buttonClass({ variant: 'ghost', size: 'sm' }),
            'absolute top-6 left-4 sm:left-8',
          )}
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          Home
        </Link>

        <div className="mx-auto w-full max-w-[24rem]">
          {/* The mark repeats here below `lg`, where the left panel is not
              rendered and nothing else on screen names the product. */}
          <div className="lg:hidden">
            <Brand size="lg" />
          </div>

          <div className="mt-7 lg:mt-0">
            <h1 className="text-display font-semibold">{title}</h1>
            <p className="mt-2 text-note text-muted-foreground text-pretty">
              {subtitle}
            </p>
          </div>

          {/*
            `role="alert"` fires on load — these arrive via a server redirect,
            and it is the only way a screen-reader user learns the attempt
            failed.
          */}
          {error && (
            <Callout tone="error" role="alert" className="mt-5">
              {error}
            </Callout>
          )}

          {notice && (
            <Callout tone="notice" role="status" className="mt-5">
              {notice}
            </Callout>
          )}

          {children}

          <p className="mt-6 text-note text-muted-foreground">{footer}</p>

          {/* Reachable before signing in, deliberately. The console's own
              control lives in a sidebar nobody has reached yet, and this is a
              screen a room full of people sees first. */}
          <div className="mt-9">
            <ThemeToggle size="md" />
          </div>
        </div>
      </main>
    </div>
  );
}

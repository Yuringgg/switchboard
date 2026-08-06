import Link from 'next/link';
import type { ReactNode } from 'react';

import { Brand } from '@/components/brand';
import { Callout } from '@/components/callout';
import { ThemeToggle } from '@/components/theme-toggle';
import { BoxReveal } from '@/components/ui/box-reveal';
import { AuthAside } from '@/components/ui/switchboard-orbit';

/**
 * Frame shared by /login and /signup, so the two pages cannot drift visually.
 *
 * ── The shape, and why it changed on 2026-08-06 ──────────────────────────────
 *
 * It was a 22rem card centred in an empty viewport. That is a perfectly good
 * login screen and it said nothing: somebody arriving at `/login` from a
 * bookmark or a `next=` redirect saw a password field, a product name they may
 * not recognise, and one line of copy.
 *
 * Now it is two panels. The left is `AuthAside` — the board with the things it
 * handles in orbit around it, plus the one sentence that explains the product.
 * The right is the form, unchanged in behaviour. On anything below `lg` the
 * left panel is not rendered at all: on a phone it would push the form the
 * visitor actually came for below the fold, which is the opposite of helping.
 *
 * ── ⚠ What did NOT change, and must not ─────────────────────────────────────
 *
 * **The forms are still server actions.** The component this was adapted from
 * ships an `AnimatedForm` that holds every field in `useState`, validates in
 * the browser, and calls `onSubmit` — with `console.log('Form submitted')` as
 * the reference implementation. Adopting that would have moved this project's
 * authentication into the client and thrown away the server-side validation,
 * the redirect-carried error messages, and the deliberate refusal to
 * distinguish "no such account" from "wrong password". The animation is a
 * wrapper around the existing `<form action={signIn}>`, not a replacement for
 * it.
 *
 * **There is no "Sign in with Google" button**, which the original had. This
 * product does not authenticate with Google. Google OAuth exists here to
 * *connect a Gmail channel* once you are already signed in — a different
 * consent, for different scopes, on a different screen. A button offering an
 * identity provider that is not wired up is not a stylistic choice; it is a
 * dead end on the one screen a visitor cannot get past.
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
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,30rem)]">
      <AuthAside />

      <main className="flex flex-col justify-center px-5 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-[24rem]">
          {/*
            The mark links out to the landing page. Somebody who arrives here
            from a bookmark or a `next=` redirect has no other way to find out
            what this is, and a wordmark that does not go home is the first link
            every visitor tries.
          */}
          <BoxReveal>
            <Link href="/welcome" className="focus-ring inline-block rounded-md">
              <Brand size="lg" />
            </Link>
          </BoxReveal>

          <BoxReveal delay={0.08} className="mt-7">
            <h1 className="text-display font-semibold">{title}</h1>
          </BoxReveal>

          <BoxReveal delay={0.14} className="mt-2">
            <p className="text-note text-muted-foreground text-pretty">{subtitle}</p>
          </BoxReveal>

          {/*
            ⚠ Outside the reveal stack, and always mounted at full opacity.

            These arrive via a server redirect, so `role="alert"` fires on load
            and is the only way a screen-reader user learns the attempt failed.
            Wrapping them in an entrance animation would mean the one element on
            this page that must be readable immediately is the one held back
            longest — and if the animation never ran, an error message would be
            the thing that never appeared.
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

          <BoxReveal delay={0.34} className="mt-6">
            <p className="text-note text-muted-foreground">{footer}</p>
          </BoxReveal>

          {/* Reachable before signing in, deliberately. The console's own
              control lives in a sidebar nobody has reached yet, and this is a
              screen a room full of people sees first. */}
          <BoxReveal delay={0.4} className="mt-9">
            <ThemeToggle size="md" />
          </BoxReveal>
        </div>
      </main>
    </div>
  );
}

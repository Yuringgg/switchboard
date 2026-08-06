import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthCard } from '@/components/auth/auth-card';
import { EmailField, PasswordField } from '@/components/auth/fields';
import { SubmitButton } from '@/components/auth/submit-button';
import { BoxReveal } from '@/components/ui/box-reveal';
import { signIn } from '@/lib/auth-actions';

export const metadata: Metadata = { title: 'Sign in · Switchboard' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; notice?: string }>;
}) {
  const { next = '/', error, notice } = await searchParams;

  return (
    <AuthCard
      title="Sign in"
      subtitle="Your channels and messages are visible only to you."
      error={error}
      notice={notice}
      footer={
        <>
          New here?{' '}
          <Link
            href={`/signup?next=${encodeURIComponent(next)}`}
            className="focus-ring rounded font-medium text-foreground underline underline-offset-4 hover:no-underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      {/*
        One form, ONE submit.

        This used to carry a second submit button labelled "Create an account",
        which read as a link to a signup page but was actually a second
        `formAction` on the sign-in form. Clicking it with empty fields produced
        the browser's required-field tooltip and no explanation — you had to
        work out that it wanted the fields above filled in first.

        Signup is now a real page at /signup, reached by a real link. A control
        that reads as navigation should navigate: it gets Cmd/Ctrl+click and
        middle-click for free, and neither page has an ambiguous second action.
      */}
      <form action={signIn} className="mt-7 space-y-4">
        <input type="hidden" name="next" value={next} />
        <EmailField />
        <PasswordField mode="signin" />
        {/* Last in the reveal stack, so the shutters clear downward and land on
            the control the visitor is reaching for. */}
        <BoxReveal delay={0.3} className="pt-1">
          <SubmitButton>Sign in</SubmitButton>
        </BoxReveal>
      </form>
    </AuthCard>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthCard } from '@/components/auth/auth-card';
import { EmailField, PasswordField } from '@/components/auth/fields';
import { SubmitButton } from '@/components/auth/submit-button';
import { BoxReveal } from '@/components/ui/box-reveal';
import { signUp } from '@/lib/auth-actions';

export const metadata: Metadata = { title: 'Create an account · Switchboard' };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = '/', error } = await searchParams;

  return (
    <AuthCard
      title="Create an account"
      subtitle="You'll connect your own channels, and only you will see them."
      error={error}
      footer={
        <>
          Already have an account?{' '}
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="focus-ring rounded font-medium text-foreground underline underline-offset-4 hover:no-underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form action={signUp} className="mt-7 space-y-4">
        <input type="hidden" name="next" value={next} />
        <EmailField />
        <PasswordField mode="signup" />
        <BoxReveal delay={0.3} className="pt-1">
          <SubmitButton>Create account</SubmitButton>
        </BoxReveal>
      </form>

      <BoxReveal delay={0.36} className="mt-4">
        <p className="text-note text-muted-foreground">
          We&rsquo;ll email you a confirmation link. You won&rsquo;t be signed in
          until you click it.
        </p>
      </BoxReveal>
    </AuthCard>
  );
}

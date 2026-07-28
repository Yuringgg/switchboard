import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthCard } from '@/components/auth/auth-card';
import { EmailField, PasswordField } from '@/components/auth/fields';
import { SubmitButton } from '@/components/auth/submit-button';
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
      <form action={signUp} className="mt-6 space-y-3.5">
        <input type="hidden" name="next" value={next} />
        <EmailField />
        <PasswordField mode="signup" />
        <SubmitButton>Create account</SubmitButton>
      </form>

      <p className="mt-3.5 text-note text-muted-foreground">
        We&rsquo;ll email you a confirmation link. You won&rsquo;t be signed in until
        you click it.
      </p>
    </AuthCard>
  );
}

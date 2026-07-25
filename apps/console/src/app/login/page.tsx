import type { Metadata } from 'next';

import { signIn, signUp } from './actions';

export const metadata: Metadata = { title: 'Sign in · Switchboard' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; notice?: string }>;
}) {
  const { next = '/', error, notice } = await searchParams;

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-[21rem]">
        <div className="flex items-center gap-2.5">
          <SwitchboardMark />
          <span className="text-[15px] leading-none font-semibold tracking-tight">
            Switchboard
          </span>
        </div>

        <h1 className="mt-6 text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your channels and messages are visible only to you.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {notice && (
          <p
            role="status"
            className="mt-4 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground"
          >
            {notice}
          </p>
        )}

        <form className="mt-6 space-y-3.5">
          <input type="hidden" name="next" value={next} />

          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            />
          </div>

          <button
            type="submit"
            formAction={signIn}
            className="h-9 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Sign in
          </button>

          <button
            type="submit"
            formAction={signUp}
            className="h-9 w-full rounded-md border border-border text-sm font-medium hover:bg-accent"
          >
            Create an account
          </button>
        </form>
      </div>
    </div>
  );
}

function SwitchboardMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px] text-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 5h6a4 4 0 0 1 4 4v6a4 4 0 0 0 4 4h4" />
      <path d="M3 19h6a4 4 0 0 0 4-4" opacity={0.45} />
      <circle cx="20.5" cy="5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

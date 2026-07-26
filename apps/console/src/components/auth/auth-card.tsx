import type { ReactNode } from 'react';

/** Frame shared by /login and /signup, so the two pages cannot drift visually. */
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
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-[21rem]">
        <div className="flex items-center gap-2.5">
          <SwitchboardMark />
          <span className="text-[15px] leading-none font-semibold tracking-tight">
            Switchboard
          </span>
        </div>

        <h1 className="mt-6 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

        {/* role="alert" so a screen reader announces the failure on load —
            these arrive via a server redirect, not an in-page update. */}
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

        {children}

        <p className="mt-5 text-center text-sm text-muted-foreground">{footer}</p>
      </div>
    </div>
  );
}

/** Many lines in, one operator's view out. */
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

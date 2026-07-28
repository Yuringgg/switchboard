'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { ShellMessage } from '@/components/shell-message';
import { buttonClass } from '@/lib/ui';

/**
 * The error boundary for every route in the console.
 *
 * ── What it deliberately does not show ───────────────────────────────────────
 *
 * `error.message`. This app's stack traces run through queries that carry real
 * message bodies and addresses, and `docs/02-ARCHITECTURE.md` §6 is
 * unambiguous that content is never rendered outside the timeline. Next
 * already redacts the message in production builds, but this boundary also
 * renders in development and on preview deployments, and "it was redacted for
 * us" is not a boundary — deciding not to print it is.
 *
 * `error.digest` IS shown. It is a hash Next generates specifically so a user
 * can quote it and a developer can find the matching server log. It carries no
 * content, and without it a report is "it broke".
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // IDs and the digest only — never the message. Same rule as the worker.
    console.error('[console] render error', error.digest ?? '(no digest)');
  }, [error]);

  return (
    <ShellMessage
      code="Error"
      title="Something broke"
      action={
        <>
          <button
            type="button"
            onClick={reset}
            className={buttonClass({ size: 'sm' })}
          >
            Try again
          </button>
          <Link href="/" className={buttonClass({ variant: 'subtle', size: 'sm' })}>
            Go to the timeline
          </Link>
        </>
      }
    >
      <p>
        This page failed to render. Nothing you were looking at has been lost —
        the console only ever reads.
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-label uppercase">
          Reference {error.digest}
        </p>
      )}
    </ShellMessage>
  );
}

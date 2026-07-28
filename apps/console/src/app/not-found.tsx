import type { Metadata } from 'next';
import Link from 'next/link';

import { ShellMessage } from '@/components/shell-message';
import { buttonClass } from '@/lib/ui';

export const metadata: Metadata = { title: 'Not found · Switchboard' };

/**
 * The 404.
 *
 * It replaces Next's stock page, which is an unstyled white sheet in Helvetica
 * — the single fastest way for a product to stop looking like a product, and
 * it is reachable from any mistyped URL. It is also what a viewer sees if
 * anything is clicked during a demo that does not exist yet, which on a
 * console with two nav items still marked "soon" is not hypothetical.
 *
 * Signed-out visitors reach this too, so it must not assume a session — see
 * `components/shell-message.tsx`.
 */
export default function NotFound() {
  return (
    <ShellMessage
      code="404"
      title="No such page"
      action={
        <>
          <Link href="/" className={buttonClass({ size: 'sm' })}>
            Go to the timeline
          </Link>
          <Link
            href="/channels"
            className={buttonClass({ variant: 'subtle', size: 'sm' })}
          >
            Channels
          </Link>
        </>
      }
    >
      That address doesn&rsquo;t point at anything. Contacts and Assistant
      aren&rsquo;t built yet — the sidebar marks those &ldquo;soon&rdquo;.
    </ShellMessage>
  );
}

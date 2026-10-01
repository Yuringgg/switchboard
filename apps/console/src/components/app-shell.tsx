import type { ReactNode } from 'react';

import { ConsoleFrame } from '@/components/console-frame';
import { PageFrame } from '@/components/page-frame';
import type { ChannelRow } from '@/lib/channels';

/**
 * The whole console frame and one page, in a single element.
 *
 * ⚠ Real routes do NOT use this any more (2026-10-02, ADR-031). They live under
 * `app/(console)/`, whose layout renders `ConsoleFrame` once and keeps it
 * across navigation, and each page renders only `PageFrame`. Rendering this
 * from a page inside that group would draw a second sidebar inside the first.
 *
 * It stays for `/preview`, which sits outside the group and renders fixtures
 * through exactly the same two components — so a screenshot of the preview is
 * still a screenshot of the real frame.
 */
export function AppShell({
  title,
  description,
  userEmail,
  userId,
  activeHref,
  channels,
  width = 'default',
  children,
}: {
  title: string;
  description?: string;
  userEmail: string;
  userId: string;
  activeHref: string;
  channels: Promise<{ channels: ChannelRow[]; error: string | null }>;
  width?: 'default' | 'wide';
  children: ReactNode;
}) {
  return (
    <ConsoleFrame
      userEmail={userEmail}
      userId={userId}
      channels={channels}
      activeHref={activeHref}
    >
      <PageFrame title={title} description={description} width={width}>
        {children}
      </PageFrame>
    </ConsoleFrame>
  );
}

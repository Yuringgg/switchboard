import { PageFrame } from '@/components/page-frame';
import { TimelineSkeleton } from '@/components/timeline';

/**
 * Shown the instant Timeline is clicked, while the server is still answering.
 * Same header as the page, and a skeleton the page's shape. ADR-031.
 *
 * ⚠ It is EXACTLY the page's own first streamed state — the filter's reserved
 * row and `TimelineSkeleton` — in the wide measure, because split is the
 * timeline's default view (see `page.tsx`). When the page's first flush
 * replaces this, nothing on screen moves.
 */
export default function Loading() {
  return (
    <PageFrame
      title="Timeline"
      description="Every message, every channel, in order."
      width="wide"
      busy
    >
      <div className="mb-6 h-[26px]" aria-hidden />
      <TimelineSkeleton />
    </PageFrame>
  );
}

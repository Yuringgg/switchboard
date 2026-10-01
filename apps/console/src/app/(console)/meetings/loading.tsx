import { PageFrame } from '@/components/page-frame';
import { PanelSkeleton } from '@/components/page-skeletons';

/**
 * Shown the instant Meetings is clicked, while the server is still answering.
 * Same header as the page, and a skeleton the page's shape. ADR-031.
 */
export default function Loading() {
  return (
    <PageFrame
      title="Meetings"
      description="Send a notetaker into a call, and see what it did."
      busy
    >
      <PanelSkeleton />
    </PageFrame>
  );
}

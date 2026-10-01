import { PageFrame } from '@/components/page-frame';
import { BoardSkeleton } from '@/components/page-skeletons';

/**
 * Shown the instant Needs attention is clicked, while the server is still answering.
 * Same header as the page, and a skeleton the page's shape. ADR-031.
 */
export default function Loading() {
  return (
    <PageFrame
      title="Needs attention"
      description="Meetings, commitments and requests found in your messages, as a board."
      width="wide"
      busy
    >
      <BoardSkeleton />
    </PageFrame>
  );
}

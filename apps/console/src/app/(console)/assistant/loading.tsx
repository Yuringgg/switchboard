import { PageFrame } from '@/components/page-frame';
import { AssistantSkeleton } from '@/components/page-skeletons';

/**
 * Shown the instant Assistant is clicked, while the server is still answering.
 * Same header as the page, and a skeleton the page's shape. ADR-031.
 */
export default function Loading() {
  return (
    <PageFrame
      title="Assistant"
      description="Talk to Uriel, or type. Every answer cites the messages it used."
      width="wide"
      busy
    >
      <AssistantSkeleton />
    </PageFrame>
  );
}

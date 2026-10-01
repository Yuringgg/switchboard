import { PageFrame } from '@/components/page-frame';
import { DetailSkeleton } from '@/components/page-skeletons';

/**
 * Shown the instant a message is clicked, while the server is still answering.
 * Same header as the page, and a skeleton the page's shape. ADR-031.
 */
export default function Loading() {
  return (
    <PageFrame
      title="Message"
      description="One message, in full."
      busy
    >
      <DetailSkeleton />
    </PageFrame>
  );
}

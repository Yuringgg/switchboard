import { PageFrame } from '@/components/page-frame';
import { DetailSkeleton } from '@/components/page-skeletons';

/**
 * Shown the instant a contact is clicked, while the server is still answering.
 * Same header as the page, and a skeleton the page's shape. ADR-031.
 */
export default function Loading() {
  return (
    <PageFrame
      title="Contact"
      description="Every conversation with this person, across every channel."
      busy
    >
      <DetailSkeleton />
    </PageFrame>
  );
}

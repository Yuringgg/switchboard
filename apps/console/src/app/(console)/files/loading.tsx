import { PageFrame } from '@/components/page-frame';
import { FilesSkeleton } from '@/components/page-skeletons';

/**
 * Shown the instant Files is clicked, while the server is still answering.
 * Same header as the page, and a skeleton the page's shape. ADR-031.
 */
export default function Loading() {
  return (
    <PageFrame
      title="Files"
      description="Every document from your messages, filed for you."
      busy
    >
      <FilesSkeleton />
    </PageFrame>
  );
}

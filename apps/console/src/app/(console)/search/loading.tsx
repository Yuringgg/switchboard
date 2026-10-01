import { PageFrame } from '@/components/page-frame';
import { SearchControlsSkeleton } from '@/components/page-skeletons';
import { SearchPrompt } from '@/components/search-results';

/**
 * Shown the instant Search is clicked, while the server is still answering.
 * Same header as the page, and a skeleton the page's shape. ADR-031.
 *
 * The rail's Search entry opens the page with no question asked, so this is
 * that page's first state: the field holding its place, and the prompt.
 */
export default function Loading() {
  return (
    <PageFrame
      title="Search"
      description="One query, every channel, ranked by relevance."
      busy
    >
      <SearchControlsSkeleton />
      <SearchPrompt />
    </PageFrame>
  );
}

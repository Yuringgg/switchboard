import { ChannelListSkeleton } from '@/components/channel-list';
import { PageFrame } from '@/components/page-frame';

/**
 * Shown the instant Channels is clicked, while the server is still answering.
 * Same header as the page, and a skeleton the page's shape. ADR-031.
 */
export default function Loading() {
  return (
    <PageFrame
      title="Channels"
      description="Connect an account and its messages flow into the timeline."
      busy
    >
      <ChannelListSkeleton />
    </PageFrame>
  );
}

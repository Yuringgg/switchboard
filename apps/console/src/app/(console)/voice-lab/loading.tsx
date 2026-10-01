import { PageFrame } from '@/components/page-frame';
import { PanelSkeleton } from '@/components/page-skeletons';

/**
 * Shown the instant the voice lab is clicked, while the server is still answering.
 * Same header as the page, and a skeleton the page's shape. ADR-031.
 */
export default function Loading() {
  return (
    <PageFrame
      title="Voice lab"
      description="Record a clip, send it to Whisper, read the text and the timings. Development only."
      busy
    >
      <PanelSkeleton />
    </PageFrame>
  );
}

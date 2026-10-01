import { ContactsSkeleton } from '@/components/contact-list';
import { PageFrame } from '@/components/page-frame';

/**
 * Shown the instant Contacts is clicked, while the server is still answering.
 * Same header as the page, and a skeleton the page's shape. ADR-031.
 */
export default function Loading() {
  return (
    <PageFrame
      title="Contacts"
      description="One person, however many handles they have."
      busy
    >
      <ContactsSkeleton />
    </PageFrame>
  );
}

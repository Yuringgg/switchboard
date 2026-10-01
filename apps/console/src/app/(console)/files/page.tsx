import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Callout } from '@/components/callout';
import { FileLibrary, FilesEmpty } from '@/components/file-library';
import { PageFrame } from '@/components/page-frame';
import { fetchLibrary } from '@/lib/files';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Files · Switchboard' };

/**
 * Files — Ms. Maria's research task 5: documents routed into folders with no
 * manual download. The worker saves each attachment (`file-sweep.ts`); this
 * files it by who sent it, their company, "sent by you" and meetings — derived
 * on read, see `lib/files.ts`.
 */
export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/files');

  const { folder = 'all' } = await searchParams;
  const { items, error } = await fetchLibrary(supabase);

  return (
    <PageFrame
      title="Files"
      description="Every document from your messages, filed for you."
    >
      {error ? (
        <Callout tone="error" role="alert">
          Could not load files: {error}
        </Callout>
      ) : items.length === 0 ? (
        <FilesEmpty />
      ) : (
        <FileLibrary items={items} folderKey={folder} />
      )}
    </PageFrame>
  );
}

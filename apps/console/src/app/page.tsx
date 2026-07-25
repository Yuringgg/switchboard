import { AppShell } from '@/components/app-shell';
import { NoMessagesYet } from '@/components/empty-state';

export default function TimelinePage() {
  return (
    <AppShell
      title="Timeline"
      description="Every message, every channel, in order."
    >
      <NoMessagesYet />
    </AppShell>
  );
}

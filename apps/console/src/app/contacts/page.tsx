import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AppShell } from '@/components/app-shell';
import { Callout } from '@/components/callout';
import { ContactList, ContactsEmpty, ContactsSkeleton } from '@/components/contact-list';
import { fetchChannels, type ChannelRow } from '@/lib/channels';
import { fetchContacts } from '@/lib/contacts';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Contacts · Switchboard' };

/**
 * The contact list (US-5).
 *
 * One row per person, with **every handle they are known by** — which is the
 * whole point of the screen. `docs/01-PRODUCT-SPEC.md` §1: *"the same client is
 * a phone number in one app and an email address in another, with no link
 * between them."*
 *
 * ⚠ With only Gmail connected each contact has one identity and the merge is
 * invisible. That is the data, not the feature: the moment a WhatsApp number is
 * provisioned a contact renders here with two channels under one name, which is
 * step 5 of the demo sequence. `/preview?screen=contacts` shows that state.
 */
export default async function ContactsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/contacts');

  const channels = fetchChannels(supabase);
  // Not awaited: the shell streams ahead of the list.
  const contacts = fetchContacts(supabase);

  return (
    <AppShell
      title="Contacts"
      description="One person, however many handles they have."
      userEmail={user.email ?? 'Signed in'}
      userId={user.id}
      activeHref="/contacts"
      channels={channels}
    >
      <Suspense fallback={<ContactsSkeleton />}>
        <Contacts contacts={contacts} channels={channels} />
      </Suspense>
    </AppShell>
  );
}

async function Contacts({
  contacts,
  channels,
}: {
  contacts: ReturnType<typeof fetchContacts>;
  channels: Promise<{ channels: ChannelRow[]; error: string | null }>;
}) {
  const [{ contacts: rows, error }, { channels: channelRows }] = await Promise.all([
    contacts,
    channels,
  ]);

  if (error) {
    return (
      <Callout tone="error" role="alert">
        Could not load contacts: {error}
      </Callout>
    );
  }

  if (rows.length === 0) return <ContactsEmpty connected={channelRows.length > 0} />;

  return <ContactList contacts={rows} />;
}

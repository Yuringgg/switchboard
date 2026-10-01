import {
  FolderOpen,
  ListChecks,
  MessagesSquare,
  Plug,
  Search,
  Sparkles,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** False until the route exists. Rendered visibly inert rather than hidden —
   *  the shell should show the intended shape of the product, without
   *  pretending a surface works when it doesn't. */
  ready: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Timeline', href: '/', icon: MessagesSquare, ready: true },
  // Directly under Timeline: search is the same record, asked a question. It
  // sits above Contacts because it is the surface people reach for.
  { label: 'Search', href: '/search', icon: Search, ready: true },
  // Above Contacts and below Search: this is a *doing* surface, and it belongs
  // with the two screens people arrive at the console to use. Phase 5, US-9.
  { label: 'Needs attention', href: '/attention', icon: ListChecks, ready: true },
  { label: 'Contacts', href: '/contacts', icon: Users, ready: true },
  // Under Contacts: files are filed by who sent them, so the two read as a
  // pair. Ms. Maria's research task 5.
  { label: 'Files', href: '/files', icon: FolderOpen, ready: true },
  { label: 'Assistant', href: '/assistant', icon: Sparkles, ready: true },
  // Above Channels and below Assistant: sending a notetaker is a *doing*
  // surface like Needs attention, not configuration. Channels stays last
  // because it is the one screen you visit once and then forget.
  { label: 'Meetings', href: '/meetings', icon: Video, ready: true },
  { label: 'Channels', href: '/channels', icon: Plug, ready: true },
];

/**
 * Which nav entry a path belongs to.
 *
 * A message is read from the timeline and a contact from the contact list, so
 * `/messages/…` lights Timeline and `/contacts/…` lights Contacts. Anything
 * else is matched by its first segment. A path that is not in the nav at all
 * (`/voice-lab`) lights Timeline, which is what the nav did before it read the
 * path.
 */
export function navHrefFor(pathname: string): string {
  if (pathname.startsWith('/messages/')) return '/';
  const first = `/${pathname.split('/')[1] ?? ''}`;
  return NAV_ITEMS.some((item) => item.href === first) ? first : '/';
}

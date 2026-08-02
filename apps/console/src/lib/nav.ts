import {
  MessagesSquare,
  Plug,
  Search,
  Sparkles,
  Users,
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
  { label: 'Contacts', href: '/contacts', icon: Users, ready: false },
  { label: 'Assistant', href: '/assistant', icon: Sparkles, ready: true },
  { label: 'Channels', href: '/channels', icon: Plug, ready: true },
];

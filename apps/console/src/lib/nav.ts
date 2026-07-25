import { MessagesSquare, Plug, Sparkles, Users, type LucideIcon } from 'lucide-react';

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
  { label: 'Contacts', href: '/contacts', icon: Users, ready: false },
  { label: 'Assistant', href: '/assistant', icon: Sparkles, ready: false },
  { label: 'Channels', href: '/channels', icon: Plug, ready: false },
];

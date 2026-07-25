import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui's class helper. Merges conditional classes, last Tailwind rule wins. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import { AlertTriangle, CheckCircle2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The console's one message-to-the-user block.
 *
 * There were four copies of this markup — timeline errors, channel errors, the
 * OAuth success banner, the auth failure — drifting apart by a border colour
 * and a padding step each time one was edited.
 *
 * ── Why the role is a prop and not inferred ──────────────────────────────────
 *
 * `role="alert"` is assertive: a screen reader interrupts whatever it is
 * saying to read it. That is right for "your sign-in failed" and wrong for
 * "connected, messages will appear shortly", which is `role="status"` and
 * waits its turn. Tying it to `tone` would be convenient and would make every
 * success message shout.
 */
const TONE: Record<'error' | 'success' | 'notice', { box: string; icon: LucideIcon | null }> =
  {
    error: {
      box: 'border-destructive/30 bg-destructive/8 text-destructive',
      icon: AlertTriangle,
    },
    success: {
      box: 'border-border bg-panel text-foreground',
      icon: CheckCircle2,
    },
    notice: {
      box: 'border-border bg-panel text-muted-foreground',
      icon: null,
    },
  };

export function Callout({
  tone,
  role,
  className,
  children,
}: {
  tone: 'error' | 'success' | 'notice';
  role: 'alert' | 'status';
  className?: string;
  children: ReactNode;
}) {
  const { box, icon: Icon } = TONE[tone];

  return (
    <div
      role={role}
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-note',
        box,
        className,
      )}
    >
      {Icon && <Icon className="mt-px size-3.5 shrink-0" aria-hidden />}
      <div className="min-w-0 [&_a]:underline [&_a]:underline-offset-2">{children}</div>
    </div>
  );
}

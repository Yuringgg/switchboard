import { Inbox } from 'lucide-react';

import { CHANNELS } from '@/lib/channels';
import { cn } from '@/lib/utils';

/**
 * The state the console will spend its entire life in until Phase 1 lands a
 * real message. Worth building properly rather than leaving as a bare string:
 * per docs/04-ROADMAP.md Phase 3, every surface needs an empty state anyway.
 */
export function NoMessagesYet() {
  return (
    <div className="flex flex-1 items-center justify-center py-10">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-xl border border-border bg-card">
          <Inbox className="size-5 text-muted-foreground" aria-hidden />
        </div>

        <h2 className="mt-4 text-base font-semibold tracking-tight">
          No messages yet
        </h2>

        <p className="mt-1.5 text-sm leading-relaxed text-balance text-muted-foreground">
          Connect a channel and everything you receive lands here in one
          timeline, whichever app it came from.
        </p>

        <div className="mt-5 flex items-center justify-center gap-2">
          {CHANNELS.map(({ type, label, dotClass }) => (
            <span
              key={type}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
            >
              <span className={cn('size-1.5 rounded-full', dotClass)} aria-hidden />
              {label}
            </span>
          ))}
        </div>

        <button
          type="button"
          disabled
          className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          Connect a channel
        </button>

        <p className="mt-2.5 text-xs text-muted-foreground/80">
          Not wired up yet — Gmail is the first channel.
        </p>
      </div>
    </div>
  );
}

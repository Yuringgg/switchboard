import type { ReactNode } from 'react';

import { LiveStatus, SCROLLER_ID } from '@/components/live';
import { ConsoleBackdrop } from '@/components/ui/flowing-paths';
import { cn } from '@/lib/utils';

/**
 * One page's own part of the console: its header and its scroll column.
 *
 * The frame around it — sidebar, dock, the live connection — is `ConsoleFrame`,
 * rendered once by `app/(console)/layout.tsx` and kept across navigation. This
 * is what changes when you click: each page renders it with its own title, and
 * each route's `loading.tsx` renders it with the same title and a skeleton, so
 * the header is already right while the page is still on its way. ADR-031.
 */
export function PageFrame({
  title,
  description,
  /**
   * How wide the content column runs.
   *
   * `default` (56rem) is a reading measure and is right for everything that is
   * a list of prose — the timeline, search, a message. `wide` (76rem) exists
   * for the attention board: three columns inside 56rem gives each card about
   * 258px, which is narrower than the quote it has to show, and the result
   * reads as cramped rather than dense. It is the only screen in the console
   * whose content is laid out ACROSS rather than down.
   */
  width = 'default',
  /** Set by `loading.tsx`: marks the column busy for assistive technology. */
  busy = false,
  children,
}: {
  title: string;
  description?: string;
  width?: 'default' | 'wide';
  busy?: boolean;
  children: ReactNode;
}) {
  // ⚠ Full class strings, never `max-w-${…}`. Tailwind scans source text, so a
  // constructed class name is not in the stylesheet and silently does nothing.
  const measure = width === 'wide' ? 'max-w-[76rem]' : 'max-w-4xl';

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border bg-panel">
        <div
          className={cn(
            'mx-auto flex w-full items-center gap-4 px-5 py-4 md:px-10 md:py-5',
            measure,
          )}
        >
          <div className="min-w-0">
            <h1 className="truncate text-heading font-semibold">{title}</h1>
            {description && (
              <p className="mt-0.5 hidden truncate text-note text-muted-foreground sm:block">
                {description}
              </p>
            )}
          </div>
          <LiveStatus className="ml-auto shrink-0" />
        </div>
      </header>

      {/*
        ⚠ `relative isolate` is what makes the backdrop below work at all.

        `ConsoleBackdrop` is `-z-10`, and a negative z-index only stays
        inside its parent when that parent establishes a stacking context.
        Without `isolate` it paints behind the ROOT's background — which is
        opaque — and the jack field and its lines disappear completely with
        nothing in the DOM to explain it. `relative` alone does not
        establish one.

        The backdrop lives on this wrapper, UNDER the header rather than
        behind it (2026-09-27), so the header's own border is the jack
        field's top edge and its light hangs from it. Behind the content and
        NOT behind the sidebar or the header — the frame stays untextured.

        ⚠ On this wrapper rather than inside `<main>`, which is the one
        element in the app that scrolls. Inside, it would scroll away after
        one viewport and leave every page below the fold bare. Here it stays
        put and the record moves over it, which is also the right reading:
        the backdrop is the instrument, not part of the record.
      */}
      <div className="relative isolate flex min-h-0 flex-1 flex-col">
        <ConsoleBackdrop />

        {/*
          The one element that scrolls. `live.tsx` reads its offset by id
          to decide whether an arriving message may be inserted above what
          you are currently reading.

          `tabIndex={-1}` makes it the skip link's landing point, and gives
          a keyboard user something to focus before pressing Page Down — a
          scroll container that cannot take focus cannot be scrolled from
          the keyboard alone. `live.tsx` also hands focus here when the
          new-messages pill is dismissed, which is why it is worth naming:
          focus landing on an unlabelled <main> announces only "main".
        */}
        <main
          id={SCROLLER_ID}
          tabIndex={-1}
          aria-label={title}
          aria-busy={busy || undefined}
          className="min-h-0 flex-1 overflow-y-auto outline-none"
        >
          {/*
            `page-enter` is a 180ms fade and 4px rise, played when the column
            mounts — that is, when you arrive, and when a skeleton is replaced
            by the page. A `router.refresh()` does not remount it, so new mail
            arriving never makes the page you are reading flicker. Off under
            `prefers-reduced-motion`. See globals.css.
          */}
          <div
            className={cn(
              'page-enter mx-auto flex min-h-full w-full flex-col px-5 py-7 md:px-10 md:py-10',
              measure,
            )}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

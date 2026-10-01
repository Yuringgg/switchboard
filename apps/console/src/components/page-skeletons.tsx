import { cn } from '@/lib/utils';

/**
 * Skeletons for the routes' `loading.tsx` files (ADR-031), for the pages that
 * did not already have one.
 *
 * The rule every skeleton in this console follows: the same geometry as what
 * replaces it. A skeleton shaped differently from the page that lands reads as
 * the page loading twice, which is worse than no skeleton at all.
 *
 * The timeline, contacts, search and channels skeletons live beside their
 * components and are reused as they are.
 */

/**
 * Matches the shape of a loaded attention board so the page does not jump
 * when it lands.
 *
 * ⚠ Three columns, not a stack of rows. It was the latter until the board
 * landed, and a skeleton whose geometry does not match what replaces it
 * produces exactly the visible jump the streaming boundary exists to avoid —
 * which is worse than no skeleton, because it reads as the page loading twice.
 */
export function BoardSkeleton() {
  return (
    <div className="grid gap-x-5 gap-y-8 md:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((column) => (
        <div key={column}>
          <div className="flex items-baseline gap-2 border-b border-border pb-2.5">
            <span className="h-2.5 w-20 rounded bg-faint/60" />
            <span className="ml-auto h-2.5 w-4 rounded bg-faint/40" />
          </div>

          <div className="mt-3 animate-pulse space-y-2.5">
            {[0, 1].map((card) => (
              <div
                key={card}
                className="rounded-lg border border-border bg-panel p-3.5"
              >
                <span className="block h-2.5 w-16 rounded bg-faint/60" />
                <span className="mt-2.5 block h-3 w-3/4 rounded bg-faint/60" />
                <span className="mt-2.5 block h-2.5 w-full rounded bg-faint/40" />
                <span className="mt-1.5 block h-2.5 w-2/3 rounded bg-faint/40" />
              </div>
            ))}
          </div>
        </div>
      ))}

      <span className="sr-only">Loading the board</span>
    </div>
  );
}

/**
 * The search field, its button and the filter row, for the moment before the
 * channel list has arrived.
 *
 * ⚠ The search page's own boundary used to fall back to NOTHING here, so the
 * prompt below rendered first and was then pushed down by the form landing on
 * top of it. Both that boundary and `search/loading.tsx` use this now, so the
 * field holds its place from the click until it is ready to type into.
 */
export function SearchControlsSkeleton() {
  return (
    <div className="mb-6" aria-hidden>
      <div className="flex gap-2">
        <span className="h-9 min-w-0 flex-1 rounded-md border border-border bg-panel" />
        <span className="h-9 w-20 animate-pulse rounded-md bg-faint/50" />
      </div>
      <div className="mt-3 flex animate-pulse gap-1.5">
        {['w-16', 'w-20', 'w-24'].map((width) => (
          <span key={width} className={cn('h-7 rounded-md bg-faint/40', width)} />
        ))}
      </div>
    </div>
  );
}

/**
 * The Files screen: the folder column and the file rows, the same grid
 * `FileLibrary` uses, so the folders do not slide in from the side.
 */
export function FilesSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10" aria-hidden>
      <div className="-mx-1 flex gap-1 overflow-hidden px-1 md:mx-0 md:block md:space-y-1.5 md:px-0">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              'block h-8 shrink-0 animate-pulse rounded-md bg-faint/40',
              i === 0 ? 'w-24 md:w-full md:bg-faint/60' : 'w-20 md:w-4/5',
            )}
          />
        ))}
      </div>

      <div className="min-w-0 animate-pulse">
        {/* "All files · 7 items" — the label `FileLibrary` puts over the rows. */}
        <span className="mb-3 block h-2.5 w-28 rounded bg-faint/50" />
        <ul className="border-t border-border">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-start gap-3 border-b border-border px-1 py-3">
              <span className="size-7 shrink-0 rounded-md bg-faint/50" />
              <div className="min-w-0 flex-1">
                <span className="mt-0.5 block h-3.5 w-1/2 rounded bg-faint/60" />
                <span className="mt-2 block h-2.5 w-1/3 rounded bg-faint/40" />
              </div>
              <span className="mt-0.5 h-2.5 w-10 rounded bg-faint/40" />
            </li>
          ))}
        </ul>
      </div>

      <span className="sr-only">Loading files</span>
    </div>
  );
}

/**
 * One message, or one person: a heading block and a body. Used where the page
 * is a single record rather than a list.
 */
export function DetailSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden>
      <span className="block h-3 w-24 rounded bg-faint/40" />
      <span className="mt-3 block h-5 w-2/3 rounded bg-faint/60" />
      <span className="mt-3 block h-3 w-1/3 rounded bg-faint/40" />

      <div className="mt-8 space-y-2.5 border-t border-border pt-6">
        {['w-full', 'w-11/12', 'w-full', 'w-4/5', 'w-2/3'].map((width, i) => (
          <span key={i} className={cn('block h-3 rounded bg-faint/50', width)} />
        ))}
      </div>

      <span className="sr-only">Loading</span>
    </div>
  );
}

/**
 * The assistant's stage: Uriel's place on the left, the composer on the right
 * — the same grid as `VoiceCall`, so the orb lands where its outline was.
 */
export function AssistantSkeleton() {
  return (
    <div className="py-4" aria-hidden>
      <div className="grid items-start gap-8 lg:grid-cols-[1.45fr_1fr] lg:gap-10">
        <div className="flex flex-col items-center">
          <span className="size-60 rounded-full border border-border bg-faint/10 sm:size-72 lg:size-80" />
          <span className="mt-6 block h-9 w-36 animate-pulse rounded-md bg-faint/40" />
        </div>
        <div className="animate-pulse">
          <span className="block h-[4.5rem] w-full rounded-lg border border-border bg-panel" />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {['w-44', 'w-56', 'w-40'].map((width) => (
              <span key={width} className={cn('h-7 rounded-full bg-faint/40', width)} />
            ))}
          </div>
        </div>
      </div>

      <span className="sr-only">Loading</span>
    </div>
  );
}

/**
 * A form or a panel: the assistant, meetings, the voice lab. Two blocks — a
 * control area and what sits under it.
 */
export function PanelSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden>
      <div className="rounded-lg border border-border bg-panel p-5">
        <span className="block h-3 w-28 rounded bg-faint/60" />
        <span className="mt-4 block h-9 w-full rounded-md bg-faint/40" />
        <span className="mt-3 block h-8 w-32 rounded-md bg-faint/50" />
      </div>
      <div className="space-y-2.5">
        <span className="block h-3 w-20 rounded bg-faint/40" />
        <span className="block h-3 w-3/4 rounded bg-faint/50" />
        <span className="block h-3 w-1/2 rounded bg-faint/40" />
      </div>

      <span className="sr-only">Loading</span>
    </div>
  );
}

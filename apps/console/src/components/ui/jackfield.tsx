import { cn } from '@/lib/utils';

/**
 * The jack field: a faint grid of patch-bay sockets under one overhead light.
 *
 * Behind the console's record (with the flowing lines crossing it — see
 * `ConsoleBackdrop`), the auth screens and the landing hero. The rules and the
 * reasoning live with the CSS, under THE JACK FIELD in `app/globals.css`; this
 * component is only the three layers they style.
 *
 * ⚠ A server component with no imports from `flowing-paths.tsx` — that file
 * imports this one, and the reverse would be a cycle.
 *
 * ⚠ Called a "jack field", never a "board": on this console the board is
 * `/attention` and "the board is live" is what the amber lamp means.
 */
const SURFACE = {
  console: 'jackfield jackfield--console',
  hero: 'jackfield jackfield--hero',
  aside: 'jackfield jackfield--aside',
  form: 'jackfield jackfield--form',
} as const;

export function Jackfield({
  surface,
  className,
}: {
  surface: keyof typeof SURFACE;
  className?: string;
}) {
  return (
    // `aria-hidden`: wallpaper. A screen reader has nothing to learn from it.
    <div aria-hidden className={cn(SURFACE[surface], className)}>
      <div className="jackfield__light" />
      <div className="jackfield__fade">
        <div className="jackfield__field" />
      </div>
    </div>
  );
}

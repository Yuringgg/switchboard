import { Brand } from '@/components/brand';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The flowing lines behind the auth screens.
 *
 * ── What was taken, and what was rebuilt ─────────────────────────────────────
 *
 * The composition is the supplied `FloatingPaths` component's: two mirrored
 * families of long sweeping curves, generated from one formula, each a little
 * offset and a little thicker than the last. The formula below is kept
 * verbatim — that shape is the idea worth having, and it is not something to
 * re-derive by eye.
 *
 * Everything driving it is different:
 *
 * **1. No framer-motion.** The original made each path a `motion.path`
 * animating `pathLength` and `pathOffset`. That is 72 elements written on every
 * frame from JavaScript, on the first screen a visitor sees — and it does not
 * run at all where there is no `requestAnimationFrame`, which includes this
 * project's own browser pane and any headless render. `stroke-dashoffset` on a
 * `pathLength="100"` path is the same effect owned by the compositor.
 *
 * **2. It works in both schemes off one declaration.** The original stroked
 * `rgba(15,23,42,…)` and then patched it with `dark:text-white`. Here the
 * stroke is `currentColor` and the container is `text-foreground`, so the lines
 * are dark on the light panel and light on the dark one with nothing
 * conditional anywhere. That is what Yuri asked for: the same flowing thing in
 * either mode.
 *
 * **3. It cannot render empty.** At rest each path keeps a visible 24-unit arc,
 * so reduced motion and a hidden tab both get a composition rather than a blank
 * rectangle.
 *
 * ⚠ `aria-hidden`, and the panel's real content sits beside it in the tree —
 * this is wallpaper, and a screen reader counting 72 curves learns nothing.
 */

const VIEWBOX = { width: 696, height: 316 };

/** Kept from the source. `position` mirrors the family across the panel. */
function paths(position: number) {
  return Array.from({ length: 36 }, (_, i) => ({
    id: `${position}-${i}`,
    d:
      `M-${380 - i * 5 * position} -${189 + i * 6}` +
      `C-${380 - i * 5 * position} -${189 + i * 6} ` +
      `-${312 - i * 5 * position} ${216 - i * 6} ` +
      `${152 - i * 5 * position} ${343 - i * 6}` +
      `C${616 - i * 5 * position} ${470 - i * 6} ` +
      `${684 - i * 5 * position} ${875 - i * 6} ` +
      `${684 - i * 5 * position} ${875 - i * 6}`,
    width: 0.5 + i * 0.03,
    // ⚠ Capped. The source's `0.1 + i * 0.03` reaches 1.15 by the last path,
    // which is not a legal opacity and clamps — so the final third of the fan
    // all rendered at full strength and the depth the ramp exists to create
    // flattened out at exactly the point it should have been strongest.
    opacity: Math.min(0.1 + i * 0.022, 0.62),
    duration: 20 + (i % 7) * 4,
    delay: (i * 1.7) % 24,
  }));
}

export function FlowingPaths({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 text-foreground', className)}
    >
      <svg
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        // The panel is far taller than the viewBox is; letting it fill and crop
        // is what makes the curves read as passing THROUGH rather than as a
        // diagram sitting in a box.
        preserveAspectRatio="xMidYMid slice"
        className="size-full"
        fill="none"
      >
        {[1, -1].flatMap((position) =>
          paths(position).map((path) => (
            <path
              key={path.id}
              d={path.d}
              pathLength="100"
              stroke="currentColor"
              strokeWidth={path.width}
              strokeOpacity={path.opacity}
              style={
                {
                  '--flow-duration': path.duration,
                  '--flow-delay': path.delay,
                } as React.CSSProperties
              }
              className="animate-path-flow"
            />
          )),
        )}
      </svg>
    </div>
  );
}

/**
 * The left panel: the lines, the mark, and one true sentence.
 *
 * ⚠ The source had a testimonial — *"This Platform has helped me to save time
 * and serve my clients faster than ever before." ~ Ali Hassan.* There is no Ali
 * Hassan. Shipping an invented endorsement on a real product's login page is
 * not a placeholder to fill in later; it is a false claim about a person, and
 * on a project being submitted for assessment it is the kind of thing that
 * costs more than it could ever gain. Replaced with a statement about the
 * product that is simply true.
 *
 * `hidden lg:flex` at the call site — on a phone this would push the form the
 * visitor came for below the fold.
 */
export function AuthAside() {
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-panel p-10 lg:flex">
      <FlowingPaths />

      {/* Fades the lines out under the text so the copy never has to compete
          with a stroke passing behind it. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-panel via-panel/70 to-transparent"
      />

      <div className="relative z-10">
        <Brand size="lg" />
      </div>

      <div className="relative z-10 max-w-[36ch]">
        <p className="text-2xl leading-snug font-medium text-balance">
          Many lines in, one operator&rsquo;s view out.
        </p>
        <p className={cn(LABEL, 'mt-4 normal-case')}>
          Gmail and WhatsApp arrive in one ordered record. A model reads each one
          as it lands and shows you the sentence it read.
        </p>
      </div>
    </aside>
  );
}

/**
 * The soft light behind the form column, so the right-hand side is not a flat
 * field of background colour.
 *
 * ⚠ `-z-10` and `contain: strict`. Without containment these are three large
 * blurred gradients that the browser will happily re-rasterise on every scroll
 * of the page behind them.
 */
export function AuthGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 isolate opacity-70 [contain:strict]"
    >
      <div className="auth-glow absolute -top-40 -right-24 h-[38rem] w-[26rem] rounded-full" />
      <div className="auth-glow absolute top-1/3 -left-32 h-[30rem] w-[22rem] rounded-full" />
      <div className="auth-glow absolute -bottom-40 right-1/4 h-[26rem] w-[30rem] rounded-full" />
    </div>
  );
}

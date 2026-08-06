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

/**
 * Two intensities, and the difference is not taste.
 *
 * `panel` is the auth screens: a decorative surface with one heading and one
 * sentence on it, so the lines can carry real weight.
 *
 * `ambient` is behind the console's own pages, where the same lines sit under
 * **dense body text**. See `ConsoleBackdrop` for the measured reason the
 * opacity caps are what they are, and why dark is so much lower than light.
 *
 * ── ⚠ Why `ambient` needs a wider frame AND a mirrored family ────────────────
 *
 * The console's backdrop first shipped with 14 curves per family through the
 * panel's own `0 0 696 316` box, and Yuri reported the lines only appearing at
 * the bottom. Measured rather than adjusted by eye — the visible field divided
 * into a 4×4 grid, counting strokes through each cell — and the report was
 * exactly right:
 *
 *     0   0   0   0        ← the whole top row, empty
 *    10   6   3   0
 *    28  15  13   7
 *    46  36  16  16        ← everything piled into one corner
 *
 * **Density alone does not fix that.** Raising the count to 36 filled the same
 * corner harder. The curves simply run from upper-left to lower-right, and the
 * panel's narrow box crops to the part of that sweep which has already
 * descended — fine on a tall column beside a login form, wrong on a wide page.
 *
 * Two changes, both measured:
 *
 * **A wider frame** so the crop lands on the middle of the fan rather than its
 * tail. Six candidates were tried in the live DOM; this one had the best
 * spread.
 *
 * **A vertically mirrored second family.** ⚠ The source mirrors with
 * `position: ±1`, which flips X only — so both families still descend the same
 * way and the field keeps one diagonal band with two empty corners. Rotating
 * 180° does nothing either: it maps a diagonal onto itself. Flipping Y turns
 * the second family into an ASCENDING sweep, and the two together cross.
 *
 * Result on the same grid: **1 empty cell out of 16**, down from 5, with the
 * top row populated. `panel` is untouched — its narrow crop is the composition
 * the source was designed around and it looks right on that column.
 */
const TONE = {
  panel: {
    count: 36,
    maxOpacity: 0.62,
    step: 0.022,
    base: 0.1,
    speed: 1,
    viewBox: '0 0 696 316',
    strokeScale: 1,
    mirror: false,
  },
  ambient: {
    count: 36,
    maxOpacity: 0.12,
    step: 0.0042,
    base: 0.03,
    speed: 2.4,
    // See `mirror` below for why the frame had to widen with it.
    viewBox: '-200 -100 1000 800',
    // ⚠ Stroke width is in viewBox units, so a wider frame renders every line
    // thinner. The old box scaled 2.28× into the content area and this one
    // scales 1.02×, so 2.2 reproduces the previous on-screen weight almost
    // exactly. Change one of these and you must change the other.
    strokeScale: 2.2,
    mirror: true,
  },
} as const;

type Tone = keyof typeof TONE;

/** Kept from the source. `position` mirrors the family across the panel. */
function paths(position: number, tone: Tone) {
  const { count, maxOpacity, step, base, speed, strokeScale } = TONE[tone];

  return Array.from({ length: count }, (_, i) => ({
    id: `${position}-${i}`,
    d:
      `M-${380 - i * 5 * position} -${189 + i * 6}` +
      `C-${380 - i * 5 * position} -${189 + i * 6} ` +
      `-${312 - i * 5 * position} ${216 - i * 6} ` +
      `${152 - i * 5 * position} ${343 - i * 6}` +
      `C${616 - i * 5 * position} ${470 - i * 6} ` +
      `${684 - i * 5 * position} ${875 - i * 6} ` +
      `${684 - i * 5 * position} ${875 - i * 6}`,
    width: (0.5 + i * 0.03) * strokeScale,
    // ⚠ Capped. The source's `0.1 + i * 0.03` reaches 1.15 by the last path,
    // which is not a legal opacity and clamps — so the final third of the fan
    // all rendered at full strength and the depth the ramp exists to create
    // flattened out at exactly the point it should have been strongest.
    opacity: Math.min(base + i * step, maxOpacity),
    duration: (20 + (i % 7) * 4) * speed,
    delay: (i * 1.7) % 24,
  }));
}

export function FlowingPaths({
  tone = 'panel',
  className,
}: {
  tone?: Tone;
  className?: string;
}) {
  const { viewBox, mirror } = TONE[tone];

  // The vertical mirror line: the centre of the viewBox. `matrix(1 0 0 -1 0 2cy)`
  // is a flip about y = cy.
  const [, vy, , vh] = viewBox.split(' ').map(Number);
  const flip = `matrix(1 0 0 -1 0 ${vy! * 2 + vh!})`;

  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 text-foreground', className)}
    >
      <svg
        viewBox={viewBox}
        // The container is a different shape from the viewBox; letting it fill
        // and crop is what makes the curves read as passing THROUGH rather than
        // as a diagram sitting in a box.
        preserveAspectRatio="xMidYMid slice"
        className="size-full"
        fill="none"
      >
        {[1, -1].map((position) => (
          <g
            key={position}
            // ⚠ Only the second family, and only where the tone asks for it.
            // Mirroring both would just move the empty corners.
            transform={mirror && position === -1 ? flip : undefined}
          >
            {paths(position, tone).map((path) => (
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
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * The same lines behind the console's own pages (Yuri, 2026-08-06).
 *
 * ── ⚠ Why it is far fainter here, with numbers ──────────────────────────────
 *
 * The auth panel carries one heading and one sentence. These pages carry a
 * timeline of 14px body text, and a line passing behind a glyph composites into
 * its background — which is a contrast reduction WCAG has no clean way to
 * express and a reader notices immediately.
 *
 * Worked from the tokens, for a line at opacity `a` over the page background,
 * under `--muted-foreground` (the quietest text the console permits):
 *
 * | scheme | line opacity | effective contrast |
 * |---|---|---|
 * | dark | 0.12 | **2.8 : 1** — fails |
 * | dark | 0.045 | **4.1 : 1** — fails |
 * | dark | 0.03 | 4.8 : 1 — passes |
 * | light | 0.12 | 6.5 : 1 — passes |
 *
 * Light-on-dark washes out far faster than dark-on-light, which is why the two
 * schemes cannot share one cap. The ramp tops out at 0.12 and the container is
 * scaled to a quarter of that in dark — 0.03 — which is the largest value that
 * still clears AA where a stroke crosses behind the faintest text on the page.
 * **Do not raise `dark:opacity-25` to make the effect more visible.** It is
 * sized to a measurement, and it is verified in the DOM rather than by eye.
 *
 * ⚠ The COUNT is not part of that budget and was wrongly cut once. Thinning to
 * 14 curves per family made the field mostly empty — two strokes in a corner —
 * which is what Yuri reported. It draws the full 36 per family now, the same as
 * the sign-in panel, and only the opacity is held down. The animations run at
 * 2.4× the duration instead, which costs nothing and suits a backdrop somebody
 * works in front of all day.
 *
 * ⚠ NOT in the sidebar. Yuri asked for the pages, not the frame, and the frame
 * is the right call anyway — the rail and the header are `--panel`, the surface
 * that reads as *the instrument*, and texturing it would undo the
 * frame-versus-record distinction the whole console is built on.
 */
export function ConsoleBackdrop() {
  return (
    <FlowingPaths
      tone="ambient"
      // ⚠ `-z-10` works only because the parent carries `isolate`. Without a
      // stacking context between here and the root, a negative z-index paints
      // behind the ROOT's background — which is opaque — and the backdrop
      // vanishes entirely with nothing to debug.
      //
      // The alternative, plain `z-0`, is worse: a positioned element paints
      // above non-positioned in-flow content at the same level, so the lines
      // would render over the header's own background.
      className="-z-10 opacity-100 dark:opacity-25"
    />
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

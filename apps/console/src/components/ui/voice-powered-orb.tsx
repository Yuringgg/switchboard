'use client';

import { Geometry, Mesh, Program, Renderer } from 'ogl';
import { useEffect, useMemo, useRef, type FC } from 'react';

import { cn } from '@/lib/utils';

/**
 * Uriel — a constellation of gold triangles in the shape of a sphere.
 *
 * ── What this is, and what it replaced ──────────────────────────────────────
 *
 * A fullscreen fragment shader painting one glowing ball, twice: purple, then
 * gold. Both read as gas. Yuri's references are the opposite idea —
 * **thousands of tiny outlined triangles** arranged into a shape and floating
 * on black, lit from a white-hot centre out through gold to a cooling rim.
 * Light as distributed points rather than one lit mass.
 *
 * You cannot get that from a fragment shader. A shader colours pixels; it has
 * no notion of a particle, so "three thousand triangles" would mean testing
 * every pixel against every triangle, every frame. So this draws real geometry:
 * one vertex per particle, rendered as a point sprite, with the triangle cut
 * out of the sprite in the fragment stage.
 *
 * ── How the sphere is made ──────────────────────────────────────────────────
 *
 * A **Fibonacci sphere** — each point placed at the golden angle from the last.
 * It is the standard way to scatter points evenly on a sphere without them
 * banding into rings, which is what naive latitude/longitude loops do. Jitter
 * goes on top, because a perfectly even shell reads as a machine-made lattice
 * and the reference reads as a swarm that happens to hold a shape.
 *
 * ── ⚠ The parts that are easy to get wrong ──────────────────────────────────
 *
 * · **The buffers are built once.** Rebuilding three thousand particles on
 *   every render is a stutter you can see.
 * · **`level` and `hue` reach the loop through refs**, never the dependency
 *   array. They change many times a second while somebody talks, and in the
 *   array they would tear down the WebGL context on every audio frame — a
 *   flicker, and a fast way to exhaust the browser's context limit.
 * · **Drawing stops when the tab is hidden.** This runs for as long as anyone
 *   has `/assistant` open, not only during a call.
 * · **It degrades instead of disappearing.** WebGL is genuinely absent in
 *   headless renderers and in this project's browser pane, and this is the
 *   centre of the screen.
 */

interface VoicePoweredOrbProps {
  className?: string;
  /** How loud, 0 to 1. Expands the shell, brightens it, and speeds the turn. */
  level?: number;
  /** Colour rotation in degrees, for tinting who is speaking. */
  hue?: number;
  /**
   * Keep turning gently when no voice is driving it.
   *
   * ⚠ This is why the orb can sit on screen before a call starts. A voice
   * product whose voice only appears once you have already committed to it
   * gives you nothing to commit to.
   */
  idle?: boolean;
  /** Drawn when WebGL is unavailable. */
  fallback?: React.ReactNode;
}

/** Packed near the centre, so the sphere is lit from inside rather than hollow. */
const CORE_COUNT = 520;
/** On the shell. Enough to read as a surface, few enough to stay smooth. */
const SHELL_COUNT = 2600;
/** Drifting around it, so the sphere sits in a field rather than on a plate. */
const AMBIENT_COUNT = 700;

/**
 * ⚠ COLOUR IS A FUNCTION OF RADIUS, NOT A RANDOM PICK.
 *
 * The first reference is lit from a white-hot centre outward — pale gold, then
 * gold, then amber, then bronze at the edge where the light runs out. Assigning
 * each particle a random colour from a palette throws that away and produces an
 * evenly-speckled ball, which is what the Dala version was and why it read as a
 * different image entirely.
 *
 * So the gradient below is the picture. A particle's distance from the centre
 * decides its colour, and the constellation inherits the reference's structure
 * rather than only its hues.
 */
const GRADIENT: { at: number; rgb: [number, number, number] }[] = [
  { at: 0.0, rgb: [1.0, 0.98, 0.91] }, //  the core, near white
  { at: 0.35, rgb: [1.0, 0.89, 0.53] }, // pale gold
  { at: 0.7, rgb: [1.0, 0.75, 0.24] }, //  gold
  { at: 1.0, rgb: [0.93, 0.52, 0.09] }, // amber, at the shell
  { at: 1.6, rgb: [0.42, 0.22, 0.05] }, // bronze, fading out
];

/**
 * The green at the rim.
 *
 * ⚠ Sparse and outer-only. The reference has it at the edges where the gold
 * cools, and nowhere near the middle — scattered evenly it stops reading as
 * temperature and starts reading as a second brand colour.
 */
const RIM_TEAL: [number, number, number] = [0.18, 0.62, 0.54];

type Stop = { at: number; rgb: [number, number, number] };

function colorAtRadius(r: number, gradient: Stop[] = GRADIENT): [number, number, number] {
  if (r <= gradient[0]!.at) return gradient[0]!.rgb;

  for (let i = 1; i < gradient.length; i += 1) {
    const hi = gradient[i]!;
    if (r > hi.at) continue;
    const lo = gradient[i - 1]!;
    const t = (r - lo.at) / (hi.at - lo.at);
    return [
      lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * t,
      lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * t,
      lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * t,
    ];
  }

  return gradient[gradient.length - 1]!.rgb;
}

/**
 * ── Uriel in LIGHT mode: graphite ───────────────────────────────────────────
 *
 * The gradient above is a light source: white-hot core, gold, amber, bronze,
 * drawn on black. On the light scheme's near-white page it inverted badly —
 * the white core vanished into the page (a hole where the light should be),
 * the bronze rim became a scatter of dark specks, and thousands of sharp
 * orange triangles at full strength read as a busy, glittering pattern that is
 * tiring to look at. Yuri's words: "really bright and pointy".
 *
 * On paper, light does not glow; density does the work. So the light scheme
 * has its OWN palette and drawing: the console's own ink (the cool near-black
 * of `--foreground`), darkest at the core where the particles are thickest,
 * softer at the rim, the triangles' points rounded a little, less alpha, no
 * bloom, and the drifting field outside the sphere held back hardest — it was
 * the "pointy" part. The dark scheme is untouched: it is the gold version Yuri
 * approved, and the shader mixes between the two by the `light` uniform.
 *
 * Chosen by Yuri on 2026-09-27 from three rendered candidates — muted brass
 * triangles, this graphite, and soft gold dots — for blending into the light
 * console completely rather than standing out of it.
 *
 * ⚠ The trade that came with it: the hue shift that marks who is speaking
 * (`hue`, rotated 200° while Uriel talks) is nearly invisible on ink this
 * neutral. The status line under the orb still says "Speaking" / "Listening"
 * in words, which was always the accessible carrier; do not add colour back
 * here to restore the cue without asking — neutrality was the point.
 */
const LIGHT_GRADIENT: Stop[] = [
  { at: 0.0, rgb: [0.12, 0.14, 0.19] },
  { at: 1.0, rgb: [0.18, 0.2, 0.26] },
  { at: 1.6, rgb: [0.42, 0.45, 0.5] },
];

/** The rim's sparse green, cooled and darkened to sit in graphite. */
const LIGHT_RIM: [number, number, number] = [0.22, 0.38, 0.42];

/** The light scheme's drawing, as shader uniforms. None of it reaches dark. */
const LIGHT_DRAW = {
  /** 0 = the dark scheme's triangle, 1 = a circle. A little rounder. */
  shape: 0.25,
  /** The outline's soft edge; the dark scheme's is 0.26. */
  stroke: 0.28,
  /** Multiplies every particle's alpha. */
  alpha: 0.85,
  /** Multiplies the halo. On a light page it only adds haze. */
  bloom: 0,
  /** Further alpha for the drifting field outside the sphere. */
  ambient: 0.5,
} as const;

function buildParticles() {
  const total = CORE_COUNT + SHELL_COUNT + AMBIENT_COUNT;
  const position = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
  // The same particles' colours on the light scheme. Both are uploaded once and
  // the shader mixes between them, so switching theme never rebuilds anything.
  const colorLight = new Float32Array(total * 3);
  const seed = new Float32Array(total);
  const scale = new Float32Array(total);

  // The golden angle. Successive points land maximally out of step with each
  // other, which is what stops them banding into visible rings.
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < total; i += 1) {
    const core = i < CORE_COUNT;
    const shell = !core && i < CORE_COUNT + SHELL_COUNT;

    let x: number;
    let y: number;
    let z: number;

    if (shell) {
      const index = i - CORE_COUNT;
      const t = index / (SHELL_COUNT - 1);
      y = 1 - t * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * index;
      x = Math.cos(theta) * ring;
      z = Math.sin(theta) * ring;

      // Roughen the shell. A perfect sphere reads as a wireframe globe.
      const jitter = 0.055;
      x += (Math.random() - 0.5) * jitter;
      y += (Math.random() - 0.5) * jitter;
      z += (Math.random() - 0.5) * jitter;
    } else {
      // A direction, then a radius — inside for the core, outside for ambient.
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0, 1 - u * u));
      /*
       * ⚠ The cube root is not decoration. Picking a uniform radius crowds
       * every point near the surface of the little sphere and leaves the middle
       * empty — the opposite of a core. This distributes them through the
       * volume so the centre is genuinely the densest part.
       */
      const radius = core
        ? Math.cbrt(Math.random()) * 0.42
        : 1.25 + Math.random() * 1.15;
      x = Math.cos(phi) * ring * radius;
      y = u * radius;
      z = Math.sin(phi) * ring * radius;
    }

    position[i * 3] = x;
    position[i * 3 + 1] = y;
    position[i * 3 + 2] = z;

    const r = Math.sqrt(x * x + y * y + z * z);
    let rgb = colorAtRadius(r);
    let lightRgb = colorAtRadius(r, LIGHT_GRADIENT);

    // The rim's green, only out past the shell, and only sometimes.
    if (r > 1.05 && Math.random() > 0.86) {
      rgb = RIM_TEAL;
      lightRgb = LIGHT_RIM;
    }
    // A rare white spark anywhere, so the field has highlights rather than a
    // perfectly smooth ramp. Dark scheme only: on a white page a white spark
    // is a hole.
    else if (Math.random() > 0.975) rgb = [1.0, 0.99, 0.94];

    color[i * 3] = rgb[0];
    color[i * 3 + 1] = rgb[1];
    color[i * 3 + 2] = rgb[2];
    colorLight[i * 3] = lightRgb[0];
    colorLight[i * 3 + 1] = lightRgb[1];
    colorLight[i * 3 + 2] = lightRgb[2];

    seed[i] = Math.random();
    // Core particles are small and dense; ambient ones small and sparse; the
    // shell carries the readable triangles.
    scale[i] = core
      ? 3.0 + Math.random() * 2.0
      : shell
        ? 5.0 + Math.random() * 3.0
        : 3.2 + Math.random() * 1.6;
  }

  return { position, color, colorLight, seed, scale };
}

const vert = /* glsl */ `
  precision highp float;

  attribute vec3 position;
  attribute vec3 color;
  attribute vec3 colorLight;
  attribute float seed;
  attribute float scale;

  uniform float iTime;
  uniform float level;
  uniform float rot;
  uniform float dpr;
  uniform vec2 iResolution;
  // 0 on the dark scheme, 1 on light, eased between when the theme changes.
  uniform float light;

  varying vec3 vColor;
  varying float vFade;
  // 1 for the drifting field outside the sphere, 0 for the sphere itself.
  varying float vAmbient;

  void main() {
    // Spin around Y, then tilt slowly around X so the shape never presents the
    // same silhouette twice.
    float c = cos(rot);
    float s = sin(rot);
    vec3 p = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);

    float t = 0.22 * sin(iTime * 0.13);
    float ct = cos(t);
    float st = sin(t);
    p = vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);

    // Breathe. The voice pushes the shell outward; the small term keeps it
    // alive when nobody is speaking.
    p *= 1.0 + level * 0.14 + 0.02 * sin(iTime * 0.7 + seed * 6.2831);

    // 0 at the back, 1 at the front. Drives both size and fade, which is what
    // turns a flat scatter into something with a near side and a far side.
    float depth = clamp((p.z + 1.8) / 3.6, 0.0, 1.0);
    vFade = 0.18 + depth * 0.82;
    vColor = mix(color, colorLight, light);
    vAmbient = step(1.2, length(position));

    // Correct for a non-square canvas, or the sphere renders as an ellipse.
    float aspect = iResolution.x / max(iResolution.y, 1.0);
    vec2 xy = vec2(p.x / max(aspect, 0.0001), p.y) * 0.58;

    gl_Position = vec4(xy, 0.0, 1.0);
    gl_PointSize = scale * dpr * (0.55 + depth * 0.95) * (1.0 + level * 0.45);
  }
`;

const frag = /* glsl */ `
  precision highp float;

  uniform float level;
  uniform float hue;
  uniform float light;
  // The light scheme's drawing — see LIGHT_DRAW. None of these touch the
  // dark scheme: every one is mixed in by \`light\`.
  uniform float uShape;
  uniform float uStroke;
  uniform float uAlpha;
  uniform float uBloom;
  uniform float uAmbient;

  varying vec3 vColor;
  varying float vFade;
  varying float vAmbient;

  vec3 rgb2yiq(vec3 c) {
    return vec3(
      dot(c, vec3(0.299, 0.587, 0.114)),
      dot(c, vec3(0.596, -0.274, -0.322)),
      dot(c, vec3(0.211, -0.523, 0.312))
    );
  }

  vec3 yiq2rgb(vec3 c) {
    return vec3(
      c.x + 0.956 * c.y + 0.621 * c.z,
      c.x - 0.272 * c.y - 0.647 * c.z,
      c.x - 1.106 * c.y + 1.703 * c.z
    );
  }

  vec3 adjustHue(vec3 col, float deg) {
    float r = deg * 3.14159265 / 180.0;
    vec3 y = rgb2yiq(col);
    float ca = cos(r);
    float sa = sin(r);
    return yiq2rgb(vec3(y.x, y.y * ca - y.z * sa, y.y * sa + y.z * ca));
  }

  // Signed distance to an equilateral triangle. Negative inside, positive out.
  float sdTriangle(vec2 p, float r) {
    const float k = 1.7320508;
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) {
      p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    }
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }

  void main() {
    // Point sprite coordinates run 0..1 with y downward.
    vec2 p = (gl_PointCoord - 0.5) * 2.2;
    p.y = -p.y;

    // On light the triangle can round off toward a circle — the points are
    // what read as "pointy" on a bright page.
    float d = mix(sdTriangle(p, 0.85), length(p) - 0.62, uShape * light);

    /*
     * ⚠ OUTLINED, not filled, on the dark scheme. The reference is explicit:
     * 1-2px stroked triangles. Filling them turns the constellation into
     * confetti and loses the drawn, technical quality entirely.
     */
    float edge = 1.0 - smoothstep(0.0, mix(0.26, uStroke, light), abs(d));
    // A little bloom outside the stroke, so a dense cluster glows rather than
    // reading as a mesh. On a light page there is nothing to glow against, and
    // it only adds haze.
    float bloom = exp(-4.0 * max(d, 0.0)) * 0.3 * mix(1.0, uBloom, light);

    float alpha = (edge + bloom) * vFade;
    alpha *= mix(1.0, uAlpha * mix(1.0, uAmbient, vAmbient), light);
    if (alpha < 0.012) discard;

    // Louder speech brightens the particles on dark. On light, brightening
    // moves them toward the page and they fade out as Uriel talks, so the
    // colour holds and the size and alpha carry the level instead.
    float gain = mix(0.85 + level * 0.7, 1.0, light);
    alpha *= mix(1.0, 1.0 + level * 0.35, light);
    vec3 col = adjustHue(vColor, hue) * gain;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

export const VoicePoweredOrb: FC<VoicePoweredOrbProps> = ({
  className,
  level = 0,
  hue = 0,
  idle = false,
  fallback = null,
}) => {
  const ctnDom = useRef<HTMLDivElement>(null);
  const fallbackDom = useRef<HTMLDivElement>(null);

  // Built once. Three thousand particles rebuilt per render is a visible stutter.
  const particles = useMemo(buildParticles, []);

  const levelRef = useRef(level);
  const hueRef = useRef(hue);
  const idleRef = useRef(idle);
  levelRef.current = level;
  hueRef.current = hue;
  idleRef.current = idle;

  useEffect(() => {
    const container = ctnDom.current;
    if (!container) return;

    /*
     * ⚠ Reduced motion is honoured in JavaScript, because the global rule in
     * `globals.css` only reaches CSS animations — a render loop would spin
     * straight through it. The constellation still DRAWS, it simply stops
     * turning. Hiding it would remove the centre of the screen.
     */
    const reduceMotion = Boolean(
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    );

    let renderer: Renderer;
    let gl: Renderer['gl'];

    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        dpr: window.devicePixelRatio || 1,
      });
      gl = renderer.gl;
    } catch {
      if (fallbackDom.current) fallbackDom.current.hidden = false;
      return;
    }

    const canvas = gl.canvas;
    if (!(canvas instanceof HTMLCanvasElement)) {
      if (fallbackDom.current) fallbackDom.current.hidden = false;
      return;
    }

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    /*
     * ⚠ Depth testing OFF. These are transparent sprites drawn in buffer order;
     * a depth test would let a near particle write depth and punch a hole in
     * everything behind it. `vFade` carries the depth cue instead.
     */
    gl.disable(gl.DEPTH_TEST);
    container.appendChild(canvas);

    const geometry = new Geometry(gl, {
      position: { size: 3, data: particles.position },
      color: { size: 3, data: particles.color },
      colorLight: { size: 3, data: particles.colorLight },
      seed: { size: 1, data: particles.seed },
      scale: { size: 1, data: particles.scale },
    });

    /*
     * Which scheme is showing. `lib/theme.ts` writes `.dark` on <html> and is
     * the only thing that does, so that class is the truth — including for
     * "system", which it has already resolved. Watched rather than read once:
     * the toggle is on this same screen, and the orb must follow it live.
     */
    const readLight = () => (document.documentElement.classList.contains('dark') ? 0 : 1);
    let lightTarget = readLight();
    // Starts where it should be, then eases on a change rather than snapping.
    let lightMix = lightTarget;
    const themeWatch = new MutationObserver(() => {
      lightTarget = readLight();
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const program = new Program(gl, {
      vertex: vert,
      fragment: frag,
      transparent: true,
      depthTest: false,
      uniforms: {
        iTime: { value: 0 },
        level: { value: 0 },
        rot: { value: 0 },
        hue: { value: hue },
        dpr: { value: window.devicePixelRatio || 1 },
        iResolution: { value: [1, 1] },
        light: { value: lightMix },
        uShape: { value: LIGHT_DRAW.shape },
        uStroke: { value: LIGHT_DRAW.stroke },
        uAlpha: { value: LIGHT_DRAW.alpha },
        uBloom: { value: LIGHT_DRAW.bloom },
        uAmbient: { value: LIGHT_DRAW.ambient },
      },
    });

    const mesh = new Mesh(gl, { mode: gl.POINTS, geometry, program });

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;

      renderer.setSize(width * dpr, height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      program.uniforms.dpr.value = dpr;
      program.uniforms.iResolution.value = [canvas.width, canvas.height];
    };

    window.addEventListener('resize', resize);
    resize();

    let raf = 0;
    let lastTime = 0;
    let rot = 0;
    // The drawn level trails the reported one. Raw audio is spiky enough to
    // look like a fault rather than a response.
    let eased = 0;

    /*
     * ⚠ Stop drawing when the tab is hidden. This is on screen for as long as
     * somebody has `/assistant` open, and `requestAnimationFrame` throttling in
     * a background tab is a convention, not a guarantee.
     */
    let hidden = document.visibilityState === 'hidden';
    const onVisibility = () => {
      const nowHidden = document.visibilityState === 'hidden';
      // Reset the clock on resume, or the first frame back takes the whole
      // hidden duration as its delta and the sphere jumps.
      if (hidden && !nowHidden) lastTime = performance.now();
      hidden = nowHidden;
    };
    document.addEventListener('visibilitychange', onVisibility);

    const update = (t: number) => {
      raf = requestAnimationFrame(update);
      if (hidden) return;

      const dt = (t - lastTime) * 0.001;
      lastTime = t;

      const target = Math.min(Math.max(levelRef.current, 0), 1);
      eased += (target - eased) * Math.min(dt * 8, 1);

      program.uniforms.iTime.value = t * 0.001;
      program.uniforms.hue.value = hueRef.current;
      program.uniforms.level.value = eased;
      // ~0.3 s across a theme change; exact at rest either way.
      lightMix += (lightTarget - lightMix) * Math.min(dt * 10, 1);
      program.uniforms.light.value = lightMix;

      if (!reduceMotion) {
        // Idle turns slower than a call: present, but not asking for attention.
        const base = idleRef.current ? 0.075 : 0.16;
        rot += dt * (base + eased * 1.2);
      }
      program.uniforms.rot.value = rot;

      gl.clear(gl.COLOR_BUFFER_BIT);
      renderer.render({ scene: mesh });
    };

    raf = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(raf);
      themeWatch.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);

      if (container.contains(canvas)) container.removeChild(canvas);
      // ⚠ Browsers cap live WebGL contexts, often around 16. Without this,
      // mounting this component enough times stops it rendering at all, with
      // nothing to say why.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // Runs once. See the note on the refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [particles]);

  return (
    <div ref={ctnDom} className={cn('relative h-full w-full', className)}>
      <div
        ref={fallbackDom}
        hidden
        className="absolute inset-0 flex items-center justify-center"
      >
        {fallback}
      </div>
    </div>
  );
};

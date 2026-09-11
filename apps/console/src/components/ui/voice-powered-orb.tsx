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
 * ── The wiring ──────────────────────────────────────────────────────────────
 *
 * Adapted from ethanplusai/jarvis, whose orb is the same idea: particles
 * holding a hollow sphere, "wired together by faint lines". The lines are the
 * thing. Without them a particle sphere is dust; with them it reads as a
 * structure — something built rather than scattered.
 *
 * ⚠ OURS IS COMPUTED ONCE, THEIRS EVERY FRAME, AND THAT IS CORRECT BOTH TIMES.
 * Their particles drift under velocity and noise, so which ones are neighbours
 * keeps changing and the graph has to be rebuilt. Ours are pinned to the shell
 * and only breathe in and out together — the neighbours never change, so
 * rebuilding the graph 60 times a second would burn the work to arrive at the
 * same answer.
 */
const LINE_SAMPLE = 720;
/**
 * How close two sampled points must be to be wired.
 *
 * ⚠ Tuned against the sample count, not picked. 720 points on a unit sphere sit
 * about `sqrt(4π/720)` ≈ 0.13 apart, so 0.19 catches each point's immediate
 * ring of neighbours and little else. Raise it and the sphere fills in solid;
 * drop it and the web breaks into unconnected flecks.
 */
const LINE_MAX_DIST = 0.19;
/** A ceiling, so a tuning mistake cannot quietly ship a million-line buffer. */
const MAX_LINES = 4200;

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

function colorAtRadius(r: number): [number, number, number] {
  if (r <= GRADIENT[0]!.at) return GRADIENT[0]!.rgb;

  for (let i = 1; i < GRADIENT.length; i += 1) {
    const hi = GRADIENT[i]!;
    if (r > hi.at) continue;
    const lo = GRADIENT[i - 1]!;
    const t = (r - lo.at) / (hi.at - lo.at);
    return [
      lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * t,
      lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * t,
      lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * t,
    ];
  }

  return GRADIENT[GRADIENT.length - 1]!.rgb;
}

/**
 * Wire nearby shell points together.
 *
 * Every `step`-th shell particle is a candidate, and each candidate is joined to
 * any later candidate within `LINE_MAX_DIST`. Sampling rather than using all
 * 2,600 keeps the web legible — wiring every particle produces a solid ball, not
 * a lattice — and keeps the build to a few hundred thousand distance checks
 * instead of several million.
 *
 * Returns flat vertex pairs, ready for `gl.LINES`.
 */
function buildLines(position: Float32Array): Float32Array {
  const step = Math.max(1, Math.floor(SHELL_COUNT / LINE_SAMPLE));
  const picked: number[] = [];
  for (let i = CORE_COUNT; i < CORE_COUNT + SHELL_COUNT; i += step) picked.push(i);

  const out: number[] = [];
  const maxSq = LINE_MAX_DIST * LINE_MAX_DIST;

  for (let a = 0; a < picked.length && out.length < MAX_LINES * 6; a += 1) {
    const ia = picked[a]! * 3;
    const ax = position[ia]!;
    const ay = position[ia + 1]!;
    const az = position[ia + 2]!;

    // From `a + 1`, so each pair is considered once. Both directions would draw
    // every line twice — invisible on screen, and double the buffer.
    for (let b = a + 1; b < picked.length; b += 1) {
      const ib = picked[b]! * 3;
      const dx = ax - position[ib]!;
      const dy = ay - position[ib + 1]!;
      const dz = az - position[ib + 2]!;
      if (dx * dx + dy * dy + dz * dz > maxSq) continue;

      out.push(ax, ay, az, position[ib]!, position[ib + 1]!, position[ib + 2]!);
      if (out.length >= MAX_LINES * 6) break;
    }
  }

  return new Float32Array(out);
}

function buildParticles() {
  const total = CORE_COUNT + SHELL_COUNT + AMBIENT_COUNT;
  const position = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
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

    // The rim's green, only out past the shell, and only sometimes.
    if (r > 1.05 && Math.random() > 0.86) rgb = RIM_TEAL;
    // A rare white spark anywhere, so the field has highlights rather than a
    // perfectly smooth ramp.
    else if (Math.random() > 0.975) rgb = [1.0, 0.99, 0.94];

    color[i * 3] = rgb[0];
    color[i * 3 + 1] = rgb[1];
    color[i * 3 + 2] = rgb[2];

    seed[i] = Math.random();
    // Core particles are small and dense; ambient ones small and sparse; the
    // shell carries the readable triangles.
    scale[i] = core
      ? 3.0 + Math.random() * 2.0
      : shell
        ? 5.0 + Math.random() * 3.0
        : 3.2 + Math.random() * 1.6;
  }

  return { position, color, seed, scale };
}

const vert = /* glsl */ `
  precision highp float;

  attribute vec3 position;
  attribute vec3 color;
  attribute float seed;
  attribute float scale;

  uniform float iTime;
  uniform float level;
  uniform float rot;
  uniform float dpr;
  uniform vec2 iResolution;

  varying vec3 vColor;
  varying float vFade;

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
    vColor = color;

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

  varying vec3 vColor;
  varying float vFade;

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

    float d = sdTriangle(p, 0.85);

    /*
     * ⚠ OUTLINED, not filled. The reference is explicit: 1-2px stroked
     * triangles. Filling them turns the constellation into confetti and loses
     * the drawn, technical quality entirely.
     */
    float edge = 1.0 - smoothstep(0.0, 0.26, abs(d));
    // A little bloom outside the stroke, so a dense cluster glows rather than
    // reading as a mesh.
    float bloom = exp(-4.0 * max(d, 0.0)) * 0.3;

    float alpha = (edge + bloom) * vFade;
    if (alpha < 0.012) discard;

    vec3 col = adjustHue(vColor, hue) * (0.85 + level * 0.7);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

/**
 * The wiring.
 *
 * ⚠⚠ NO BACKTICKS ANYWHERE INSIDE THESE TEMPLATE LITERALS. One in a comment
 * closes the string holding the shader, and tsc reports "',' expected" on a
 * line of GLSL — naming neither the cause nor the real problem. This has now
 * cost two separate debugging rounds in this file.
 *
 * ⚠ The vertex transform is a deliberate DUPLICATE of the points' one, not a
 * shared import. The two shaders must move together to the pixel — a line whose
 * endpoints breathe on a slightly different curve to the particles it joins
 * detaches from them, and the whole structure comes apart. They are kept
 * adjacent so a change to one is obviously a change to both.
 */
const lineVert = /* glsl */ `
  precision highp float;

  attribute vec3 position;

  uniform float iTime;
  uniform float level;
  uniform float rot;
  uniform vec2 iResolution;

  varying float vFade;

  void main() {
    float c = cos(rot);
    float s = sin(rot);
    vec3 p = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);

    float t = 0.22 * sin(iTime * 0.13);
    float ct = cos(t);
    float st = sin(t);
    p = vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);

    // NOTE: no per-vertex seed term here. The points jitter individually; a line
    // cannot, or its two ends drift apart from the particles they connect.
    p *= 1.0 + level * 0.14;

    float depth = clamp((p.z + 1.8) / 3.6, 0.0, 1.0);
    // Steeper than the points' fade. The far half of a wireframe is what turns
    // a sphere into a muddle, so the back of the web drops away harder.
    vFade = 0.06 + depth * 0.94;

    float aspect = iResolution.x / max(iResolution.y, 1.0);
    gl_Position = vec4(vec2(p.x / max(aspect, 0.0001), p.y) * 0.58, 0.0, 1.0);
  }
`;

const lineFrag = /* glsl */ `
  precision highp float;

  uniform float level;
  uniform vec3 wireColor;

  varying float vFade;

  void main() {
    /*
     * ⚠ FAINT. This is the word the reference uses and it is the whole brief:
     * the wiring is structure, not subject. At full strength it becomes a
     * wireframe globe and buries the particles it exists to connect.
     */
    float alpha = vFade * (0.085 + level * 0.16);
    gl_FragColor = vec4(wireColor, alpha);
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
  // The neighbour graph never changes, because the shell never deforms — only
  // breathes. See the note on LINE_SAMPLE.
  const lines = useMemo(() => buildLines(particles.position), [particles]);

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
      seed: { size: 1, data: particles.seed },
      scale: { size: 1, data: particles.scale },
    });

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
      },
    });

    const mesh = new Mesh(gl, { mode: gl.POINTS, geometry, program });

    /*
     * The wiring, as its own mesh.
     *
     * ⚠ Drawn BEFORE the particles, so the points sit on top of their own
     * connections rather than behind them. With blending on and depth testing
     * off, draw order is the only depth there is.
     */
    const lineGeometry = new Geometry(gl, {
      position: { size: 3, data: lines },
    });

    const lineProgram = new Program(gl, {
      vertex: lineVert,
      fragment: lineFrag,
      transparent: true,
      depthTest: false,
      uniforms: {
        iTime: { value: 0 },
        level: { value: 0 },
        rot: { value: 0 },
        iResolution: { value: [1, 1] },
        // The shell's gold, so the web reads as the same material as the
        // particles rather than a grid laid over them.
        wireColor: { value: [1.0, 0.75, 0.24] },
      },
    });

    const lineMesh = new Mesh(gl, { mode: gl.LINES, geometry: lineGeometry, program: lineProgram });

    /*
     * ⚠ ogl clears before every `render()` unless told otherwise, which would
     * wipe the lines the instant the particles were drawn. The clear is done by
     * hand once per frame instead.
     */
    renderer.autoClear = false;

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
      lineProgram.uniforms.iResolution.value = [canvas.width, canvas.height];
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

      if (!reduceMotion) {
        // Idle turns slower than a call: present, but not asking for attention.
        const base = idleRef.current ? 0.075 : 0.16;
        rot += dt * (base + eased * 1.2);
      }
      program.uniforms.rot.value = rot;

      lineProgram.uniforms.iTime.value = t * 0.001;
      lineProgram.uniforms.level.value = eased;
      lineProgram.uniforms.rot.value = rot;

      gl.clear(gl.COLOR_BUFFER_BIT);
      // Wiring first, particles over it. See the note where lineMesh is built.
      renderer.render({ scene: lineMesh });
      renderer.render({ scene: mesh });
    };

    raf = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(raf);
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
  }, [particles, lines]);

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

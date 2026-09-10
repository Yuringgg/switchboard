'use client';

import { Mesh, Program, Renderer, Triangle, Vec3 } from 'ogl';
import { useEffect, useRef, type FC } from 'react';

import { cn } from '@/lib/utils';

/**
 * The orb (voice V2). Adopted from a generator drop, rebuilt in two ways.
 *
 * ── ⚠ 1. IT DOES NOT OPEN A MICROPHONE ──────────────────────────────────────
 *
 * The original version called `getUserMedia` itself, with `echoCancellation`,
 * `noiseSuppression` and `autoGainControl` all **off** "for better voice
 * analysis". During a Vapi call that is actively wrong, three times over:
 *
 *   · Vapi already holds the microphone. A second `getUserMedia` on the same
 *     device is waste at best and a conflict at worst.
 *   · With echo cancellation off it hears the assistant through the laptop
 *     speakers — so the orb would react to her voice by accident, badly, and
 *     only for people not wearing headphones.
 *   · It is a second recording surface on a product whose whole security note
 *     is about not opening microphones people did not ask for.
 *
 * So this takes a `level` prop and draws it. The Vapi SDK already reports both
 * sides — `volume-level` for the assistant, `local-volume-level` for the user —
 * and the caller decides which one is speaking. See `voice-call.tsx`.
 *
 * ── ⚠ 2. IT DEGRADES INSTEAD OF DISAPPEARING ────────────────────────────────
 *
 * The original removed its own canvas and logged to the console when WebGL
 * failed, leaving an empty box with nothing to explain it. WebGL is genuinely
 * absent in headless renderers and in this project's browser pane — the same
 * reason `correspondence/2026-08-09-design-revisions.md` had three components
 * rebuilt on CSS. A `fallback` renders instead, so the control is still legible
 * when the shader cannot run.
 *
 * The shader itself is unchanged. It is good, and rewriting it would be
 * rewriting the thing that was worth adopting.
 */

interface VoicePoweredOrbProps {
  className?: string;
  /**
   * How loud, 0 to 1. Drives rotation and the wobble.
   *
   * ⚠ Supplied by the caller rather than measured here — that separation is
   * the whole point of the component. Whoever owns the audio owns the number.
   */
  level?: number;
  /** Colour rotation in degrees. Lets the caller tint who is speaking. */
  hue?: number;
  /** Drawn when WebGL is unavailable. */
  fallback?: React.ReactNode;
}

const vert = /* glsl */ `
  precision highp float;
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const frag = /* glsl */ `
  precision highp float;

  uniform float iTime;
  uniform vec3 iResolution;
  uniform float hue;
  uniform float hover;
  uniform float rot;
  uniform float hoverIntensity;
  varying vec2 vUv;

  vec3 rgb2yiq(vec3 c) {
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    float i = dot(c, vec3(0.596, -0.274, -0.322));
    float q = dot(c, vec3(0.211, -0.523, 0.312));
    return vec3(y, i, q);
  }

  vec3 yiq2rgb(vec3 c) {
    float r = c.x + 0.956 * c.y + 0.621 * c.z;
    float g = c.x - 0.272 * c.y - 0.647 * c.z;
    float b = c.x - 1.106 * c.y + 1.703 * c.z;
    return vec3(r, g, b);
  }

  vec3 adjustHue(vec3 color, float hueDeg) {
    float hueRad = hueDeg * 3.14159265 / 180.0;
    vec3 yiq = rgb2yiq(color);
    float cosA = cos(hueRad);
    float sinA = sin(hueRad);
    float i = yiq.y * cosA - yiq.z * sinA;
    float q = yiq.y * sinA + yiq.z * cosA;
    yiq.y = i;
    yiq.z = q;
    return yiq2rgb(yiq);
  }

  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yxz + 19.19);
    return -1.0 + 2.0 * fract(vec3(
      p3.x + p3.y,
      p3.x + p3.z,
      p3.y + p3.z
    ) * p3.zyx);
  }

  float snoise3(vec3 p) {
    const float K1 = 0.333333333;
    const float K2 = 0.166666667;
    vec3 i = floor(p + (p.x + p.y + p.z) * K1);
    vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
    vec3 e = step(vec3(0.0), d0 - d0.yzx);
    vec3 i1 = e * (1.0 - e.zxy);
    vec3 i2 = 1.0 - e.zxy * (1.0 - e);
    vec3 d1 = d0 - (i1 - K2);
    vec3 d2 = d0 - (i2 - K1);
    vec3 d3 = d0 - 0.5;
    vec4 h = max(0.6 - vec4(
      dot(d0, d0),
      dot(d1, d1),
      dot(d2, d2),
      dot(d3, d3)
    ), 0.0);
    vec4 n = h * h * h * h * vec4(
      dot(d0, hash33(i)),
      dot(d1, hash33(i + i1)),
      dot(d2, hash33(i + i2)),
      dot(d3, hash33(i + 1.0))
    );
    return dot(vec4(31.316), n);
  }

  vec4 extractAlpha(vec3 colorIn) {
    float a = max(max(colorIn.r, colorIn.g), colorIn.b);
    return vec4(colorIn.rgb / (a + 1e-5), a);
  }

  const vec3 baseColor1 = vec3(0.611765, 0.262745, 0.996078);
  const vec3 baseColor2 = vec3(0.298039, 0.760784, 0.913725);
  const vec3 baseColor3 = vec3(0.062745, 0.078431, 0.600000);
  const float innerRadius = 0.6;
  const float noiseScale = 0.65;

  float light1(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * attenuation);
  }

  float light2(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * dist * attenuation);
  }

  vec4 draw(vec2 uv) {
    vec3 color1 = adjustHue(baseColor1, hue);
    vec3 color2 = adjustHue(baseColor2, hue);
    vec3 color3 = adjustHue(baseColor3, hue);

    float ang = atan(uv.y, uv.x);
    float len = length(uv);
    float invLen = len > 0.0 ? 1.0 / len : 0.0;

    float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
    float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
    float d0 = distance(uv, (r0 * invLen) * uv);
    float v0 = light1(1.0, 10.0, d0);
    v0 *= smoothstep(r0 * 1.05, r0, len);
    float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;

    float a = iTime * -1.0;
    vec2 pos = vec2(cos(a), sin(a)) * r0;
    float d = distance(uv, pos);
    float v1 = light2(1.5, 5.0, d);
    v1 *= light1(1.0, 50.0, d0);

    float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
    float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);

    vec3 col = mix(color1, color2, cl);
    col = mix(color3, col, v0);
    col = (col + v1) * v2 * v3;
    col = clamp(col, 0.0, 1.0);

    return extractAlpha(col);
  }

  vec4 mainImage(vec2 fragCoord) {
    vec2 center = iResolution.xy * 0.5;
    float size = min(iResolution.x, iResolution.y);
    vec2 uv = (fragCoord - center) / size * 2.0;

    float angle = rot;
    float s = sin(angle);
    float c = cos(angle);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

    uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
    uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);

    return draw(uv);
  }

  void main() {
    vec2 fragCoord = vUv * iResolution.xy;
    vec4 col = mainImage(fragCoord);
    gl_FragColor = vec4(col.rgb * col.a, col.a);
  }
`;

export const VoicePoweredOrb: FC<VoicePoweredOrbProps> = ({
  className,
  level = 0,
  hue = 0,
  fallback = null,
}) => {
  const ctnDom = useRef<HTMLDivElement>(null);
  const fallbackDom = useRef<HTMLDivElement>(null);

  /*
   * ⚠ `level` and `hue` reach the render loop through refs, NOT the effect's
   * dependency array.
   *
   * They change many times a second — `local-volume-level` fires continuously
   * while somebody talks. In the dependency array that would tear down the
   * WebGL context and rebuild the shader on every audio frame, which is both a
   * visible flicker and a fast way to exhaust the browser's context limit.
   *
   * The effect below therefore runs ONCE and reads the current value each
   * frame, which is what a render loop wants anyway.
   */
  const levelRef = useRef(level);
  const hueRef = useRef(hue);
  levelRef.current = level;
  hueRef.current = hue;

  useEffect(() => {
    const container = ctnDom.current;
    if (!container) return;

    /*
     * ⚠ Reduced motion is honoured in JavaScript here, because the global CSS
     * rule in `globals.css` only reaches CSS animations. A WebGL render loop
     * would keep spinning straight through it.
     *
     * The orb still DRAWS — it simply stops moving. Hiding it entirely would
     * remove the only visual signal that a call is live.
     */
    const stillness = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduceMotion = Boolean(stillness?.matches);

    let renderer: Renderer;
    // ⚠ ogl's own context type, not the DOM's. `OGLRenderingContext` carries
    // extra fields ogl attaches, and the plain DOM union is not assignable to
    // it — annotating with the DOM type makes every ogl call fail to typecheck.
    let gl: Renderer['gl'];
    let program: Program;

    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        dpr: window.devicePixelRatio || 1,
      });
      gl = renderer.gl;
    } catch {
      /*
       * No WebGL — a headless renderer, a locked-down browser, or a machine
       * with no GPU. The fallback is already in the DOM; reveal it and stop.
       * Never leave an empty box with an explanation only in the console.
       */
      if (fallbackDom.current) fallbackDom.current.hidden = false;
      return;
    }

    /*
     * ⚠ `gl.canvas` is typed `HTMLCanvasElement | OffscreenCanvas`, and only
     * the first can be put in the DOM or given a style. `Renderer` makes a real
     * one, so this narrowing never fails in practice — but a cast would hide
     * the day it does, and the failure would be a blank box.
     */
    const canvas = gl.canvas;
    if (!(canvas instanceof HTMLCanvasElement)) {
      if (fallbackDom.current) fallbackDom.current.hidden = false;
      return;
    }

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    container.appendChild(canvas);

    const geometry = new Triangle(gl);
    program = new Program(gl, {
      vertex: vert,
      fragment: frag,
      uniforms: {
        iTime: { value: 0 },
        iResolution: {
          value: new Vec3(canvas.width, canvas.height, canvas.width / canvas.height),
        },
        hue: { value: hue },
        hover: { value: 0 },
        rot: { value: 0 },
        hoverIntensity: { value: 0 },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;

      renderer.setSize(width * dpr, height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      program.uniforms.iResolution.value.set(
        canvas.width,
        canvas.height,
        canvas.width / canvas.height,
      );
    };

    window.addEventListener('resize', resize);
    resize();

    let raf = 0;
    let lastTime = 0;
    let rot = 0;
    /*
     * The drawn level trails the reported one.
     *
     * Audio levels are spiky — a raw value jitters hard enough to look like a
     * fault rather than a response. Easing toward the target keeps the motion
     * legible as speech without smoothing away the beat of it.
     */
    let eased = 0;

    const update = (t: number) => {
      raf = requestAnimationFrame(update);

      const dt = (t - lastTime) * 0.001;
      lastTime = t;

      const target = Math.min(Math.max(levelRef.current, 0), 1);
      eased += (target - eased) * Math.min(dt * 8, 1);

      program.uniforms.iTime.value = t * 0.001;
      program.uniforms.hue.value = hueRef.current;

      if (!reduceMotion) {
        // A slow idle turn plus whatever the voice adds, so a live call never
        // looks frozen even in silence.
        rot += dt * (0.3 + eased * 2.4);
        program.uniforms.hover.value = Math.min(eased * 2, 1);
        program.uniforms.hoverIntensity.value = Math.min(eased * 0.8, 0.8);
      }

      program.uniforms.rot.value = rot;

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      renderer.render({ scene: mesh });
    };

    raf = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);

      if (container.contains(canvas)) container.removeChild(canvas);
      // ⚠ Browsers cap live WebGL contexts (often around 16). Without this,
      // mounting and unmounting this component enough times stops it rendering
      // at all, with nothing to say why.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // Runs once. See the note on `levelRef` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

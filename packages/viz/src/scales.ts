/**
 * Scales, easing and interpolation. Everything is a pure function of its arguments; the only time
 * source anywhere in viz is the `t` a caller passes in.
 */

export type Easing = (x: number) => number;

export const clamp = (x: number, lo = 0, hi = 1): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, x: number): number => a + (b - a) * x;

export const linear: Easing = (x) => x;
export const easeOutCubic: Easing = (x) => 1 - (1 - x) ** 3;
export const easeInOutCubic: Easing = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
export const easeOutQuint: Easing = (x) => 1 - (1 - x) ** 5;

/**
 * Stateless spring: closed-form under-damped oscillator normalised to settle at x = 1.
 * `damping` is the damping ratio (0 < d < 1), `bounces` the number of half-oscillations in [0, 1].
 * Exactly 0 at x = 0 and exactly 1 at x >= 1.
 */
export function springEase({ damping = 0.55, bounces = 1.5 }: { damping?: number; bounces?: number } = {}): Easing {
  const wd = Math.PI * bounces;
  const zeta = clamp(damping, 0.05, 0.99);
  const w0 = wd / Math.sqrt(1 - zeta * zeta);
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const decay = Math.exp(-zeta * w0 * x);
    const raw = 1 - decay * (Math.cos(wd * x) + ((zeta * w0) / wd) * Math.sin(wd * x));
    // blend the tail to exactly 1 so the motion ends on the target with zero residue
    const tail = easeInOutCubic(clamp((x - 0.8) / 0.2));
    return lerp(raw, 1, tail);
  };
}

export type InterpolateOptions = { clamp?: boolean; easing?: Easing };

/** Map `t` from [t0, t1] onto [a, b]. Clamped by default; `easing` shapes the normalised position. */
export function interpolate(
  t: number,
  [t0, t1]: readonly [number, number],
  [a, b]: readonly [number, number],
  { clamp: doClamp = true, easing = linear }: InterpolateOptions = {},
): number {
  if (t1 === t0) return t < t0 ? a : b;
  let x = (t - t0) / (t1 - t0);
  if (doClamp) x = clamp(x);
  return lerp(a, b, easing(x));
}

export type LinearScale = ((x: number) => number) & {
  domain: [number, number];
  range: [number, number];
  /** px -> data value; a zero-width range maps back to the domain start */
  invert: (px: number) => number;
};

/** `clamp` pins output (and `invert` output) to the range (domain); off by default. */
export function scaleLinear(
  domain: readonly [number, number],
  range: readonly [number, number],
  { clamp: doClamp = false }: { clamp?: boolean } = {},
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const pin = (x: number, a: number, b: number) => (doClamp ? clamp(x, Math.min(a, b), Math.max(a, b)) : x);
  const f = ((x: number) =>
    d1 === d0 ? (r0 + r1) / 2 : r0 + ((pin(x, d0, d1) - d0) / (d1 - d0)) * (r1 - r0)) as LinearScale;
  f.invert = (px: number) => (r1 === r0 ? d0 : d0 + ((pin(px, r0, r1) - r0) / (r1 - r0)) * (d1 - d0));
  f.domain = [d0, d1];
  f.range = [r0, r1];
  return f;
}

/**
 * Band/rank scale: `count` evenly spaced slots from `range[0]` to `range[1]` (slot 0 at range[0]).
 * `maxStep` caps the spacing so short lists do not stretch over the whole range.
 */
export function scaleRank(count: number, range: readonly [number, number], { maxStep = Infinity } = {}) {
  const [r0, r1] = range;
  const span = r1 - r0;
  const raw = count > 1 ? span / (count - 1) : 0;
  const step = Math.sign(span) * Math.min(Math.abs(raw), maxStep);
  const slot = (i: number) => r0 + i * step;
  return Object.assign(slot, { step: Math.abs(step), count });
}

/**
 * Per-item progress for a staggered sequence driven by one overall `progress` in [0, 1].
 * `overlap` in [0, 1): 0 = strictly one after another, 0.9 = nearly simultaneous.
 */
export function stagger(progress: number, index: number, count: number, overlap = 0.6): number {
  if (count <= 1) return clamp(progress);
  const o = clamp(overlap, 0, 0.99);
  const window = 1 / (count - (count - 1) * o);
  const start = index * window * (1 - o);
  return clamp((progress - start) / window);
}

/** Decibels to linear gain (0 dB = 1). */
export const dbToGain = (db: number): number => 10 ** (db / 20);

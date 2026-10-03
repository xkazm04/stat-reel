/**
 * Nice tick values. Pure and deterministic: steps are 1 / 2 / 2.5 / 5 x 10^n, so gridlines land on
 * numbers a viewer can read at a glance (scale-and-axis-design). No React, no DOM.
 */

const NICE = [1, 2, 2.5, 5, 10] as const;

/** Round away binary float noise (0.1 * 3 -> 0.3) and normalise -0 to 0. */
const tidy = (x: number): number => {
  const r = Number(x.toPrecision(12));
  return r === 0 ? 0 : r;
};

/** The nice step (1/2/2.5/5 x 10^n) closest to, and not below, `span / count`. */
export function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  if (!(raw > 0) || !Number.isFinite(raw)) return 0;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of NICE) {
    const step = m * mag;
    if (step >= raw * (1 - 1e-12)) return tidy(step);
  }
  return tidy(10 * mag);
}

/**
 * Multiples of a nice step inside [min, max], about `count` of them (at most `count + 1`).
 * Reversed bounds are swapped; a zero-width range yields its single value; non-finite input yields [].
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (lo === hi) return [tidy(lo)];
  const step = niceStep(hi - lo, count);
  if (!(step > 0)) return [];
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  const out: number[] = [];
  for (let k = first; k <= last; k++) out.push(tidy(k * step));
  return out;
}

/**
 * Season / date time scale and declared domains. Time is a fractional year: a season "1988" is
 * 1988.0, an ISO date "1988-07-01" is 1988 + (day of year - 1) / days in year. All arithmetic is
 * closed-form (no Date objects, no clock), so every result is a pure function of its arguments.
 * No React, no DOM.
 */
import { clamp, type LinearScale, scaleLinear } from "./scales";
import { niceStep } from "./ticks";

export type TimeValue = number | string;

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334] as const;

/** Numeric years pass through; "YYYY", "YYYY-MM" and "YYYY-MM-DD" become fractional years; else NaN. */
export function parseTime(value: TimeValue): number {
  if (typeof value === "number") return value;
  const m = /^(-?\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value.trim());
  if (!m) return Number.NaN;
  const year = Number(m[1]);
  const month = m[2] === undefined ? 1 : Number(m[2]);
  const day = m[3] === undefined ? 1 : Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return Number.NaN;
  const days = isLeap(year) ? 366 : 365;
  const doy = (CUM[month - 1] as number) + (month > 2 && isLeap(year) ? 1 : 0) + day - 1;
  return year + doy / days;
}

export type TimeTick = { value: number; label: string };

/** Year steps, in years: single seasons up to centuries. */
const YEAR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000] as const;

/**
 * Whole-year ticks inside [from, to]: the smallest step in 1/2/5/10/20/25/50/100... that gives at
 * most `count` ticks, anchored on multiples of the step so decade ticks read 1980, 1990, 2000.
 */
export function yearTicks(from: number, to: number, count = 6): TimeTick[] {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const budget = Math.max(1, Math.floor(count));
  let step: number = YEAR_STEPS[YEAR_STEPS.length - 1] as number;
  for (const s of YEAR_STEPS) {
    if (Math.floor(hi / s) - Math.ceil(lo / s) + 1 <= budget) {
      step = s;
      break;
    }
  }
  const out: TimeTick[] = [];
  for (let k = Math.ceil(lo / step); k <= Math.floor(hi / step); k++) out.push({ value: k * step, label: String(k * step) });
  return out;
}

export type TimeScale = ((v: TimeValue) => number) & {
  /** the domain as fractional years */
  domain: [number, number];
  range: [number, number];
  /** px -> fractional year */
  invert: (px: number) => number;
  ticks: (count?: number) => TimeTick[];
};

/** Map seasons or ISO dates onto px. Clamped is off by default so callers can see out-of-range data. */
export function scaleTime(
  domain: readonly [TimeValue, TimeValue],
  range: readonly [number, number],
  { clamp: doClamp = false }: { clamp?: boolean } = {},
): TimeScale {
  const d: [number, number] = [parseTime(domain[0]), parseTime(domain[1])];
  const lin: LinearScale = scaleLinear(d, range, { clamp: doClamp });
  const f = ((v: TimeValue) => lin(parseTime(v))) as TimeScale;
  f.domain = d;
  f.range = [range[0], range[1]];
  f.invert = lin.invert;
  f.ticks = (count = 6) => yearTicks(d[0], d[1], count);
  return f;
}

export type DomainConfig = readonly [number, number] | { min: number; max: number };

/**
 * A domain that comes from configuration, never from the sample (scale-and-axis-design: a domain
 * taken from the data's own min/max makes the same value look different from video to video and
 * exaggerates small moves). Throws on a missing, non-finite or empty declaration so the gap is
 * loud instead of silently falling back to the sample. `nice` widens the ends to tick multiples.
 */
export function declaredDomain(config: DomainConfig | undefined, { nice = false, count = 5 } = {}): [number, number] {
  if (!config) throw new Error("declaredDomain: a domain must be declared in config, not derived from the sample");
  const [min, max] = Array.isArray(config) ? config : [(config as { min: number }).min, (config as { max: number }).max];
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) {
    throw new Error(`declaredDomain: need finite min < max, got [${min}, ${max}]`);
  }
  if (!nice) return [min, max];
  const step = niceStep(max - min, count);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

/** Position of `value` within a declared domain as 0..1 (clamped); the DataClock progress bar uses it. */
export const domainProgress = (value: number, domain: readonly [number, number]): number =>
  domain[1] === domain[0] ? 0 : clamp((value - domain[0]) / (domain[1] - domain[0]));

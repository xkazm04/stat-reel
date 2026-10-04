/**
 * Big-number callout with a rolling (odometer) count. Digits sit in equal-width columns and the
 * face is set with tabular figures, so the number never jitters while it rolls.
 */
import type { ReactElement } from "react";
import { type Easing, easeOutQuint, interpolate } from "./scales";
import { estimateWidth } from "./text";
import { TABULAR, type VizTheme } from "./types";

/** Tabular digit advance of Barlow Condensed (em), used for column width. */
export const DIGIT_EM = 0.5;

export type DigitColumn = {
  /** place value in units of the last shown decimal (0 = last digit) */
  place: number;
  /** continuous digit position: 3.4 = 40 % of the way from "3" to "4" */
  position: number;
  /** 0..1, leading zero columns fade out */
  visible: number;
};

/**
 * Odometer state for a non-negative value shown with `decimals`. A column only moves while every
 * column to its right is rolling over from 9 to 0, as on a mechanical counter.
 */
export function rollingDigits(value: number, decimals: number, minIntDigits = 1): DigitColumn[] {
  const n = Math.max(0, value) * 10 ** decimals;
  const intDigits = Math.max(minIntDigits, String(Math.floor(Math.max(0, value))).length);
  const cols: DigitColumn[] = [];
  const ones = 10 ** decimals;
  for (let place = intDigits + decimals - 1; place >= 0; place--) {
    const unit = 10 ** place;
    const base = Math.floor(n / unit);
    const lower = n - base * unit;
    const thresh = unit - 1;
    const position = (base % 10) + (lower > thresh ? lower - thresh : 0);
    const leading = place > decimals;
    const visible = leading ? Math.min(1, Math.max(0, (n - (unit - ones)) / ones)) : 1;
    cols.push({ place, position, visible });
  }
  return cols;
}

export const digitCount = (v: number): number => String(Math.floor(Math.abs(v))).length;

export type CalloutProps = {
  /** the figure the count lands on (non-negative; rounded to `decimals`) */
  value: number;
  /** where the count starts (default 0) */
  from?: number;
  /** time in seconds */
  t: number;
  /** count window [start, start + duration] in seconds */
  start?: number;
  duration?: number;
  easing?: Easing;
  decimals?: number;
  prefix?: string;
  /** prefix size relative to the number (default 1) */
  prefixScale?: number;
  prefixColor?: string;
  /** text after the number; a function receives the currently shown (rounded) value, e.g. ordinals */
  suffix?: string | ((shown: number) => string);
  /** suffix size relative to the number (default 1) */
  suffixScale?: number;
  /** small caption under the number */
  label?: string;
  theme: VizTheme;
  fontSize: number;
  labelFontSize?: number;
  color?: string;
  labelColor?: string;
  align?: "start" | "center" | "end";
  /** total width of the svg (default: estimated from content) */
  width?: number;
  weight?: number;
};

export function Callout(props: CalloutProps): ReactElement {
  const {
    value,
    from = 0,
    t,
    start = 0,
    duration = 1.2,
    easing = easeOutQuint,
    decimals = 0,
    prefix = "",
    prefixScale = 1,
    suffixScale = 1,
    label,
    theme,
    fontSize: fs,
    labelFontSize = Math.max(28, Math.round(fs * 0.2)),
    color = theme.ink,
    labelColor = theme.inkDim,
    align = "start",
    weight = 800,
  } = props;

  // land exactly on the shown precision, so the last column comes to rest on a whole digit
  const target = Number(value.toFixed(decimals));
  const current = interpolate(t, [start, start + duration], [from, target], { easing });
  const shown = Number(current.toFixed(decimals));
  const suffix = typeof props.suffix === "function" ? props.suffix(Math.round(current)) : (props.suffix ?? "");
  const cols = rollingDigits(current, decimals, Math.max(digitCount(from), digitCount(target)));
  const colW = fs * DIGIT_EM;
  const lineH = fs * 1.02;
  const pointW = decimals > 0 ? fs * 0.22 : 0;

  // column x positions: leading columns collapse as they fade
  let cursor = 0;
  const placed = cols.map((c) => {
    const w = colW * c.visible;
    const x = cursor;
    cursor += w;
    if (c.place === decimals && decimals > 0) cursor += pointW;
    return { ...c, x, w };
  });
  const digitsW = cursor;
  const prefixFs = fs * prefixScale;
  const prefixColor = props.prefixColor ?? color;
  const prefixW = prefix ? estimateWidth(prefix, prefixFs, "condensedCaps") + fs * 0.08 : 0;
  const suffixFs = fs * suffixScale;
  const suffixW = suffix ? estimateWidth(suffix, suffixFs, "condensedCaps") + fs * 0.06 : 0;
  const labelW = label ? estimateWidth(label, labelFontSize, "mono", labelFontSize * 0.08) : 0;
  const contentW = prefixW + digitsW + suffixW;
  const width = props.width ?? Math.ceil(Math.max(contentW, labelW) + 4);
  const labelGap = label ? Math.round(labelFontSize * 0.7) : 0;
  const height = Math.ceil(lineH + (label ? labelGap + labelFontSize * 1.1 : 0));
  const x0 = align === "start" ? 0 : align === "center" ? (width - contentW) / 2 : width - contentW;
  const dx = x0 + prefixW;
  const baseline = fs * 0.86;
  const labelX = align === "start" ? 0 : align === "center" ? width / 2 : width;
  const anchor = align === "start" ? "start" : align === "center" ? "middle" : "end";
  const numberStyle = { ...TABULAR };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      data-callout={shown}
      role="img"
      aria-label={`${prefix} ${shown}${suffix} ${label ?? ""}`.trim()}
    >
      {prefix ? (
        <text
          x={x0}
          y={baseline}
          fill={prefixColor}
          fontFamily={theme.fonts.display}
          fontWeight={weight}
          fontSize={prefixFs}
          style={numberStyle}
        >
          {prefix}
        </text>
      ) : null}
      {placed.map((c) => {
        if (c.visible <= 0) return null;
        const lo = Math.floor(c.position);
        const frac = c.position - lo;
        const digits = frac > 1e-6 ? [lo, lo + 1] : [lo];
        return (
          <svg
            key={`d-${c.place}`}
            x={dx + c.x}
            y={0}
            width={Math.max(c.w, 0.01)}
            height={lineH}
            overflow="hidden"
            opacity={c.visible}
            aria-hidden="true"
          >
            {digits.map((d) => (
              <text
                key={d}
                x={c.w / 2}
                y={baseline + (d - c.position) * lineH}
                textAnchor="middle"
                fill={color}
                fontFamily={theme.fonts.display}
                fontWeight={weight}
                fontSize={fs}
                style={numberStyle}
              >
                {d % 10}
              </text>
            ))}
          </svg>
        );
      })}
      {decimals > 0
        ? (() => {
            const onesCol = placed.find((c) => c.place === decimals);
            const px = dx + (onesCol ? onesCol.x + onesCol.w : 0) + pointW / 2;
            return (
              <text
                x={px}
                y={baseline}
                textAnchor="middle"
                fill={color}
                fontFamily={theme.fonts.display}
                fontWeight={weight}
                fontSize={fs}
              >
                .
              </text>
            );
          })()
        : null}
      {suffix ? (
        <text
          x={dx + digitsW + fs * 0.04}
          y={baseline}
          fill={color}
          fontFamily={theme.fonts.display}
          fontWeight={weight}
          fontSize={suffixFs}
        >
          {suffix}
        </text>
      ) : null}
      {label ? (
        <text
          x={labelX}
          y={lineH + labelGap + labelFontSize * 0.8}
          textAnchor={anchor}
          fill={labelColor}
          fontFamily={theme.fonts.data}
          fontSize={labelFontSize}
          letterSpacing={labelFontSize * 0.08}
        >
          {label.toUpperCase()}
        </text>
      ) : null}
    </svg>
  );
}

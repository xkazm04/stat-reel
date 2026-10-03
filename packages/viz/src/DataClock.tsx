/**
 * Data clock (DESIGN.md §6.2): the current data-time as a big label ("1988", "R12 · 2024") with an
 * optional progress bar showing where that time sits in the data range. A pure function of its
 * props - the composition maps video time to data time and passes `value`; nothing here reads a
 * clock or keeps state, so any frame renders alone.
 */
import type { ReactElement } from "react";
import { domainProgress } from "./time-scale";
import { TABULAR, type VizTheme } from "./types";

/** Owner rule: every readable text is >= 28 px in the 1080x1920 artboard. */
export const MIN_CLOCK_FONT = 28;

export type DataClockProps = {
  /** current data time (fractional year, round number, ...) */
  value: number;
  /** declared data range, for the progress bar (never derived from the sample) */
  domain: readonly [number, number];
  /** optional lead-in such as "R12"; shown as "R12 · 2024" */
  prefix?: string;
  /** label for `value`; default floors to a whole number ("1988") */
  format?: (value: number) => string;
  /** px; clamped up to 28 (default 56) */
  fontSize?: number;
  /** progress bar under the label (default true) */
  progress?: boolean;
  width: number;
  theme: VizTheme;
  /** text anchor inside `width` (default "start") */
  align?: "start" | "end";
};

/** The label text: clamped into the domain so the clock never shows a time outside the data. */
export function dataClockLabel({ value, domain, prefix, format }: Pick<DataClockProps, "value" | "domain" | "prefix" | "format">): string {
  const lo = Math.min(domain[0], domain[1]);
  const hi = Math.max(domain[0], domain[1]);
  const v = Math.min(hi, Math.max(lo, value));
  const body = (format ?? ((x: number) => String(Math.floor(x + 1e-9))))(v);
  return prefix ? `${prefix} · ${body}` : body;
}

export function DataClock(props: DataClockProps): ReactElement {
  const { theme, width, align = "start" } = props;
  const fontSize = Math.max(MIN_CLOCK_FONT, props.fontSize ?? 56);
  const showBar = props.progress !== false;
  const barH = Math.max(4, Math.round(fontSize * 0.1));
  const gap = Math.round(fontSize * 0.25);
  const height = Math.round(fontSize * 1.05) + (showBar ? gap + barH : 0);
  const frac = domainProgress(props.value, props.domain);
  const label = dataClockLabel(props);
  const barY = Math.round(fontSize * 1.05) + gap;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`data time ${label}`}
    >
      <text
        x={align === "end" ? width : 0}
        y={fontSize * 0.9}
        textAnchor={align}
        fill={theme.ink}
        fontFamily={theme.fonts.data}
        fontWeight={700}
        fontSize={fontSize}
        style={TABULAR}
      >
        {label}
      </text>
      {showBar ? (
        <g>
          <rect x={0} y={barY} width={width} height={barH} rx={barH / 2} fill={theme.grid} />
          <rect x={0} y={barY} width={width * frac} height={barH} rx={barH / 2} fill={theme.accent} />
        </g>
      ) : null}
    </svg>
  );
}

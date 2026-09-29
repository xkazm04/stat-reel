/**
 * Slopegraph as React SVG. A pure function of its props: `progress` (0..1) draws the lines with a
 * stagger, the highlighted row last; no state, effects or CSS animation.
 */
import type { ReactElement } from "react";
import { clamp, easeInOutCubic, easeOutCubic, interpolate, lerp, stagger } from "./scales";
import { type SlopegraphLayout, type SlopegraphTitles, type SlopeRow, slopegraphLayout } from "./slopegraph-layout";
import { TABULAR, type VizFormat, type VizTheme } from "./types";

export type SlopegraphLabels = SlopegraphTitles & { nameStyle?: "surname" | "full" };

export type SlopegraphProps = {
  rows: readonly SlopeRow[];
  highlightId?: string;
  /** rows drawn brighter; empty = no emphasis */
  focus?: readonly string[];
  /** line draw progress, 0..1 (staggered per line, highlight last) */
  progress: number;
  /** left-axis label reveal, 0..1 (default 1) */
  leftProgress?: number;
  /** 0..1: fade everything but the highlight (default 0) */
  dim?: number;
  theme: VizTheme;
  format: VizFormat;
  width: number;
  height: number;
  labels?: SlopegraphLabels;
  /** faint row guides (default true) */
  guides?: boolean;
  /** precomputed layout; computed from the props when omitted */
  layout?: SlopegraphLayout;
};

/** Per-row line progress: others share the first 70 %, the highlight climbs over the last 45 %. */
export function lineProgress(
  progress: number,
  rows: readonly { id: string; leftSlot: number }[],
  highlightId: string | undefined,
): Map<string, number> {
  const others = rows.filter((r) => r.id !== highlightId).sort((a, b) => a.leftSlot - b.leftSlot);
  const hasHi = others.length !== rows.length;
  const out = new Map<string, number>();
  const otherSpan = hasHi ? 0.7 : 1;
  others.forEach((r, i) => {
    out.set(r.id, stagger(clamp(progress / otherSpan), i, others.length, 0.55));
  });
  if (hasHi && highlightId) out.set(highlightId, clamp((progress - 0.55) / 0.45));
  return out;
}

export function Slopegraph(props: SlopegraphProps): ReactElement {
  const { rows, highlightId, focus = [], progress, leftProgress = 1, dim = 0, theme, format, width, height } = props;
  const layout =
    props.layout ??
    slopegraphLayout(rows, {
      width,
      height,
      format,
      titles: props.labels,
      nameStyle: props.labels?.nameStyle,
    });
  const fs = layout.fontSize;
  const focusSet = new Set(focus);
  const hasFocus = focusSet.size > 0;
  const perLine = lineProgress(
    progress,
    layout.rows.map((r) => ({ id: r.id, leftSlot: r.left.slot })),
    highlightId,
  );
  const n = layout.rows.length;
  const mono = theme.fonts.data;

  const style = (id: string) => {
    const hi = id === highlightId;
    const foc = focusSet.has(id);
    return {
      hi,
      line: hi ? theme.accent : foc ? theme.inkDim : theme.inkFaint,
      lineWidth: hi ? Math.max(6, fs * 0.2) : foc ? 4 : 3,
      label: hi ? theme.accent : foc || !hasFocus ? theme.ink : theme.inkDim,
      rank: hi ? theme.accent : foc ? theme.inkDim : theme.inkFaint,
      weight: hi || foc ? 700 : 500,
      opacity: hi ? 1 : 1 - 0.82 * clamp(dim),
    };
  };

  // draw order: faint first, focus next, highlight on top
  const order = [...layout.rows].sort((a, b) => {
    const w = (r: typeof a) => (r.id === highlightId ? 2 : focusSet.has(r.id) ? 1 : 0);
    return w(a) - w(b) || a.left.slot - b.left.slot;
  });

  const rightTitleOpacity = interpolate(progress, [0, 0.12], [0, 1]);
  const leftTitleOpacity = interpolate(leftProgress, [0, 0.25], [0, 1]);
  const h = layout.header;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="slopegraph"
    >
      {props.guides !== false
        ? layout.rows.map((r) => (
            <g key={`g-${r.id}`} opacity={0.9}>
              <line
                x1={layout.plot.leftX}
                x2={layout.plot.rightX}
                y1={r.left.y}
                y2={r.left.y}
                stroke={theme.grid}
                strokeWidth={1.5}
              />
            </g>
          ))
        : null}

      {props.labels ? (
        <g>
          <g opacity={leftTitleOpacity}>
            <text
              x={h.leftX}
              y={h.titleY}
              fill={theme.inkDim}
              fontFamily={theme.fonts.display}
              fontWeight={700}
              fontSize={layout.titleFontSize}
              letterSpacing={layout.titleFontSize * 0.08}
            >
              {props.labels.left.toUpperCase()}
            </text>
            {h.leftSub.map((line, i) => (
              <text
                key={`ls-${line}`}
                x={h.leftX}
                y={h.subY + i * h.subLineHeight}
                fill={theme.inkFaint}
                fontFamily={theme.fonts.ui}
                fontSize={layout.subFontSize}
              >
                {line}
              </text>
            ))}
          </g>
          <g opacity={rightTitleOpacity}>
            <text
              x={h.rightX}
              y={h.titleY}
              textAnchor="end"
              fill={theme.ink}
              fontFamily={theme.fonts.display}
              fontWeight={700}
              fontSize={layout.titleFontSize}
              letterSpacing={layout.titleFontSize * 0.08}
            >
              {props.labels.right.toUpperCase()}
            </text>
            {h.rightSub.map((line, i) => (
              <text
                key={`rs-${line}`}
                x={h.rightX}
                y={h.subY + i * h.subLineHeight}
                textAnchor="end"
                fill={theme.inkFaint}
                fontFamily={theme.fonts.ui}
                fontSize={layout.subFontSize}
              >
                {line}
              </text>
            ))}
          </g>
        </g>
      ) : null}

      {order.map((r) => {
        const s = style(r.id);
        const p = perLine.get(r.id) ?? 0;
        const e = easeInOutCubic(p);
        const x2 = lerp(r.left.x, r.right.x, easeOutCubic(p));
        const y2 = lerp(r.left.y, r.right.y, e);
        const leftIn = stagger(leftProgress, r.left.slot, n, 0.7);
        const endIn = interpolate(p, [0.82, 1], [0, 1]);
        const baseline = fs * 0.35;
        return (
          <g key={r.id} opacity={s.opacity} data-row={r.id}>
            {p > 0 ? (
              <line
                x1={r.left.x}
                y1={r.left.y}
                x2={x2}
                y2={y2}
                stroke={s.line}
                strokeWidth={s.lineWidth}
                strokeLinecap="round"
              />
            ) : null}
            <g opacity={leftIn} transform={`translate(${lerp(-fs * 0.6, 0, easeOutCubic(leftIn))} 0)`}>
              <circle cx={r.left.x} cy={r.left.y} r={s.hi ? fs * 0.3 : fs * 0.2} fill={s.line} />
              <text
                x={r.left.rankX}
                y={r.left.labelY + baseline}
                textAnchor="end"
                fill={s.rank}
                fontFamily={mono}
                fontWeight={s.weight}
                fontSize={fs}
                style={TABULAR}
              >
                {r.left.rank}
              </text>
              <text
                x={r.left.nameX}
                y={r.left.labelY + baseline}
                textAnchor="end"
                fill={s.label}
                fontFamily={mono}
                fontWeight={s.weight}
                fontSize={fs}
              >
                {r.label}
              </text>
            </g>
            {p > 0 ? <circle cx={x2} cy={y2} r={s.hi ? fs * 0.3 : fs * 0.2} fill={s.line} /> : null}
            <g opacity={endIn}>
              <text
                x={r.right.rankX}
                y={r.right.labelY + baseline}
                fill={s.rank}
                fontFamily={mono}
                fontWeight={s.weight}
                fontSize={fs}
                style={TABULAR}
              >
                {r.right.rank}
              </text>
              <text
                x={r.right.nameX}
                y={r.right.labelY + baseline}
                fill={s.label}
                fontFamily={mono}
                fontWeight={s.weight}
                fontSize={fs}
              >
                {r.label}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

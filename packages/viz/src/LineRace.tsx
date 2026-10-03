/**
 * Line race as React SVG: revealed lines, head dots and end-of-line labels, from `lineRaceLayout`.
 * A pure function of its props (no state, effects or CSS animation).
 *
 * How a composition uses it (see season-points-fight / career-form-curves): map video time to data
 * time with the composition's own timing plan, then render one frame per call -
 *
 *   <LineRace
 *     series={contenders}            // {id, label, points: {t: round, v: cumulative points}[]}
 *     t={dataTime(frame)}            // fractional data time, e.g. 7.4 = 40 % between round 7 and 8
 *     xDomain={[1, 24]}              // declared, never taken from the sample
 *     yDomain={[0, 100]} growOnly    // start window; widens with the leader, never shrinks
 *     width={885} height={1100} theme={theme}
 *   />
 *
 * Pair it with <DataClock value={dataTime(frame)} domain={[1, 24]} prefix="R12"/> for the data time.
 */
import type { ReactElement } from "react";
import { type LineRaceOptions, lineRaceLayout } from "./line-race";
import { TABULAR, type VizTheme } from "./types";

export type LineRaceProps = LineRaceOptions & {
  theme: VizTheme;
  /** highlighted series id; default = the current leader */
  highlightId?: string;
  /** faint horizontal guides with value labels (default true) */
  guides?: boolean;
};

export function LineRace(props: LineRaceProps): ReactElement {
  const { theme, width, height } = props;
  const layout = lineRaceLayout(props);
  const { fontSize, plot } = layout;
  const hot = props.highlightId ?? layout.leaderId;
  // the highlighted line is drawn last so it is never buried
  const drawn = layout.series.filter((s) => s.visible).sort((a, b) => Number(a.id === hot) - Number(b.id === hot));

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="line race"
    >
      {props.guides !== false
        ? layout.yTicks.map((tk) => (
            <g key={`y-${tk.value}`}>
              <line x1={plot.left} x2={plot.right} y1={tk.y} y2={tk.y} stroke={theme.grid} strokeWidth={1.5} />
              <text
                x={plot.left}
                y={tk.y - fontSize * 0.25}
                fill={theme.inkFaint}
                fontFamily={theme.fonts.data}
                fontSize={fontSize}
                style={TABULAR}
              >
                {tk.label}
              </text>
            </g>
          ))
        : null}

      {drawn.map((s) => {
        const on = s.id === hot;
        return (
          <path
            key={`p-${s.id}`}
            d={s.path}
            fill="none"
            stroke={s.color}
            strokeWidth={on ? 6 : 4}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={on ? 1 : 0.85}
          />
        );
      })}

      {drawn.map((s) => {
        const on = s.id === hot;
        const h = s.head as { x: number; y: number };
        return (
          <g key={`h-${s.id}`}>
            <circle cx={h.x} cy={h.y} r={on ? 10 : 7} fill={s.color} stroke={theme.background} strokeWidth={3} />
            <text
              x={s.labelX}
              y={(s.labelY as number) + fontSize * 0.35}
              fill={on ? theme.ink : theme.inkDim}
              fontFamily={theme.fonts.ui}
              fontWeight={on ? 700 : 500}
              fontSize={fontSize}
            >
              {s.label}
              <tspan dx={fontSize * 0.5} fontFamily={theme.fonts.data} style={TABULAR}>
                {s.valueText}
              </tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

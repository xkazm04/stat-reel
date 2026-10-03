/**
 * One frame of EraAdjustedSlope as a pure function of (props, t, format, theme). No Remotion
 * hooks here, so tests render any `t` directly and frames are identical in any order.
 */
import { BurnedCaptions } from "@statreel/captions";
import type { VideoTheme } from "@statreel/design-tokens";
import type { EraAdjustedProps, Format } from "@statreel/schemas";
import {
  Callout,
  easeOutCubic,
  fitText,
  interpolate,
  ordinal,
  ordinalSuffix,
  Slopegraph,
  type SlopeRow,
  slopegraphLayout,
  TABULAR,
} from "@statreel/viz";
import type { CSSProperties, ReactElement } from "react";
import { type FrameLayout, frameLayout } from "./layout";
import { SafeZoneOverlay } from "./SafeZoneOverlay";
import { frameState, type ResolvedScene, resolveScenes, type TimingInput } from "./timing";

/** Props as Remotion hands them over: zod defaults (show_safe_zone, timing.music, ...) may be absent. */
export type EraAdjustedInput = Omit<EraAdjustedProps, "show_safe_zone" | "timing" | "scenes"> & {
  show_safe_zone?: boolean;
  timing?: TimingInput;
  scenes: (Omit<EraAdjustedProps["scenes"][number], "focus"> & { focus?: string[] })[];
};

export const DISCLOSURE_TEXT = "AI VOICE · AI MUSIC";

const abs = (r: { x: number; y: number; width: number; height: number }): CSSProperties => ({
  position: "absolute",
  left: r.x,
  top: r.y,
  width: r.width,
  height: r.height,
});

export function toSlopeRows(rows: EraAdjustedInput["rows"]): SlopeRow[] {
  return rows.map((r) => ({ id: r.player_id, name: r.name, left: r.raw_rank, right: r.adjusted_rank }));
}

function MetaRow({ props, L, theme }: { props: EraAdjustedInput; L: FrameLayout; theme: VideoTheme }) {
  const fs = L.metaFontSize;
  return (
    <div
      style={{
        ...abs(L.meta),
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        fontFamily: theme.fonts.data,
        fontSize: fs,
        lineHeight: 1,
      }}
    >
      <div
        data-disclosure=""
        style={{
          flex: "none",
          border: `2px solid ${theme.inkDim}`,
          borderRadius: 6,
          padding: "5px 10px 4px",
          color: theme.ink,
          letterSpacing: fs * 0.06,
          whiteSpace: "nowrap",
        }}
      >
        {DISCLOSURE_TEXT}
      </div>
      <div
        data-attribution=""
        style={{
          minWidth: 0,
          color: theme.inkDim,
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          letterSpacing: fs * 0.02,
        }}
      >
        {props.attribution}
      </div>
    </div>
  );
}

function MethodNote({ props, L, theme }: { props: EraAdjustedInput; L: FrameLayout; theme: VideoTheme }) {
  return (
    <div
      data-method=""
      style={{
        ...abs(L.method),
        fontFamily: theme.fonts.ui,
        fontSize: L.methodFontSize,
        lineHeight: 1.2,
        color: theme.inkDim,
        overflow: "hidden",
      }}
    >
      {props.method_note}
    </div>
  );
}

/** Hook and close share one block, so the last frame loops back onto the first. */
function Statement({
  text,
  opacity,
  L,
  theme,
  format,
  kind,
}: {
  text: string;
  opacity: number;
  L: FrameLayout;
  theme: VideoTheme;
  format: Format;
  kind: "hook" | "close";
}) {
  if (opacity <= 0) return null;
  const box = L.statement;
  const fit = fitText(text.toUpperCase(), {
    maxWidth: box.width,
    maxHeight: box.height - 40,
    maxLines: format === "vertical" ? 5 : 4,
    min: 64,
    max: format === "vertical" ? 170 : 150,
    face: "condensedCaps",
    lineHeight: 0.96,
  });
  const blockH = fit.lines.length * fit.fontSize * 0.96;
  return (
    <div
      data-statement={kind}
      style={{
        ...abs(box),
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        opacity,
      }}
    >
      <div style={{ width: 96, height: 6, background: theme.inkDim, marginBottom: 34 }} />
      <div
        style={{
          fontFamily: theme.fonts.display,
          fontWeight: 800,
          fontSize: fit.fontSize,
          lineHeight: 0.96,
          color: theme.ink,
          height: blockH,
          whiteSpace: "pre",
          ...TABULAR,
        }}
      >
        {fit.lines.join("\n")}
      </div>
    </div>
  );
}

function Headlines({
  items,
  L,
  theme,
}: {
  items: { id: string; text: string; opacity: number }[];
  L: FrameLayout;
  theme: VideoTheme;
}) {
  const box = L.headline;
  return (
    <>
      {items.map((h) => {
        const fit = fitText(h.text.toUpperCase(), {
          maxWidth: box.width,
          maxHeight: box.height,
          maxLines: box.height > 120 ? 3 : 1,
          min: 36,
          max: box.height > 120 ? 88 : 58,
          face: "condensedCaps",
          lineHeight: 1,
          letterSpacingEm: 0.02,
        });
        const rise = interpolate(h.opacity, [0, 1], [10, 0], { easing: easeOutCubic });
        return (
          <div
            key={h.id}
            data-headline={h.id}
            style={{
              ...abs(box),
              opacity: h.opacity,
              transform: `translateY(${rise}px)`,
              fontFamily: theme.fonts.display,
              fontWeight: 700,
              fontSize: fit.fontSize,
              lineHeight: 1,
              letterSpacing: fit.fontSize * 0.02,
              color: theme.ink,
              whiteSpace: "pre",
              ...TABULAR,
            }}
          >
            {fit.lines.join("\n")}
          </div>
        );
      })}
    </>
  );
}

function Payoff({
  props,
  L,
  theme,
  format,
  t,
  t0,
  opacity,
}: {
  props: EraAdjustedInput;
  L: FrameLayout;
  theme: VideoTheme;
  format: Format;
  t: number;
  t0: number;
  opacity: number;
}) {
  if (opacity <= 0) return null;
  const hi = props.rows.find((r) => r.player_id === props.highlight_player_id);
  if (!hi) return null;
  const box = L.callout;
  const vertical = format === "vertical";
  const rankFs = vertical ? 212 : 190;
  const valueFs = vertical ? 108 : 104;
  const nameFs = vertical ? 52 : 48;
  const rise = interpolate(opacity, [0, 1], [18, 0], { easing: easeOutCubic });
  // rank-led (ADR 003 #3): the adjusted rank is the headline figure, the adjusted value is
  // secondary, rounded to one decimal and always labelled era-adjusted
  return (
    <div
      data-payoff=""
      style={{
        ...abs(box),
        opacity,
        transform: `translateY(${rise}px)`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 18,
      }}
    >
      <div
        style={{
          fontFamily: theme.fonts.display,
          fontWeight: 700,
          fontSize: nameFs,
          letterSpacing: nameFs * 0.04,
          color: theme.ink,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {hi.name.toUpperCase()}
      </div>
      <Callout
        value={hi.adjusted_rank}
        from={hi.raw_rank}
        t={t}
        start={t0}
        duration={1.8}
        prefix={`${ordinal(hi.raw_rank).toUpperCase()} →`}
        prefixScale={0.4}
        prefixColor={theme.inkDim}
        suffix={(n) => ordinalSuffix(n).toUpperCase()}
        suffixScale={0.46}
        label="Era-adjusted rank"
        labelFontSize={28}
        theme={theme}
        fontSize={rankFs}
        color={theme.accentInk}
        width={box.width}
      />
      <div style={{ flex: "none", height: 2, background: theme.grid, width: box.width, margin: "4px 0" }} />
      <Callout
        value={hi.adjusted_value}
        from={0}
        t={t}
        start={t0 + 0.5}
        duration={1.6}
        decimals={1}
        theme={theme}
        fontSize={valueFs}
        color={theme.ink}
        width={box.width}
      />
      <div
        style={{
          fontFamily: theme.fonts.data,
          fontSize: 28,
          lineHeight: 1.3,
          letterSpacing: 1,
          color: theme.inkDim,
          marginTop: -8,
        }}
      >
        {(/era-adjusted/i.test(props.metric_adjusted_label) ? props.metric_adjusted_label : `${props.metric_adjusted_label} · era-adjusted`).toUpperCase()}
      </div>
    </div>
  );
}

export type EraAdjustedFrameProps = {
  props: EraAdjustedInput;
  t: number;
  format: Format;
  theme: VideoTheme;
  /** precomputed scene windows (the component memoises them); derived from props when omitted */
  scenes?: ResolvedScene[];
};

export function EraAdjustedFrame({ props, t, format, theme, scenes: pre }: EraAdjustedFrameProps): ReactElement {
  const L = frameLayout(format);
  const scenes = pre ?? resolveScenes(props.scenes, props.timing);
  const s = frameState(scenes, t, format);
  const rows = toSlopeRows(props.rows);
  const labels = {
    left: "Raw rank",
    right: "Era-adjusted rank",
    leftSub: props.metric_raw_label,
    rightSub: props.metric_adjusted_label,
  };
  const layoutOpts = {
    width: L.chart.width,
    height: L.chart.height,
    format,
    titles: labels,
    maxStep: format === "vertical" ? 92 : 100,
  };
  // short lists leave slack below the last row: spend some of it as air under the headline
  const tight = slopegraphLayout(rows, layoutOpts);
  const lowest = Math.max(...tight.rows.flatMap((r) => [r.left.labelY, r.right.labelY]));
  const slack = L.chart.height - (lowest + tight.fontSize * 0.4);
  const layout =
    slack > 4 ? slopegraphLayout(rows, { ...layoutOpts, padding: { top: Math.min(28, slack - 4) } }) : tight;
  const hook = scenes.find((x) => x.kind === "hook");
  const close = scenes.find((x) => x.kind === "close");

  return (
    <div
      data-frame={format}
      style={{
        position: "absolute",
        inset: 0,
        width: L.width,
        height: L.height,
        overflow: "hidden",
        background: theme.background,
        color: theme.ink,
      }}
    >
      <Glass L={L} theme={theme} />
      <div data-chart="" style={{ ...abs(L.chart), opacity: s.chartOpacity }}>
        {s.chartOpacity > 0 ? (
          <Slopegraph
            rows={rows}
            highlightId={props.highlight_player_id}
            focus={s.focus}
            progress={s.lineProgress}
            leftProgress={s.leftProgress}
            dim={s.dim}
            theme={theme}
            format={format}
            width={L.chart.width}
            height={L.chart.height}
            labels={labels}
            layout={layout}
          />
        ) : null}
      </div>
      <Headlines items={s.headlines} L={L} theme={theme} />
      <Payoff props={props} L={L} theme={theme} format={format} t={t} t0={s.callout.t0} opacity={s.callout.opacity} />
      {hook ? (
        <Statement text={hook.on_screen} opacity={s.hookOpacity} L={L} theme={theme} format={format} kind="hook" />
      ) : null}
      {close ? (
        <Statement text={close.on_screen} opacity={s.closeOpacity} L={L} theme={theme} format={format} kind="close" />
      ) : null}
      <MetaRow props={props} L={L} theme={theme} />
      <MethodNote props={props} L={L} theme={theme} />
      <BurnedCaptions cues={props.timing?.cues ?? []} t={t} format={format} theme={theme} />
      {props.show_safe_zone ? <SafeZoneOverlay format={format} /> : null}
    </div>
  );
}

/** Black display glass: a faint rule under the meta block and a hairline frame on the critical box. */
function Glass({ L, theme }: { L: FrameLayout; theme: VideoTheme }) {
  const c = L.critical;
  const ruleY = L.method.y + L.method.height + 10;
  return (
    <svg
      width={L.width}
      height={L.height}
      viewBox={`0 0 ${L.width} ${L.height}`}
      style={{ position: "absolute", left: 0, top: 0 }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="sr-glass" cx="50%" cy="38%" r="75%">
          <stop offset="0%" stopColor={theme.surface} />
          <stop offset="100%" stopColor={theme.background} />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={L.width} height={L.height} fill="url(#sr-glass)" />
      <line x1={c.x + 8} x2={c.x + c.width - 8} y1={ruleY} y2={ruleY} stroke={theme.grid} strokeWidth={2} />
    </svg>
  );
}

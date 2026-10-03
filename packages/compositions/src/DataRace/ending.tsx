/**
 * The fixed ending of every DataRace video, rendered by the composition (never by props):
 *   1. winner spotlight        60 frames  (final #1 enlarged, logo, 1-2 fact-ref'd stats)
 *   2. like & subscribe        60 frames
 *   3. Powered by StatReel     90 frames  (Frame Stat logo, geometry from design-tokens `frameStatRects`)
 */
import { FRAME_STAT_VIEWBOX, frameStatRects, videoTheme } from "@statreel/design-tokens";
import { ENDING_FRAMES, type DataRaceProps } from "@statreel/schemas";
import type { CSSProperties, ReactElement } from "react";
import { LogoTile, TNUM, formatValue } from "./parts";

const T = videoTheme;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smooth = (x: number): number => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
const easeOutBack = (x: number): number => {
  const c = clamp01(x);
  const k = 1.70158;
  return 1 + (k + 1) * (c - 1) ** 3 + k * (c - 1) ** 2;
};

/** x of each sprocket hole of the drifting film strip */
const SPROCKETS = Array.from({ length: 22 }, (_, n) => n * 64 + 18);
const BAR_KEYS = ["bar-a", "bar-b", "bar-c", "bar-d"] as const;

const fill: CSSProperties = { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: T.background, overflow: "hidden" };

/** Opacity of an ending scene: quick fade in, quick fade out (the last scene holds). */
const sceneOpacity = (f: number, len: number, fadeOut: boolean): number =>
  Math.min(clamp01(f / 8), fadeOut ? clamp01((len - f) / 8) : 1);

export function WinnerSpotlight({ props, winnerId, f }: { props: DataRaceProps; winnerId: string; f: number }): ReactElement | null {
  const e = props.entities.find((x) => x.id === winnerId);
  if (!e) return null;
  const last = e.values[e.values.length - 1] ?? 0;
  const op = sceneOpacity(f, ENDING_FRAMES.spotlight, true);
  const pop = easeOutBack(f / 16);
  return (
    <div data-ending="spotlight" style={{ ...fill, opacity: op }}>
      <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: 20, background: e.color }} />
      <div style={{ fontFamily: T.fonts.data, fontWeight: 700, fontSize: 34, letterSpacing: 6, color: T.inkDim, marginBottom: 36 }}>NO. 1 AT THE END</div>
      <div style={{ transform: `scale(${0.7 + 0.3 * pop})` }}>
        <LogoTile entity={e} size={360} radius={64} />
      </div>
      <div style={{ fontFamily: T.fonts.display, fontWeight: 800, fontSize: 132, lineHeight: 1.05, color: T.ink, marginTop: 40, opacity: smooth((f - 6) / 12) }}>{e.name}</div>
      <div style={{ fontFamily: T.fonts.data, fontWeight: 700, fontSize: 84, color: e.color, marginTop: 4, opacity: smooth((f - 10) / 12), ...TNUM }}>
        {formatValue(last, props.value_format)}
      </div>
      <div style={{ fontFamily: T.fonts.ui, fontWeight: 500, fontSize: 30, color: T.inkDim, opacity: smooth((f - 10) / 12) }}>{props.unit_label}</div>
      <div style={{ marginTop: 44, display: "flex", flexDirection: "column", gap: 14, alignItems: "center", opacity: smooth((f - 16) / 14) }}>
        {props.spotlight.facts.map((s) => (
          <div key={s.ref} style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
            <span style={{ fontFamily: T.fonts.ui, fontWeight: 500, fontSize: 32, color: T.inkDim }}>{s.label}</span>
            <span style={{ fontFamily: T.fonts.display, fontWeight: 700, fontSize: 60, color: T.ink, ...TNUM }}>{s.value_text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ThumbUp({ size }: { size: number }): ReactElement {
  // a plain thumbs-up silhouette on a 24 grid (own drawing)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 10h4v11H2z" fill={T.ink} />
      <path d="M8 21V10l4-8c1.7 0 2.8 1.3 2.5 3L14 9h6c1.1 0 2 .9 1.8 2l-1.5 8c-.2 1.2-1.2 2-2.3 2z" fill={T.ink} />
    </svg>
  );
}

function Bell({ size, color }: { size: number; color: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a6 6 0 0 0-6 6v4l-2 4h16l-2-4V8a6 6 0 0 0-6-6z" fill={color} />
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0z" fill={color} />
    </svg>
  );
}

export function LikeSubscribe({ f }: { f: number }): ReactElement {
  const op = sceneOpacity(f, ENDING_FRAMES.like, true);
  const thumb = easeOutBack(f / 16);
  const button = easeOutBack((f - 10) / 16);
  const pulse = 1 + 0.035 * Math.sin(Math.max(0, f - 28) * 0.45) * clamp01((f - 26) / 6);
  return (
    <div data-ending="like-subscribe" style={{ ...fill, opacity: op }}>
      <div style={{ transform: `scale(${thumb})`, display: "flex", alignItems: "center", gap: 28 }}>
        <ThumbUp size={170} />
        <div style={{ fontFamily: T.fonts.display, fontWeight: 800, fontSize: 190, lineHeight: 1, color: T.ink }}>LIKE</div>
      </div>
      <div style={{ fontFamily: T.fonts.display, fontWeight: 700, fontSize: 80, color: T.inkDim, margin: "26px 0", opacity: smooth((f - 6) / 10) }}>&amp;</div>
      <div
        style={{ transform: `scale(${button * pulse})`, display: "flex", alignItems: "center", gap: 28, background: T.accent, color: T.background, padding: "28px 64px", borderRadius: 999, fontFamily: T.fonts.display, fontWeight: 800, fontSize: 112, lineHeight: 1 }}
      >
        <Bell size={104} color={T.background} />
        SUBSCRIBE
      </div>
      <div style={{ fontFamily: T.fonts.ui, fontWeight: 500, fontSize: 36, color: T.inkDim, marginTop: 48, opacity: smooth((f - 24) / 14) }}>for the next race</div>
    </div>
  );
}

/** The Frame Stat mark, drawn from the single geometry in design-tokens (`frameStatRects`). */
export function FrameStatMark({ t, width, bars }: { t: number; width: number; bars: readonly [string, string, string, string] }): ReactElement {
  const [, , vw, vh] = FRAME_STAT_VIEWBOX.split(" ").map(Number) as [number, number, number, number];
  return (
    <svg data-logo="frame-stat" width={width} height={(width * vh) / vw} viewBox={FRAME_STAT_VIEWBOX} aria-label="StatReel">
      {frameStatRects(t).map((r) => (
        <rect
          key={`${r.role}-${r.i}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={r.rx}
          fill={r.role === "frame" ? T.ink : r.role === "bar" ? bars[r.i] : r.role === "window" ? T.surface : T.background}
        />
      ))}
    </svg>
  );
}

export function PoweredBy({ f, bars }: { f: number; bars: readonly [string, string, string, string] }): ReactElement {
  const op = sceneOpacity(f, ENDING_FRAMES.powered, false);
  const t = clamp01(f / 54);
  const word = smooth((t - 0.35) / 0.4);
  const drift = (f * 2.2) % 64;
  return (
    <div data-ending="powered-by" style={{ ...fill, opacity: op }}>
      {/* motion cue 1: a faint film strip advances behind the mark */}
      <div style={{ position: "absolute", left: -64, top: 700, width: 1300, height: 230, background: T.ink, opacity: 0.06, transform: `translateX(${-drift}px)` }}>
        {SPROCKETS.map((x) => (
          <div key={`t${x}`} style={{ position: "absolute", left: x, top: 18, width: 30, height: 26, borderRadius: 6, background: T.background }} />
        ))}
        {SPROCKETS.map((x) => (
          <div key={`b${x}`} style={{ position: "absolute", left: x, bottom: 18, width: 30, height: 26, borderRadius: 6, background: T.background }} />
        ))}
      </div>
      <div style={{ fontFamily: T.fonts.data, fontWeight: 600, fontSize: 32, letterSpacing: 8, color: T.inkDim, marginBottom: 30, position: "relative" }}>POWERED BY</div>
      {/* motion cue 2: the mark's bars rise */}
      <div style={{ position: "relative" }}>
        <FrameStatMark t={t} width={520} bars={bars} />
      </div>
      <div style={{ fontFamily: T.fonts.display, fontWeight: 800, fontSize: 160, lineHeight: 1, marginTop: 20, color: T.ink, opacity: word, transform: `translateY(${(1 - word) * 20}px)`, position: "relative" }}>
        Stat<span style={{ color: T.accent }}>Reel</span>
      </div>
      <div style={{ fontFamily: T.fonts.ui, fontWeight: 500, fontSize: 36, color: T.inkDim, marginTop: 16, opacity: smooth((t - 0.6) / 0.4), position: "relative" }}>data in, short video out</div>
      <div style={{ width: 400, height: 12, borderRadius: 6, marginTop: 44, display: "flex", overflow: "hidden", position: "relative", opacity: smooth((t - 0.6) / 0.4) }}>
        {BAR_KEYS.map((k, i) => (
          <div key={k} style={{ flex: 1, background: bars[i] }} />
        ))}
      </div>
    </div>
  );
}


/**
 * The fixed ending of every DataRace video, rendered by the composition (never by props):
 *   1. winner spotlight        60 frames  (final #1 enlarged, logo, 1-2 fact-ref'd stats)
 *   2. like & subscribe        60 frames
 *   3. Powered by StatReel     90 frames  (Frame Stat logo, geometry from design-tokens `frameStatRects`)
 */
import { FRAME_STAT_VIEWBOX, frameStatRects, videoTheme } from "@statreel/design-tokens";
import { ENDING_FRAMES, type DataRaceProps } from "@statreel/schemas";
import type { CSSProperties, ReactElement } from "react";
import { L, LogoTile, TNUM, formatValue } from "./parts";

const T = videoTheme;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smooth = (x: number): number => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/** x of each sprocket hole of the drifting film strip */
const SPROCKETS = Array.from({ length: 22 }, (_, n) => n * 64 + 18);
const BAR_KEYS = ["bar-a", "bar-b", "bar-c", "bar-d"] as const;

const fill: CSSProperties = { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: T.background, overflow: "hidden" };

/** Opacity of an ending scene: quick fade in, quick fade out (the last scene holds). */
const sceneOpacity = (f: number, len: number, fadeOut: boolean): number =>
  Math.min(clamp01(f / 8), fadeOut ? clamp01((len - f) / 8) : 1);

/** The spotlight dims every row but the winner's to this opacity (art direction: others ~20 %). */
export const SPOTLIGHT_DIM = 0.2;
/** ... and enlarges the winner's mark by this much (~8 %). */
export const SPOTLIGHT_SCALE = 0.08;

/** Opacity of a non-winner row `f` frames into the spotlight: 1 -> 0.2 over 8 frames. */
export const spotlightDim = (f: number): number => SPOTLIGHT_DIM + (1 - SPOTLIGHT_DIM) * (1 - smooth(f / 8));
/** Scale of the winner's row `f` frames into the spotlight: 1 -> 1.08 over 10 frames. */
export const spotlightScale = (f: number): number => 1 + SPOTLIGHT_SCALE * smooth(f / 10);

/**
 * Winner spotlight. It does NOT cover the race: the chart stays on screen (DataRaceFrame dims the
 * other rows to 20 % and scales the winner's), and this overlay adds the winner card below the rows.
 * The value is set in ink; the entity colour stays on a non-text swatch (a yellow entity colour is
 * ~2:1 on the sheet, see contrast.ts).
 */
export function WinnerSpotlight({ props, winnerId, f }: { props: DataRaceProps; winnerId: string; f: number }): ReactElement | null {
  const e = props.entities.find((x) => x.id === winnerId);
  if (!e) return null;
  const last = e.values[e.values.length - 1] ?? 0;
  const op = Math.min(smooth((f - 6) / 12), clamp01((ENDING_FRAMES.spotlight - f) / 8));
  const top = L.barsTop + L.rowH * props.entities.length + 40;
  return (
    <div data-ending="spotlight" style={{ position: "absolute", left: L.marginX, top, width: L.width - 2 * L.marginX, opacity: op }}>
      <div style={{ height: 44, display: "flex", alignItems: "center", fontFamily: T.fonts.data, fontWeight: 700, fontSize: 34, letterSpacing: 6, color: T.inkDim }}>NO. 1 AT THE END</div>
      <div style={{ marginTop: 14, height: 120, display: "flex", alignItems: "center", gap: 24 }}>
        <LogoTile entity={e} size={120} radius={26} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontFamily: T.fonts.display, fontWeight: 800, fontSize: 88, lineHeight: 1, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</div>
          <div style={{ fontFamily: T.fonts.ui, fontWeight: 500, fontSize: 30, lineHeight: "34px", color: T.inkDim, whiteSpace: "nowrap" }}>{props.unit_label}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div data-winner-swatch="" style={{ width: 14, height: 76, borderRadius: 7, background: e.color }} />
          <div data-winner-value="" style={{ fontFamily: T.fonts.data, fontWeight: 700, fontSize: 84, lineHeight: 1, color: T.ink, whiteSpace: "nowrap", ...TNUM }}>
            {formatValue(last, props.value_format)}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 14 }}>
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

/**
 * Like & subscribe. ONE motion cue (art direction): the bell rings. Everything else is static, so
 * the viewer reads the ask once. The button is `accentInk` so its sheet-coloured label is >= 4.5:1.
 */
export function LikeSubscribe({ f }: { f: number }): ReactElement {
  const op = sceneOpacity(f, ENDING_FRAMES.like, true);
  const t = Math.max(0, f - 6);
  const ring = 22 * Math.exp(-t / 16) * Math.sin(t * 0.85);
  return (
    <div data-ending="like-subscribe" style={{ ...fill, opacity: op }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <ThumbUp size={170} />
        <div style={{ fontFamily: T.fonts.display, fontWeight: 800, fontSize: 190, lineHeight: 1, color: T.ink }}>LIKE</div>
      </div>
      <div style={{ fontFamily: T.fonts.display, fontWeight: 700, fontSize: 80, color: T.inkDim, margin: "26px 0" }}>&amp;</div>
      <div
        style={{ display: "flex", alignItems: "center", gap: 28, background: T.accentInk, color: T.background, padding: "28px 64px", borderRadius: 999, fontFamily: T.fonts.display, fontWeight: 800, fontSize: 112, lineHeight: 1 }}
      >
        <div data-bell="" style={{ display: "flex", transform: `rotate(${ring.toFixed(2)}deg)`, transformOrigin: "50% 12%" }}>
          <Bell size={104} color={T.background} />
        </div>
        SUBSCRIBE
      </div>
      <div style={{ fontFamily: T.fonts.ui, fontWeight: 500, fontSize: 36, color: T.inkDim, marginTop: 48 }}>for the next race</div>
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
        Stat<span data-wordmark="" style={{ color: T.accentInk }}>Reel</span>
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


/** Centre rack: the Remotion Player with a Patchbay transport (play, timecode, scrubber), format and safe-zone toggles. */
import type { PlayerRef } from "@remotion/player";
import type { EraAdjustedProps, Format } from "@statreel/schemas";
import { type RefObject, useEffect, useState } from "react";
import { type PlayerMeta, PlayerStage } from "../components/PlayerStage";
import { Module, Toggle } from "../components/ui";
import { timecode } from "../logic";

export function ScreenPanel({
  props,
  format,
  setFormat,
  formats,
  safe,
  setSafe,
  playerRef,
  meta,
  setMeta,
  frame,
  setFrame,
  compositionName,
}: {
  props: EraAdjustedProps | null;
  format: Format;
  setFormat: (f: Format) => void;
  formats: Format[];
  safe: boolean;
  setSafe: (b: boolean) => void;
  playerRef: RefObject<PlayerRef | null>;
  meta: PlayerMeta | null;
  setMeta: (m: PlayerMeta | null) => void;
  frame: number;
  setFrame: (f: number) => void;
  compositionName: string | null | undefined;
}) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !meta) return;
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    p.addEventListener("play", on);
    p.addEventListener("pause", off);
    p.addEventListener("ended", off);
    return () => {
      p.removeEventListener("play", on);
      p.removeEventListener("pause", off);
      p.removeEventListener("ended", off);
    };
  }, [playerRef, meta]);

  const total = meta?.durationInFrames ?? 0;
  const fps = meta?.fps ?? 30;
  const pct = total > 1 ? (frame / (total - 1)) * 100 : 0;
  const dims = format === "vertical" ? "1080×1920 · 9:16" : "1920×1080 · 16:9";
  const ticks = props?.timing?.scenes.map((s) => s.start_s / (props.timing?.duration_s || 1)) ?? [];
  const seek = (f: number) => {
    const clamped = Math.max(0, Math.min(total - 1, Math.round(f)));
    playerRef.current?.seekTo(clamped);
    setFrame(clamped);
  };

  return (
    <Module id="m-screen" title="Screen" tag={`${dims} · ${fps} fps`} className="mod screen-mod">
      <div className={`screen-wrap ${format === "vertical" ? "v" : "l"}`} data-testid="player">
        <PlayerStage
          props={props}
          format={format}
          safeZone={safe}
          playerRef={playerRef}
          onMeta={setMeta}
          onFrame={setFrame}
          compositionName={compositionName}
          empty={
            <>
              <span className="k">no props · nothing to play</span>
              <h3>Draft first</h3>
              <p>
                The co-pilot stores fact-bound props; the EraAdjustedSlope composition plays them here, frame-exact with
                the render.
              </p>
            </>
          }
        />
      </div>
      <div className="transport">
        <button
          type="button"
          className="key primary small"
          aria-pressed={playing}
          disabled={!meta}
          onClick={() => (playing ? playerRef.current?.pause() : playerRef.current?.play())}
          data-testid="play"
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <span className="display tc">
          {timecode(frame, fps)}
          <span className="tc-total"> / {timecode(Math.max(0, total - 1), fps)}</span>
        </span>
        <div className="scrub">
          <div className="track">
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
          {ticks.map((t) => (
            <span key={t} className="tick" style={{ left: `${t * 100}%` }} aria-hidden="true" />
          ))}
          <span className="knob" style={{ left: `${pct}%` }} aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            step={1}
            value={frame}
            disabled={!meta}
            aria-label="Scrub timeline"
            aria-valuetext={timecode(frame, fps)}
            onChange={(e) => {
              playerRef.current?.pause();
              seek(Number(e.target.value));
            }}
            data-testid="scrubber"
          />
        </div>
      </div>
      <div className="screen-toggles">
        <Toggle
          title="Frame"
          label="Preview format"
          value={format}
          onChange={setFormat}
          testIdPrefix="format-"
          options={(["vertical", "landscape"] as Format[]).map((f) => ({
            value: f,
            label: f === "vertical" ? "9:16" : "16:9",
          }))}
        />
        <Toggle
          title="Safe zone"
          label="Safe-zone overlay"
          value={safe ? "on" : "off"}
          onChange={(v) => setSafe(v === "on")}
          testIdPrefix="safe-zone-"
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
          ]}
        />
      </div>
      {!formats.includes(format) ? (
        <p className="mono warn">this use case does not declare the {format} format</p>
      ) : null}
      <p className="mono muted screen-note">Preview only: the format and overlay toggles do not change stored props.</p>
    </Module>
  );
}

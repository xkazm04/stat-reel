/**
 * The output display: a @remotion/player Player of EraAdjustedSlope inside the black bezel. While
 * @statreel/compositions is not loadable it shows a clearly-labelled placeholder (never a fake render).
 */
import { Player, type PlayerRef } from "@remotion/player";
import type { EraAdjustedProps, Format } from "@statreel/schemas";
import { type ReactNode, type RefObject, useEffect, useMemo } from "react";
import { useComposition } from "../composition";
import { Led } from "./glyphs";

export type PlayerMeta = { fps: number; durationInFrames: number };

export function PlayerStage({
  props,
  format,
  safeZone,
  playerRef,
  onMeta,
  onFrame,
  autoPlay,
  loop,
  muted,
  empty,
  compositionName,
}: {
  props: EraAdjustedProps | null | undefined;
  format: Format;
  safeZone?: boolean;
  playerRef?: RefObject<PlayerRef | null>;
  onMeta?: (m: PlayerMeta | null) => void;
  onFrame?: (frame: number) => void;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  empty: ReactNode;
  /** the use case's composition; anything but EraAdjustedSlope has no player yet */
  compositionName?: string | null;
}) {
  const comp = useComposition();
  const wantsEra = compositionName === undefined || compositionName === "EraAdjustedSlope";
  const inputProps = useMemo(
    () =>
      props
        ? ({ ...props, format, show_safe_zone: safeZone ?? props.show_safe_zone ?? false } as Record<string, unknown>)
        : null,
    [props, format, safeZone],
  );
  const meta = useMemo<PlayerMeta | null>(
    () =>
      comp.status === "ready" && props && wantsEra
        ? { fps: comp.fps, durationInFrames: comp.durationInFrames(props) }
        : null,
    [comp, props, wantsEra],
  );

  useEffect(() => {
    onMeta?.(meta);
  }, [meta, onMeta]);

  useEffect(() => {
    const p = playerRef?.current;
    if (!p || !onFrame || !meta) return;
    const h = (e: { detail: { frame: number } }) => onFrame(e.detail.frame);
    p.addEventListener("frameupdate", h);
    return () => p.removeEventListener("frameupdate", h);
  }, [playerRef, onFrame, meta]);

  const aspect = format === "vertical" ? "v" : "l";
  let body: ReactNode;
  if (!props || !inputProps) body = <div className="still">{empty}</div>;
  else if (!wantsEra)
    body = (
      <div className="still">
        <Led status="ask" label="NOT BUILT" className="on-display" />
        <h3>{props.title}</h3>
        <p>
          Composition <span className="mono">{compositionName ?? "none"}</span> is not implemented yet; only
          EraAdjustedSlope has a player.
        </p>
      </div>
    );
  else if (comp.status === "loading")
    body = (
      <div className="still">
        <Led status="running" label="LOADING" className="on-display" />
        <p>Loading the composition…</p>
      </div>
    );
  else if (comp.status === "missing")
    body = (
      <div className="still" data-placeholder="composition-missing">
        <Led status="ask" label="PLACEHOLDER" className="on-display" />
        <span className="k">not a render · composition unavailable</span>
        <h3>{props.title}</h3>
        <p>{props.scenes[0]?.on_screen}</p>
        <p className="mono">{comp.reason}</p>
      </div>
    );
  else {
    const dims = comp.dimensions(format);
    body = (
      <Player
        ref={playerRef}
        component={comp.Component}
        inputProps={inputProps}
        durationInFrames={meta?.durationInFrames ?? 1}
        fps={comp.fps}
        compositionWidth={dims.width}
        compositionHeight={dims.height}
        style={{ width: "100%", height: "100%" }}
        autoPlay={autoPlay}
        loop={loop}
        initiallyMuted={muted}
        controls={false}
        clickToPlay={false}
        spaceKeyToPlayOrPause={false}
        errorFallback={({ error }) => (
          <div className="still">
            <Led status="blocked" label="RENDER ERROR" className="on-display" />
            <p className="mono">{error.message}</p>
          </div>
        )}
      />
    );
  }
  return (
    <div className="bezel">
      <div className={`frame ${aspect}`}>{body}</div>
    </div>
  );
}

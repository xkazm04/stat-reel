/**
 * The programme monitor: a @remotion/player Player of the real EraAdjustedSlope composition with a
 * project's real props (timing included when the audio stage has run). Without props it shows the
 * slate it is given; a composition that cannot load is a labelled still, never a fake render.
 */
import { Player, type PlayerRef } from "@remotion/player";
import type { EraAdjustedProps, Format } from "@statreel/schemas";
import type { ReactNode } from "react";
import { type RefObject, useEffect, useMemo } from "react";
import { useComposition } from "../composition";
import { playerProps } from "../data";
import { StatusChip } from "./glyphs";

export type PlayerMeta = { fps: number; durationInFrames: number };

export function Programme({
  props,
  format,
  safeZone,
  playerRef,
  onMeta,
  autoPlay,
  loop,
  muted,
  slate,
  compositionName,
}: {
  props: EraAdjustedProps | null | undefined;
  format: Format;
  safeZone?: boolean;
  playerRef?: RefObject<PlayerRef | null>;
  onMeta?: (m: PlayerMeta | null) => void;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  /** what the monitor shows with no props */
  slate: ReactNode;
  /** the use case's composition; anything but EraAdjustedSlope has no player yet */
  compositionName?: string | null;
}) {
  const comp = useComposition();
  const wantsEra = compositionName === undefined || compositionName === "EraAdjustedSlope";
  const inputProps = useMemo(() => {
    const p = playerProps(props);
    return p
      ? ({ ...p, format, show_safe_zone: safeZone ?? p.show_safe_zone ?? false } as Record<string, unknown>)
      : null;
  }, [props, format, safeZone]);
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

  if (!props || !inputProps) return <>{slate}</>;
  if (!wantsEra)
    return (
      <div className="still">
        <StatusChip status="data-ready" label="COMPOSITION NOT BUILT" />
        <p className="still__t">{props.title}</p>
        <p className="still__s">
          Composition <span className="mono">{compositionName ?? "none"}</span> is not implemented yet; only
          EraAdjustedSlope has a player.
        </p>
      </div>
    );
  if (comp.status === "loading")
    return (
      <div className="still">
        <p className="label">Loading the composition</p>
      </div>
    );
  if (comp.status === "missing")
    return (
      <div className="still">
        <StatusChip status="blocked" label="NOT A RENDER" />
        <p className="still__t">{props.title}</p>
        <p className="still__s mono">{comp.reason}</p>
      </div>
    );
  const dims = comp.dimensions(format);
  return (
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
          <StatusChip status="blocked" label="PLAYER ERROR" />
          <p className="still__s mono">{error.message}</p>
        </div>
      )}
    />
  );
}

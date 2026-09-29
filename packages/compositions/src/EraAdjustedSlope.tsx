/**
 * EraAdjustedSlope: the Remotion component. Reads the frame, converts it to seconds and hands `t`
 * to the pure frame renderer. Seek-stable: no state, no effects, no CSS transitions.
 */
import { videoTheme } from "@statreel/design-tokens";
import type { ReactElement } from "react";
import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { AudioTracks } from "./AudioTracks";
import { EraAdjustedFrame, type EraAdjustedInput } from "./EraAdjustedFrame";
import "./fonts";
import { resolveScenes } from "./timing";

export function EraAdjustedSlope(props: EraAdjustedInput): ReactElement {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const format = width > height ? "landscape" : "vertical";
  const scenes = useMemo(() => resolveScenes(props.scenes, props.timing), [props.scenes, props.timing]);
  return (
    <AbsoluteFill style={{ backgroundColor: videoTheme.background }}>
      <EraAdjustedFrame props={props} t={t} format={format} theme={videoTheme} scenes={scenes} />
      <AudioTracks timing={props.timing} fps={fps} />
    </AbsoluteFill>
  );
}

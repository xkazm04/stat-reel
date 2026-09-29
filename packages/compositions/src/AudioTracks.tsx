/**
 * Voice and music as Remotion audio tracks. Voice sits on the timeline at each scene's start_s
 * (the picture cuts voice_lead_s later, see timing.ts); music cues carry their gain in dB.
 * Sources are passed through as given (file URLs or http URLs prepared by the audio stage).
 */
import { dbToGain } from "@statreel/viz";
import type { ReactElement } from "react";
import { Html5Audio, Sequence } from "remotion";
import type { TimingInput } from "./timing";

export type AudioCue = { key: string; src: string; from: number; durationInFrames?: number; volume: number };

/** Frame placement of every audio source; pure, so it is unit-tested without rendering. */
export function audioCues(timing: TimingInput | undefined, fps: number): AudioCue[] {
  if (!timing) return [];
  const voice = timing.scenes
    .filter((s) => Boolean(s.voice_src))
    .map((s) => ({
      key: `voice-${s.scene_id}`,
      src: s.voice_src as string,
      from: Math.max(0, Math.round(s.start_s * fps)),
      volume: 1,
    }));
  const music = (timing.music ?? []).map((m, i) => ({
    key: `music-${i}`,
    src: m.src,
    from: Math.max(0, Math.round(m.start_s * fps)),
    durationInFrames: Math.max(1, Math.round((m.end_s - m.start_s) * fps)),
    volume: dbToGain(m.gain_db),
  }));
  return [...voice, ...music];
}

export function AudioTracks({ timing, fps }: { timing: TimingInput | undefined; fps: number }): ReactElement {
  return (
    <>
      {audioCues(timing, fps).map((c) => (
        <Sequence key={c.key} name={c.key} from={c.from} durationInFrames={c.durationInFrames} layout="none">
          <Html5Audio src={c.src} volume={c.volume} />
        </Sequence>
      ))}
    </>
  );
}

/**
 * Centre: the programme monitor (Remotion Player of EraAdjustedSlope with the project's props),
 * a 9:16 / 16:9 preview toggle, the scrubber with timecode, and the safe-zone overlay toggle
 * (props.show_safe_zone). Frame state lives in the player; readers subscribe (usePlayerFrame).
 */
import type { PlayerRef } from "@remotion/player";
import type { EraAdjustedProps, Format } from "@statreel/schemas";
import { type RefObject, useEffect, useState } from "react";
import { type PlayerMeta, Programme, Slate } from "../components/Programme";
import { timecode } from "../logic";

export function usePlayerFrame(ref: RefObject<PlayerRef | null>, meta: PlayerMeta | null): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const p = ref.current;
    if (!p || !meta) return;
    const h = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener("frameupdate", h);
    p.addEventListener("seeked", h);
    setFrame(p.getCurrentFrame());
    return () => {
      p.removeEventListener("frameupdate", h);
      p.removeEventListener("seeked", h);
    };
  }, [ref, meta]);
  return frame;
}

function usePlaying(ref: RefObject<PlayerRef | null>, meta: PlayerMeta | null): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const p = ref.current;
    if (!p || !meta) return;
    const play = () => setOn(true);
    const pause = () => setOn(false);
    p.addEventListener("play", play);
    p.addEventListener("pause", pause);
    p.addEventListener("ended", pause);
    return () => {
      p.removeEventListener("play", play);
      p.removeEventListener("pause", pause);
      p.removeEventListener("ended", pause);
    };
  }, [ref, meta]);
  return on;
}

export function Monitor({
  props,
  compositionName,
  playerRef,
  meta,
  onMeta,
}: {
  props: EraAdjustedProps | null;
  compositionName: string | null | undefined;
  playerRef: RefObject<PlayerRef | null>;
  meta: PlayerMeta | null;
  onMeta: (m: PlayerMeta | null) => void;
}) {
  const [format, setFormat] = useState<Format>(props?.format ?? "vertical");
  const [safe, setSafe] = useState<boolean>(props?.show_safe_zone ?? false);
  const [muted, setMuted] = useState(true);
  const frame = usePlayerFrame(playerRef, meta);
  const playing = usePlaying(playerRef, meta);
  // follow the stored format when props change
  useEffect(() => {
    if (props?.format) setFormat(props.format);
  }, [props?.format]);
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !meta) return;
    if (muted) p.mute();
    else p.unmute();
  }, [muted, meta, playerRef]);

  const total = meta?.durationInFrames ?? 0;
  const fps = meta?.fps ?? 30;
  const has = !!meta;
  const toggle = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying()) p.pause();
    else {
      if (p.getCurrentFrame() >= total - 1) p.seekTo(0);
      p.play();
    }
  };
  const seek = (f: number) => playerRef.current?.seekTo(Math.max(0, Math.min(total - 1, Math.round(f))));

  return (
    <section className="pgm" aria-label="Programme monitor">
      <div className="frame-box">
        <div className={`player${format === "landscape" ? " wide" : ""}`} data-testid="player">
          <span className="player__bug">
            {props ? (props.timing ? "PGM" : "DRAFT") : "SLATE"} · {format === "landscape" ? "16:9" : "9:16"}
          </span>
          <div className="player__screen">
            <Programme
              props={props}
              format={format}
              safeZone={safe}
              playerRef={playerRef}
              onMeta={onMeta}
              muted
              compositionName={compositionName}
              slate={
                <Slate
                  title="No props yet"
                  lines={<p>Draft with Claude (right) to store props; the composition plays them here.</p>}
                />
              }
            />
          </div>
        </div>
      </div>
      <div
        className="transport"
        onKeyDown={(e) => {
          if (e.key === " " && (e.target as HTMLElement).tagName !== "BUTTON") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <button type="button" className="tbtn tbtn--play" onClick={toggle} disabled={!has}>
          {playing ? "Pause" : "Play"}
        </button>
        <span className="tc num">
          {timecode(frame, fps)} <small>/ {timecode(Math.max(0, total - 1), fps)}</small>
        </span>
        <label className="scrub">
          <span className="sr-only">Scrub</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            step={1}
            value={Math.min(frame, Math.max(0, total - 1))}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!has}
          />
        </label>
        <div className="seg seg--sm" role="group" aria-label="Preview format">
          <button type="button" aria-pressed={format === "vertical"} onClick={() => setFormat("vertical")}>
            9:16
          </button>
          <button type="button" aria-pressed={format === "landscape"} onClick={() => setFormat("landscape")}>
            16:9
          </button>
        </div>
        <button type="button" className="tbtn" aria-pressed={safe} onClick={() => setSafe((s) => !s)} disabled={!has}>
          Safe zone
        </button>
        <button
          type="button"
          className="tbtn"
          aria-pressed={!muted}
          onClick={() => setMuted((m) => !m)}
          disabled={!has || !props?.timing}
        >
          {muted ? "Sound off" : "Sound on"}
        </button>
        <span className="attr">
          {props
            ? `${props.attribution}${props.format !== format ? ` · previewing ${format}; the render uses props.format (${props.format})` : ""}${props.timing ? "" : " · draft timing: scenes split evenly until Produce measures the voice"}`
            : "The monitor plays the project's props through the real composition."}
        </span>
      </div>
    </section>
  );
}

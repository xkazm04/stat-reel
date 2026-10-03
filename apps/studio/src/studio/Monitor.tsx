/**
 * Centre: the programme monitor (Remotion Player of EraAdjustedSlope with the project's props),
 * a 9:16 / 16:9 preview toggle, the scrubber with timecode, and the safe-zone overlay toggle
 * (props.show_safe_zone). The frame lives in the player; leaves read it from the clock (playerClock.ts), never from state here.
 */
import type { PlayerRef } from "@remotion/player";
import type { EraAdjustedProps, Format } from "@statreel/schemas";
import { memo, type RefObject, useCallback, useEffect, useMemo, useState } from "react";
import { Programme } from "../components/LazyProgramme";
import type { PlayerMeta } from "../components/Programme";
import { Slate } from "../components/Slate";
import { timecode } from "../logic";
import type { CompositionState } from "../studio-logic";
import { type FrameClock, useClockSelect } from "./playerClock";

/** play/pause state (changes on a click, not per frame) plus a refused play, reported not swallowed. */
function usePlayback(ref: RefObject<PlayerRef | null>, meta: PlayerMeta | null) {
  const [on, setOn] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    const p = ref.current;
    if (!p || !meta) return;
    const play = () => {
      setOn(true);
      setRefused(null);
    };
    const pause = () => setOn(false);
    const error = (e: { detail: { error: Error } }) => setRefused(e.detail.error.message);
    p.addEventListener("play", play);
    p.addEventListener("pause", pause);
    p.addEventListener("ended", pause);
    p.addEventListener("error", error);
    return () => {
      p.removeEventListener("play", play);
      p.removeEventListener("pause", pause);
      p.removeEventListener("ended", pause);
      p.removeEventListener("error", error);
    };
  }, [ref, meta]);
  return { playing: on, refused, setRefused };
}

/** Timecode readout: the only monitor text that follows the frame, so only it re-renders per frame. */
const Timecode = memo(function Timecode({ clock, fps, total }: { clock: FrameClock; fps: number; total: number }) {
  const frame = useClockSelect(clock, (f) => f);
  return (
    <span className="tc num">
      {timecode(frame, fps)} <small>/ {timecode(Math.max(0, total - 1), fps)}</small>
    </span>
  );
});

/** Scrub input; its value follows the clock, and aria-valuetext reads the position as a timecode. */
const Scrubber = memo(function Scrubber({
  clock,
  fps,
  total,
  disabled,
  onSeek,
}: {
  clock: FrameClock;
  fps: number;
  total: number;
  disabled: boolean;
  onSeek: (frame: number) => void;
}) {
  const frame = useClockSelect(clock, (f) => f);
  const max = Math.max(0, total - 1);
  const at = Math.min(frame, max);
  return (
    <label className="scrub">
      <span className="sr-only">Scrub</span>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={at}
        aria-valuetext={`${timecode(at, fps)} of ${timecode(max, fps)}`}
        onChange={(e) => onSeek(Number(e.target.value))}
        disabled={disabled}
      />
    </label>
  );
});

export function Monitor({
  props,
  compositionName,
  playerRef,
  meta,
  onMeta,
  state,
  clock,
}: {
  props: EraAdjustedProps | null;
  compositionName: string | null | undefined;
  playerRef: RefObject<PlayerRef | null>;
  meta: PlayerMeta | null;
  onMeta: (m: PlayerMeta | null) => void;
  /** what the player can say; "not-built" is stated plainly instead of a dead transport */
  state: CompositionState;
  /** the frame clock (usePlayerClock in the parent): the frame never enters this component's state */
  clock: FrameClock;
}) {
  const [format, setFormat] = useState<Format>(props?.format ?? "vertical");
  const [safe, setSafe] = useState<boolean>(props?.show_safe_zone ?? false);
  const [muted, setMuted] = useState(true);
  const { playing, refused, setRefused } = usePlayback(playerRef, meta);
  // one element for the life of the monitor, so the memoised Programme is not handed a new slate per render
  const slate = useMemo(
    () => (
      <Slate
        title="No props yet"
        lines={<p>Draft with Claude (right) to store props; the composition plays them here.</p>}
      />
    ),
    [],
  );
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
      // a browser can refuse play() (autoplay policy, suspended audio): the promise rejects or the
      // player emits "error"; either way the owner sees it instead of a button that does nothing
      const refuse = (err: unknown) => setRefused(err instanceof Error ? err.message : String(err));
      try {
        const r = p.play() as unknown;
        if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(refuse);
      } catch (err) {
        refuse(err);
      }
    }
  };
  const seek = useCallback(
    (f: number) => playerRef.current?.seekTo(Math.max(0, Math.min(total - 1, Math.round(f)))),
    [playerRef, total],
  );

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
              slate={slate}
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
        <Timecode clock={clock} fps={fps} total={total} />
        <Scrubber clock={clock} fps={fps} total={total} disabled={!has} onSeek={seek} />
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
        {refused ? (
          <span className="joberr" role="alert">
            Playback was refused: {refused}. Press Play to try again.
          </span>
        ) : null}
        <span className="attr">
          {props && state === "not-built"
            ? "No player for this use case yet: the composition is not built, so there is nothing to play or scrub."
            : props
            ? `${props.attribution}${props.format !== format ? ` · previewing ${format}; the render uses props.format (${props.format})` : ""}${props.timing ? "" : " · draft timing: scenes split evenly until Produce measures the voice"}`
            : "The monitor plays the project's props through the real composition."}
        </span>
      </div>
    </section>
  );
}

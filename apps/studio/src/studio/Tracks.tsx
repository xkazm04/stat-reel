/**
 * Bottom: the tracks, all from props.timing (the audio stage's measured timeline): scenes, voice
 * per scene (word extents), music cues with their gain, caption cues. A shared time axis with the
 * player's playhead; click or drag a lane to seek. Without timing: an honest empty state.
 */
import type { PlayerRef } from "@remotion/player";
import type { EraAdjustedProps } from "@statreel/schemas";
import { type PointerEvent, type RefObject, useMemo } from "react";
import type { PlayerMeta } from "../components/Programme";
import { usePlayerFrame } from "./Monitor";

export function Tracks({
  props,
  playerRef,
  meta,
}: {
  props: EraAdjustedProps | null;
  playerRef: RefObject<PlayerRef | null>;
  meta: PlayerMeta | null;
}) {
  const frame = usePlayerFrame(playerRef, meta);
  const timing = props?.timing;
  const voice = useMemo(() => {
    if (!timing) return [];
    const by = new Map<string, { start: number; end: number; words: number }>();
    for (const w of timing.words) {
      const v = by.get(w.scene_id);
      if (!v) by.set(w.scene_id, { start: w.start_s, end: w.end_s, words: 1 });
      else {
        v.start = Math.min(v.start, w.start_s);
        v.end = Math.max(v.end, w.end_s);
        v.words++;
      }
    }
    return [...by.entries()].map(([id, v]) => ({ id, ...v }));
  }, [timing]);

  if (!props || !timing)
    return (
      <section className="tl" aria-label="Tracks">
        <p className="tl-none">
          <span className="sec-h">
            <span>Tracks · scenes · voice · music · captions</span>
          </span>
          {props
            ? "No timing yet. Produce generates the voice per scene, measures it, spots the music on that timeline and times the captions; the tracks appear here."
            : "No props yet, so there is nothing to time."}
        </p>
      </section>
    );

  const dur = timing.duration_s;
  const pc = (s: number) => `${((Math.max(0, Math.min(dur, s)) / dur) * 100).toFixed(3)}%`;
  const t = meta ? frame / meta.fps : 0;
  const step = dur > 90 ? 10 : 5;
  const ticks: number[] = [];
  for (let s = 0; s <= dur; s += step) ticks.push(s);
  const seekFrom = (e: PointerEvent<HTMLDivElement>) => {
    if (!meta) return;
    const lane = e.currentTarget;
    const move = (x: number) => {
      const r = lane.getBoundingClientRect();
      const s = ((x - r.left) / r.width) * dur;
      playerRef.current?.seekTo(Math.max(0, Math.min(meta.durationInFrames - 1, Math.round(s * meta.fps))));
    };
    move(e.clientX);
    const mv = (ev: globalThis.PointerEvent) => move(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };
  const cur = timing.scenes.find((s) => t >= s.start_s && t < s.end_s)?.scene_id;
  const maxCps = timing.cues.reduce((m, c) => {
    const chars = c.lines.join(" ").length;
    const d = c.end_s - c.start_s;
    return d > 0 ? Math.max(m, chars / d) : m;
  }, 0);

  return (
    <section className="tl" aria-label="Tracks">
      <div className="tl-grid">
        <span
          className="tl-head"
          style={{ left: `calc(120px + (100% - 120px) * ${(t / dur).toFixed(5)})` }}
          aria-hidden="true"
        />
        <span className="tl-l">Time</span>
        <div className="tl-ruler" onPointerDown={seekFrom}>
          {ticks.map((s) => (
            <span key={s} style={{ left: pc(s) }}>
              {s === 0 ? "0 s" : s}
            </span>
          ))}
        </div>
        <span className="tl-l">
          Scenes<small>{timing.scenes.length} in voice time</small>
        </span>
        <div className="tl-t" onPointerDown={seekFrom}>
          {timing.scenes.map((s) => (
            <span
              key={s.scene_id}
              className={`tl-b tl-b--scene${cur === s.scene_id ? " now" : ""}`}
              style={{ left: pc(s.start_s), width: pc(s.end_s - s.start_s) }}
            >
              {s.scene_id}
            </span>
          ))}
        </div>
        <span className="tl-l">
          Voice<small>{voice.length} segments</small>
        </span>
        <div className="tl-t" onPointerDown={seekFrom}>
          {voice.map((v) => (
            <span
              key={v.id}
              className="tl-b tl-b--voice"
              style={{ left: pc(v.start), width: pc(v.end - v.start) }}
              title={`${v.id}: ${v.words} words`}
            />
          ))}
        </div>
        <span className="tl-l">
          Music<small>{timing.music.length} cues</small>
        </span>
        <div className="tl-t" onPointerDown={seekFrom}>
          {timing.music.length ? (
            timing.music.map((m, i) => (
              <span
                key={`${m.src}-${m.start_s}`}
                className="tl-b tl-b--music"
                style={{ left: pc(m.start_s), width: pc(m.end_s - m.start_s) }}
              >
                cue {i + 1} · {m.gain_db} dB
              </span>
            ))
          ) : (
            <span className="tl-empty">no music cues</span>
          )}
        </div>
        <span className="tl-l">
          Captions
          <small>
            {timing.cues.length} · {maxCps.toFixed(1)} cps peak
          </small>
        </span>
        <div className="tl-t" onPointerDown={seekFrom}>
          {timing.cues.map((c) => (
            <span
              key={`${c.start_s}`}
              className="tl-b tl-b--cap"
              style={{ left: pc(c.start_s), width: pc(c.end_s - c.start_s) }}
              title={c.lines.join(" / ")}
            />
          ))}
        </div>
      </div>
      <p className="tl-foot">
        {dur.toFixed(2)} s measured · picture cuts {timing.voice_lead_s ?? 0.5} s after each voice start · captions
        burned in · click a lane to seek
      </p>
    </section>
  );
}

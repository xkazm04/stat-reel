/**
 * Bottom, full width: the tracks on one ruler with the player's playhead. Scenes always show once
 * props exist (measured from props.timing, or the draft even split the composition itself plays);
 * voice per scene (word extents), music cues with their gain and caption cues appear once Produce
 * has measured the voice. Scene blocks are buttons: they open the script at that scene and seek.
 * Pointer down on a lane or the ruler seeks (drag to scrub).
 */
import type { PlayerRef } from "@remotion/player";
import type { EraAdjustedProps } from "@statreel/schemas";
import { type PointerEvent, type RefObject, useEffect, useMemo, useRef } from "react";
import type { PlayerMeta } from "../components/Programme";
import { type CompositionState, rulerTicks, type SceneSpan, spanAt } from "../studio-logic";
import { type FrameClock, useClockSelect } from "./playerClock";

export function Tracks({
  props,
  spans,
  duration,
  playerRef,
  meta,
  state,
  clock,
  onScene,
}: {
  props: EraAdjustedProps | null;
  spans: SceneSpan[];
  /** seconds on the ruler (measured, or the composition's draft length) */
  duration: number;
  playerRef: RefObject<PlayerRef | null>;
  meta: PlayerMeta | null;
  /** what the player can say; "not-built" must not read as a load in progress */
  state: CompositionState;
  /** the frame clock: the needle is written to the DOM, only a cut or a caption change re-renders */
  clock: FrameClock;
  onScene: (sceneId: string) => void;
}) {
  const timing = props?.timing;
  const fps = meta?.fps ?? 0;
  const ready = !!props && duration > 0 && spans.length > 0;
  // scene and caption under the playhead: selected from the clock, so a render per cut, not per frame
  const cur = useClockSelect(clock, (f) => (fps ? (spanAt(spans, f / fps)?.id ?? null) : null));
  const capNow = useClockSelect(clock, (f) => {
    if (!fps || !timing) return -1;
    const t = f / fps;
    return timing.cues.find((c) => t >= c.start_s && t < c.end_s)?.start_s ?? -1;
  });
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = grid.current;
    if (!ready || !el || !fps || !(duration > 0)) return;
    const write = () => el.style.setProperty("--tl-t", (clock.get() / fps / duration).toFixed(5));
    write();
    return clock.subscribe(write);
  }, [clock, fps, duration, ready]);
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

  if (!props || !ready)
    return (
      <section className="tl" aria-label="Tracks">
        <p className="tl-none">
          <span className="sec-h">
            <span>Tracks · scenes · voice · music · captions</span>
          </span>
          {props
            ? state === "not-built"
              ? "No player for this use case yet, so the scenes cannot be laid on the ruler."
              : state === "unavailable"
                ? "The composition could not be loaded, so the scenes cannot be laid on the ruler."
                : "Loading the composition to lay the scenes on the ruler."
            : "No props yet, so there is nothing to time. Draft with Claude (right) to store scenes."}
        </p>
      </section>
    );

  const dur = duration;
  const pc = (s: number) => `${((Math.max(0, Math.min(dur, s)) / dur) * 100).toFixed(3)}%`;
  const ticks = rulerTicks(dur);
  const seekFrom = (e: PointerEvent<HTMLDivElement>) => {
    if (!meta || (e.target as HTMLElement).closest("button")) return;
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
  const maxCps = (timing?.cues ?? []).reduce((m, c) => {
    const chars = c.lines.join(" ").length;
    const d = c.end_s - c.start_s;
    return d > 0 ? Math.max(m, chars / d) : m;
  }, 0);
  const measured = !!timing;

  return (
    <section className="tl" aria-label="Tracks">
      <div className="tl-grid" ref={grid}>
        <span className="tl-head" aria-hidden="true" />
        <span className="tl-l">Time</span>
        <div className="tl-ruler" onPointerDown={seekFrom}>
          {ticks.map((s) => (
            <span key={s} style={{ left: pc(s) }}>
              {s === 0 ? "0 s" : s}
            </span>
          ))}
        </div>
        <span className="tl-l">
          Scenes
          <small>{measured ? `${spans.length} measured` : `${spans.length} · draft`}</small>
        </span>
        <div className="tl-t tl-t--scenes" onPointerDown={seekFrom}>
          {spans.map((s, i) => (
            <button
              type="button"
              key={s.id}
              className={`tl-b tl-b--scene${cur === s.id ? " now" : ""}${s.measured ? "" : " is-draft"}`}
              style={{ left: pc(s.start), width: pc(s.end - s.start) }}
              onClick={() => onScene(s.id)}
              aria-label={`Scene ${i + 1}, ${s.id}: open the script here and seek`}
            >
              <span className="tl-b__n">{String(i + 1).padStart(2, "0")}</span>
              <span className="tl-b__t">{s.id}</span>
            </button>
          ))}
        </div>
        {timing ? (
          <>
            <span className="tl-l">
              Voice<small>{voice.length} segments</small>
            </span>
            <div className="tl-t" onPointerDown={seekFrom}>
              {voice.map((v) => (
                <span key={v.id} className="tl-b tl-b--voice" style={{ left: pc(v.start), width: pc(v.end - v.start) }}>
                  <span className="tl-b__t">
                    {v.id} · {v.words} words
                  </span>
                </span>
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
                    <span className="tl-b__t">
                      cue {i + 1} · {m.gain_db} dB
                    </span>
                  </span>
                ))
              ) : (
                <span className="tl-empty">no music cues</span>
              )}
            </div>
            <span className="tl-l">
              Captions<small>{timing.cues.length} cues</small>
            </span>
            <div className="tl-t" onPointerDown={seekFrom}>
              {timing.cues.map((c) => (
                <span
                  key={`${c.start_s}`}
                  className={`tl-b tl-b--cap${capNow === c.start_s ? " now" : ""}`}
                  style={{ left: pc(c.start_s), width: pc(c.end_s - c.start_s) }}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="tl-l tl-l--span">
            Voice · music · captions
            <span>
              not generated yet: Produce generates the voice per scene, measures it, spots the music on that timeline and
              times the captions on the measured words.
            </span>
          </p>
        )}
      </div>
      <p className="tl-foot">
        {measured
          ? `${dur.toFixed(2)} s measured · picture cuts ${timing?.voice_lead_s ?? 0.5} s after each voice start · captions burned in, peak ${maxCps.toFixed(1)} cps`
          : `${dur.toFixed(0)} s draft · even split until Produce measures the voice`}{" "}
        · click a scene to open its script · click or drag a lane to seek
      </p>
    </section>
  );
}

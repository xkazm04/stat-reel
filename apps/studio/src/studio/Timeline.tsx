/** Bottom rack: timeline tracks from props.timing (scenes, voice per scene, music cues, captions). */
import type { EraAdjustedProps } from "@statreel/schemas";
import type { MouseEvent, ReactNode } from "react";
import { Module } from "../components/ui";

export function TimelinePanel({
  props,
  frame,
  fps,
  onSeek,
}: {
  props: EraAdjustedProps | null;
  frame: number;
  fps: number;
  onSeek: (seconds: number) => void;
}) {
  const t = props?.timing;
  if (!t) {
    return (
      <Module
        id="m-timeline"
        title="Timeline"
        tag="scenes · voice · music · captions"
        className="mod timeline-mod"
        screws={["tl", "tr", "bl", "br"]}
      >
        <div className="display empty" data-testid="timeline-empty">
          <b>Audio hasn't been generated yet.</b> Scene, voice, music and caption tracks come from the audio stage (TTS
          with timestamps → timing), which runs first when you press <b>Produce</b>.
          {props ? ` ${props.scenes.length} scenes are drafted: ${props.scenes.map((s) => s.kind).join(" → ")}.` : ""}
        </div>
      </Module>
    );
  }
  const dur = t.duration_s || 1;
  const pc = (s: number) => `${(Math.max(0, Math.min(dur, s)) / dur) * 100}%`;
  const w = (a: number, b: number) => `calc(${(Math.max(0, b - a) / dur) * 100}% - 2px)`;
  const nowS = frame / fps;
  const kindOf = new Map(props.scenes.map((s) => [s.id, s.kind]));
  const ruler: number[] = [];
  const step = dur > 90 ? 15 : dur > 40 ? 10 : 5;
  for (let s = 0; s <= dur; s += step) ruler.push(s);
  const voiced = t.scenes.filter((s) => s.voice_src).length;
  const seekFrom = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - r.left) / r.width) * dur);
  };
  const lane = (label: string, on: boolean, children: ReactNode) => (
    <>
      <span className={`lane-lab${on ? " on" : ""}`}>
        <i aria-hidden="true" />
        {label}
      </span>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the scrubber is the keyboard path; lanes are a pointer shortcut */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: see above */}
      <div className="lane" onClick={seekFrom}>
        {children}
        <span className="playhead" style={{ left: pc(nowS) }} aria-hidden="true" />
      </div>
    </>
  );
  return (
    <Module
      id="m-timeline"
      title="Timeline"
      tag={`${dur.toFixed(1)} s · voice leads picture by ${t.voice_lead_s ?? 0.5} s`}
      className="mod timeline-mod"
      screws={["tl", "tr", "bl", "br"]}
    >
      <div className="lanes" data-testid="timeline">
        <span />
        <div className="ruler" aria-hidden="true">
          {ruler.map((s) => (
            <span key={s} style={{ left: pc(s) }}>
              {s}s
            </span>
          ))}
        </div>
        {lane(
          "Scenes",
          true,
          t.scenes.map((s) => (
            <span
              key={s.scene_id}
              className={`blk sc${nowS >= s.start_s && nowS < s.end_s ? " cur" : ""}`}
              style={{ left: pc(s.start_s), width: w(s.start_s, s.end_s) }}
            >
              {kindOf.get(s.scene_id) ?? s.scene_id}
            </span>
          )),
        )}
        {lane(
          "Voice",
          voiced > 0,
          t.scenes
            .filter((s) => s.voice_src)
            .map((s, i) => {
              const vd = (s as { voice_duration_s?: number }).voice_duration_s;
              const end = vd ? s.start_s + vd : s.end_s;
              return (
                <span key={s.scene_id} className="blk vo" style={{ left: pc(s.start_s), width: w(s.start_s, end) }}>
                  VO{i + 1}
                </span>
              );
            }),
        )}
        {lane(
          "Music",
          t.music.length > 0,
          t.music.map((m, i) => (
            <span
              key={`${m.src}-${m.start_s}`}
              className="blk mu"
              style={{ left: pc(m.start_s), width: w(m.start_s, m.end_s) }}
            >
              cue {i + 1} · {m.gain_db} dB
            </span>
          )),
        )}
        {lane(
          "Captions",
          t.cues.length > 0,
          t.cues.map((c) => (
            <span
              key={`${c.start_s}-${c.end_s}`}
              className={`blk cc${nowS >= c.start_s && nowS < c.end_s ? " cur" : ""}`}
              style={{ left: pc(c.start_s), width: `${((c.end_s - c.start_s) / dur) * 100}%` }}
            />
          )),
        )}
      </div>
      <p className="mono muted lane-note">
        voice: {voiced} of {t.scenes.length} scenes · music: {t.music.length} cue{t.music.length === 1 ? "" : "s"} ·
        captions: {t.cues.length} cues, {t.words.length} timed words · click a lane to seek
      </p>
      <CurrentCue props={props} nowS={nowS} />
    </Module>
  );
}

function CurrentCue({ props, nowS }: { props: EraAdjustedProps; nowS: number }) {
  const cue = props.timing?.cues.find((c) => nowS >= c.start_s && nowS < c.end_s);
  return (
    <div className="cue-now" aria-live="off">
      <span className="legend">Caption now</span>
      <span className="cue-text">{cue ? cue.lines.join(" / ") : "—"}</span>
    </div>
  );
}

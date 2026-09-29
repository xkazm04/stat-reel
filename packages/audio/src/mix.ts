/**
 * Pure mix plan for Remotion `<Audio>` tracks (DESIGN §6.4): voice is the 0 dB anchor, music sits
 * at its duck gain (−6 … −12 dB) while voice is active and opens up in gaps, and the voice leads
 * the picture by `voiceLeadS` (0.5–2 s) at scene changes.
 */
import type { MusicCue } from "./music";

export interface MixScene {
  scene_id: string;
  start_s: number;
  end_s: number;
  voice_src?: string;
  /** measured TTS length (alignment end); defaults to the scene length */
  voice_duration_s?: number;
}

export interface VoiceTrack {
  id: string;
  kind: "voice";
  scene_id: string;
  src?: string;
  start_s: number;
  end_s: number;
  /** how far this voice starts before its scene's picture (may be less than asked, never overlaps) */
  leadS: number;
  volumeDb: 0;
}

export interface EnvelopePoint {
  t_s: number;
  db: number;
}

export interface MusicEnvelope {
  start_s: number;
  end_s: number;
  fadeInS: number;
  fadeOutS: number;
  /** piecewise-linear level in dB on the absolute timeline (before fades) */
  points: EnvelopePoint[];
}

export interface MusicTrack {
  id: string;
  kind: "music";
  cue_id: string;
  src?: string;
  start_s: number;
  end_s: number;
  gainDb: number;
  envelope: MusicEnvelope;
}

export interface MixPlanInput {
  scenes: MixScene[];
  cues: MusicCue[];
  voiceLeadS?: number;
  /** music level when no voice is active (default −3 dB) */
  musicOpenDb?: number;
  /** duck attack/release time (default 0.15 s) */
  rampS?: number;
}

export interface MixPlan {
  voiceLeadS: number;
  voice: VoiceTrack[];
  music: MusicTrack[];
  /** ready for `Timeline.music` in @statreel/schemas (cues with a src only) */
  timelineMusic: { src: string; start_s: number; end_s: number; gain_db: number }[];
}

export const VOICE_LEAD_MIN_S = 0.5;
export const VOICE_LEAD_MAX_S = 2;

export function mixPlan(input: MixPlanInput): MixPlan {
  const lead = input.voiceLeadS ?? VOICE_LEAD_MIN_S;
  if (!(lead >= VOICE_LEAD_MIN_S && lead <= VOICE_LEAD_MAX_S))
    throw new RangeError(`voiceLeadS must be within ${VOICE_LEAD_MIN_S}-${VOICE_LEAD_MAX_S} s, got ${lead}`);
  const open = input.musicOpenDb ?? -3;
  const ramp = Math.max(0, input.rampS ?? 0.15);

  const voice: VoiceTrack[] = [];
  for (const [i, s] of input.scenes.entries()) {
    const prevEnd = voice.at(-1)?.end_s ?? Number.NEGATIVE_INFINITY;
    const desired = i === 0 ? s.start_s : Math.max(0, s.start_s - lead);
    const start = Math.max(desired, prevEnd);
    const dur = s.voice_duration_s ?? s.end_s - s.start_s;
    const t: VoiceTrack = {
      id: `voice-${s.scene_id}`,
      kind: "voice",
      scene_id: s.scene_id,
      start_s: round(start),
      end_s: round(start + dur),
      leadS: round(s.start_s - start),
      volumeDb: 0,
    };
    if (s.voice_src !== undefined) t.src = s.voice_src;
    voice.push(t);
  }

  const music: MusicTrack[] = input.cues.map((c) => {
    const duck = c.gainDb;
    const active = voice.filter((v) => v.end_s + ramp > c.start_s && v.start_s - ramp < c.end_s);
    const ducked = (t: number) => {
      let d = 0;
      for (const v of active) {
        let x = 0;
        if (t >= v.start_s && t <= v.end_s) x = 1;
        else if (ramp > 0 && t < v.start_s && t > v.start_s - ramp) x = 1 - (v.start_s - t) / ramp;
        else if (ramp > 0 && t > v.end_s && t < v.end_s + ramp) x = 1 - (t - v.end_s) / ramp;
        d = Math.max(d, x);
      }
      return d;
    };
    const breaks = new Set<number>([c.start_s, c.end_s]);
    for (const v of active)
      for (const b of [v.start_s - ramp, v.start_s, v.end_s, v.end_s + ramp]) breaks.add(round(b));
    const points = [...breaks]
      .filter((t) => t >= c.start_s && t <= c.end_s)
      .sort((a, b) => a - b)
      .map((t) => ({ t_s: t, db: round(open + (duck - open) * ducked(t)) }));
    const track: MusicTrack = {
      id: `music-${c.cue_id}`,
      kind: "music",
      cue_id: c.cue_id,
      start_s: c.start_s,
      end_s: c.end_s,
      gainDb: duck,
      envelope: { start_s: c.start_s, end_s: c.end_s, fadeInS: c.fadeInS, fadeOutS: c.fadeOutS, points },
    };
    if (c.src !== undefined) track.src = c.src;
    return track;
  });

  const timelineMusic = input.cues.flatMap((c) =>
    c.src !== undefined ? [{ src: c.src, start_s: c.start_s, end_s: c.end_s, gain_db: c.gainDb }] : [],
  );
  return { voiceLeadS: lead, voice, music, timelineMusic };
}

/** Music level in dB at absolute time `t` (−Infinity outside the cue or at a fade edge). */
export function volumeDbAt(env: MusicEnvelope, t: number): number {
  if (t < env.start_s || t > env.end_s || env.points.length === 0) return Number.NEGATIVE_INFINITY;
  const fin = env.fadeInS > 0 ? (t - env.start_s) / env.fadeInS : 1;
  const fout = env.fadeOutS > 0 ? (env.end_s - t) / env.fadeOutS : 1;
  const f = Math.min(1, fin, fout);
  if (f <= 0) return Number.NEGATIVE_INFINITY;
  return interp(env.points, t) + 20 * Math.log10(f);
}

function interp(points: EnvelopePoint[], t: number): number {
  const first = points[0] as EnvelopePoint;
  if (t <= first.t_s) return first.db;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as EnvelopePoint;
    const b = points[i] as EnvelopePoint;
    if (t <= b.t_s) return b.t_s === a.t_s ? b.db : a.db + ((b.db - a.db) * (t - a.t_s)) / (b.t_s - a.t_s);
  }
  return (points.at(-1) as EnvelopePoint).db;
}

export const dbToLinear = (db: number) => (db === Number.NEGATIVE_INFINITY ? 0 : 10 ** (db / 20));

/** Remotion `<Audio volume>` callback for a track placed in a `<Sequence from={start_s * fps}>`. */
export const remotionVolume = (env: MusicEnvelope, fps: number) => (frame: number) =>
  dbToLinear(volumeDbAt(env, env.start_s + frame / fps));

const round = (n: number) => Math.round(n * 1e6) / 1e6;

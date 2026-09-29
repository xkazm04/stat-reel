/**
 * Music spotting (ADR 003 #9): music is generated after TTS is measured, cue by cue at the exact
 * length needed, with deliberate silences; off-length takes are rejected, never stretched.
 */
import { MUSIC_MAX_MS, MUSIC_MIN_MS } from "./client";
import { TakeRejected } from "./errors";
import { probeDurationS } from "./loudness";

export type SceneKindName = "hook" | "context" | "reveal" | "payoff" | "close" | "endcard";

export interface SceneSpan {
  scene_id: string;
  kind: SceneKindName;
  start_s: number;
  end_s: number;
}

export interface MusicCue {
  cue_id: string;
  start_s: number;
  end_s: number;
  /** exact length to request (`music_length_ms`) and to accept the take against */
  lengthMs: number;
  /** music level under voice, dB relative to the voice anchor (−6 … −12) */
  gainDb: number;
  scenes: string[];
  fadeInS: number;
  fadeOutS: number;
  /** set once a take is accepted */
  src?: string;
}

export interface Silence {
  start_s: number;
  end_s: number;
  reason: string;
}

export interface MusicCuePlan {
  cues: MusicCue[];
  silences: Silence[];
  totalS: number;
}

export interface MusicCueOptions {
  /** scene kinds that get music (default context, reveal, payoff) */
  musicKinds?: SceneKindName[];
  /** a hook with music still keeps its first beat silent (default 1 s) */
  hookBeatS?: number;
  /** silence right before the payoff (default 0.75 s) */
  preDropS?: number;
  /** duck under voice in dB, clamped to 6-12 (default 9) */
  duckDb?: number;
  fadeInS?: number;
  fadeOutS?: number;
}

export const DUCK_MIN_DB = 6;
export const DUCK_MAX_DB = 12;
export const DEFAULT_DUCK_DB = 9;
export const TAKE_TOLERANCE_MS = 60;

export const clampDuckDb = (db: number) =>
  Number.isFinite(db) ? Math.min(DUCK_MAX_DB, Math.max(DUCK_MIN_DB, Math.abs(db))) : DEFAULT_DUCK_DB;

interface Seg {
  start: number;
  end: number;
  scenes: string[];
}

const EPS = 1e-6;

export function planMusicCues(scenes: SceneSpan[], opts: MusicCueOptions = {}): MusicCuePlan {
  const musicKinds = new Set(opts.musicKinds ?? ["context", "reveal", "payoff"]);
  const hookBeatS = opts.hookBeatS ?? 1;
  const preDropS = opts.preDropS ?? 0.75;
  const gainDb = -clampDuckDb(opts.duckDb ?? DEFAULT_DUCK_DB);
  const fadeIn = opts.fadeInS ?? 0.5;
  const fadeOut = opts.fadeOutS ?? 1;

  for (const [i, s] of scenes.entries()) {
    if (!(s.end_s > s.start_s)) throw new RangeError(`scene ${s.scene_id}: end_s must be after start_s`);
    const prev = scenes[i - 1];
    if (prev && s.start_s < prev.end_s - EPS)
      throw new RangeError(`scene ${s.scene_id} overlaps ${prev.scene_id} (scenes must be ordered)`);
  }

  const silences: Silence[] = [];
  const segs: Seg[] = [];
  for (const s of scenes) {
    if (!musicKinds.has(s.kind)) {
      silences.push({ start_s: s.start_s, end_s: s.end_s, reason: s.kind });
      continue;
    }
    let start = s.start_s;
    if (s.kind === "hook" && hookBeatS > 0) {
      const beatEnd = Math.min(s.end_s, s.start_s + hookBeatS);
      silences.push({ start_s: s.start_s, end_s: beatEnd, reason: "hook first beat" });
      start = beatEnd;
      if (start >= s.end_s - EPS) continue;
    }
    const last = segs.at(-1);
    const touches = last !== undefined && Math.abs(last.end - start) < EPS;
    if (s.kind === "payoff" && preDropS > 0 && touches) {
      const dropStart = Math.max(last.start, start - preDropS);
      silences.push({ start_s: dropStart, end_s: start, reason: "pre-payoff drop" });
      last.end = dropStart;
      segs.push({ start, end: s.end_s, scenes: [s.scene_id] });
    } else if (touches && s.kind !== "payoff") {
      last.end = s.end_s;
      last.scenes.push(s.scene_id);
    } else {
      segs.push({ start, end: s.end_s, scenes: [s.scene_id] });
    }
  }

  const cues: MusicCue[] = [];
  for (const seg of segs) {
    const startMs = Math.round(seg.start * 1000);
    const endMs = Math.round(seg.end * 1000);
    const lengthMs = endMs - startMs;
    if (lengthMs <= 0) continue;
    if (lengthMs < MUSIC_MIN_MS) {
      silences.push({ start_s: seg.start, end_s: seg.end, reason: `cue shorter than ${MUSIC_MIN_MS} ms` });
      continue;
    }
    if (lengthMs > MUSIC_MAX_MS)
      throw new RangeError(`music cue over ${seg.scenes.join(",")} is ${lengthMs} ms (max ${MUSIC_MAX_MS})`);
    const lenS = lengthMs / 1000;
    cues.push({
      cue_id: `m${cues.length + 1}`,
      start_s: startMs / 1000,
      end_s: endMs / 1000,
      lengthMs,
      gainDb,
      scenes: seg.scenes,
      fadeInS: Math.min(fadeIn, lenS / 2),
      fadeOutS: Math.min(fadeOut, lenS / 2),
    });
  }

  return { cues, silences: mergeSilences(silences), totalS: scenes.at(-1)?.end_s ?? 0 };
}

function mergeSilences(list: Silence[]): Silence[] {
  const sorted = list.filter((s) => s.end_s - s.start_s > EPS).sort((a, b) => a.start_s - b.start_s);
  const out: Silence[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && last.reason === s.reason && Math.abs(last.end_s - s.start_s) < EPS) last.end_s = s.end_s;
    else out.push({ ...s });
  }
  return out;
}

export interface AcceptTakeOptions {
  toleranceMs?: number;
  probe?: (file: string) => Promise<number>;
}

/** Accept a generated take only if |duration − expected| ≤ 60 ms. Rejects; never stretches. */
export async function acceptTake(
  file: string,
  expectedMs: number,
  opts: AcceptTakeOptions = {},
): Promise<{ durationMs: number; deltaMs: number }> {
  const tolerance = opts.toleranceMs ?? TAKE_TOLERANCE_MS;
  const durationMs = Math.round((await (opts.probe ?? probeDurationS)(file)) * 1000);
  const deltaMs = durationMs - expectedMs;
  if (Math.abs(deltaMs) > tolerance) throw new TakeRejected(file, expectedMs, durationMs, tolerance);
  return { durationMs, deltaMs };
}

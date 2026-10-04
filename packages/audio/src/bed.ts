/**
 * Music bed from the TimingPlan (ADR 007 format, DESIGN §6.4): the video is data-led and has no
 * narration, so there is no scene spine for `planMusicCues` to key on. The structure lives in the
 * timing plan (hook, timeline with event cards, fixed ending), and this pure planner maps it to
 * music cues, a level envelope and a generation strategy that fits the per-run music budget.
 * No provider calls: the result says what to generate; generate.ts spends, this only plans.
 *
 * Spotting follows "silence is a spotting decision" and "sound leads picture, picture confirms":
 * the bed enters with the hook, event cards get a small lift that starts just before the card,
 * and the bed is allowed to end in a short rest after the Powered-by card instead of being cut.
 *
 * `mixPlan` only ducks under voice; with no scenes it holds the open level, so the event lifts
 * live in `BedPlan.envelope` (evaluate with `bedLevelDbAt`) rather than in `mixPlan`'s envelope.
 */
import { MUSIC_MIN_MS } from "./client";
import type { MusicCue, Silence } from "./music";

/** The slice of `TimingPlan` the planner reads (structural, so a full plan is accepted). */
export interface BedTimingPlan {
  sections: { hook_end: number; timeline_end: number; spotlight_end: number; like_end: number; total: number };
  events: { id: string; label?: string; frame: number }[];
}

/** A placed segment of a bed take. Several cues may share one `takeId` (loop strategy). */
export interface BedCue extends MusicCue {
  takeId: string;
}

export interface EnvelopeLift {
  t_s: number;
  /** level relative to the cue's `gainDb`, in dB (0 = base level) */
  db: number;
  reason: string;
}

export interface BedTake {
  takeId: string;
  /** exact `music_length_ms` to request and accept the take against */
  lengthMs: number;
}

export interface BedGeneration {
  strategy: "single" | "loop";
  takes: BedTake[];
  /** seconds one generation pass reserves from the music budget */
  generationS: number;
  /** generation plus one retry of the same take(s) */
  withRetryS: number;
  budgetS: number;
  fitsBudget: boolean;
  /** true when a failed take can be regenerated once inside the budget */
  retryFits: boolean;
}

export interface BedPlan {
  totalS: number;
  cues: BedCue[];
  /** entry aligned to the hook: the bed starts with the first frame */
  entry: { start_s: number; fadeInS: number };
  /** the bed rides under the whole fixed ending and fades out inside it */
  tail: { start_s: number; end_s: number; fadeOutS: number };
  /** piecewise-linear level relative to the cue gain, on the absolute timeline; `bedLevelDbAt` evaluates it */
  envelope: EnvelopeLift[];
  silences: Silence[];
  coverage: { scoredS: number; silentS: number };
  generation: BedGeneration;
}

export interface BedOptions {
  fps: number;
  /** music generation budget per run (budget.ts); the planner never changes it */
  budgetS: number;
  /** plan a loop whenever one take plus one retry would not fit (default false: a take that fits alone is one take) */
  reserveRetry?: boolean;
  /** target length of the looped take (default 30 s; shrunk so take plus retry fits the budget) */
  loopS?: number;
  /** overlap between loop segments (default 2 s) */
  crossfadeS?: number;
  /** bed level, dB relative to the voice anchor; no voice here, so the top of the -6 ... -12 range (default -6) */
  gainDb?: number;
  /** lift at an event card, dB over the base level (default +2) */
  eventLiftDb?: number;
  /** the lift starts this long before the card (default 0.15 s) */
  eventLeadS?: number;
  eventHoldS?: number;
  eventReleaseS?: number;
  /** dB under the base level during the Powered-by card (default -3) */
  poweredDuckDb?: number;
  fadeInS?: number;
  /** closing silence after the fade-out (default 0.5 s) */
  finalRestS?: number;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const r3 = (n: number) => Math.round(n * 1e3) / 1e3;

export function planBedFromTimingPlan(plan: BedTimingPlan, opts: BedOptions): BedPlan {
  const { fps, budgetS } = opts;
  if (!(fps > 0)) throw new RangeError(`fps must be positive, got ${fps}`);
  const minTakeS = MUSIC_MIN_MS / 1000;
  if (!(budgetS >= 2 * minTakeS))
    throw new RangeError(`budgetS must cover one minimum take and a retry (${2 * minTakeS} s), got ${budgetS}`);
  const s = plan.sections;
  if (
    !(
      s.hook_end >= 0 &&
      s.hook_end < s.timeline_end &&
      s.timeline_end < s.spotlight_end &&
      s.spotlight_end < s.like_end &&
      s.like_end < s.total
    )
  )
    throw new RangeError("timing plan sections must be ordered: hook_end < timeline_end < spotlight_end < like_end < total");

  const gainDb = opts.gainDb ?? -6;
  const liftDb = opts.eventLiftDb ?? 2;
  const lead = opts.eventLeadS ?? 0.15;
  const hold = opts.eventHoldS ?? 0.8;
  const release = opts.eventReleaseS ?? 0.6;
  const duckDb = opts.poweredDuckDb ?? -3;
  const fadeIn = opts.fadeInS ?? 0.5;
  const rest = opts.finalRestS ?? 0.5;
  const xf = opts.crossfadeS ?? 2;

  const totalS = r6(s.total / fps);
  const musicEnd = r6(totalS - rest);
  const poweredStart = r6(s.like_end / fps);
  const fadeOutS = r6(Math.min(totalS - poweredStart - rest, musicEnd));

  // generation strategy
  const reserveRetry = opts.reserveRetry ?? false;
  const single = musicEnd * (reserveRetry ? 2 : 1) <= budgetS + 1e-9;
  const cues: BedCue[] = [];
  const takes: BedTake[] = [];
  const mk = (i: number, takeId: string, start: number, end: number, fin: number, fout: number): BedCue => ({
    cue_id: `bed${i + 1}`,
    takeId,
    start_s: r6(start),
    end_s: r6(end),
    lengthMs: Math.round((end - start) * 1000),
    gainDb,
    scenes: [],
    fadeInS: r6(fin),
    fadeOutS: r6(fout),
  });
  if (single) {
    takes.push({ takeId: "bed", lengthMs: Math.round(musicEnd * 1000) });
    cues.push(mk(0, "bed", 0, musicEnd, Math.min(fadeIn, musicEnd / 2), fadeOutS));
  } else {
    // one take of length L, placed n times with overlap xf so n segments exactly tile [0, musicEnd]
    const loopS = opts.loopS ?? 30;
    if (!(loopS > 0)) throw new RangeError(`loopS must be a positive number of seconds, got ${loopS}`);
    const l0 = Math.max(minTakeS, Math.min(loopS, budgetS / 2));
    // each segment must advance: a crossfade >= the take never tiles the bed (n -> Infinity)
    if (!(xf >= 0 && xf < l0))
      throw new RangeError(`crossfadeS must be >= 0 and shorter than the ${l0} s loop take, got ${xf}`);
    const n = Math.max(2, Math.ceil((musicEnd - xf) / (l0 - xf)));
    const len = Math.ceil(((musicEnd + (n - 1) * xf) / n) * 1000) / 1000;
    takes.push({ takeId: "bed-loop", lengthMs: Math.round(len * 1000) });
    for (let i = 0; i < n; i++) {
      const start = i * (len - xf);
      const last = i === n - 1;
      const fin = i === 0 ? Math.min(fadeIn, len / 2) : xf;
      cues.push(mk(i, "bed-loop", start, last ? musicEnd : start + len, fin, last ? fadeOutS : xf));
    }
  }
  const generationS = r6(takes.reduce((a, t) => a + t.lengthMs, 0) / 1000);

  // event lifts: sound leads the picture, the card confirms
  const lifts: { from: number; peak: number; hold: number; to: number; db: number; reason: string }[] = [];
  const addLift = (frame: number, db: number, reason: string) => {
    const t = frame / fps;
    if (t >= musicEnd) return;
    lifts.push({ from: Math.max(0, t - lead), peak: t, hold: t + hold, to: t + hold + release, db, reason });
  };
  for (const e of plan.events) addLift(e.frame, liftDb, `event ${e.id}`);
  addLift(s.timeline_end, liftDb, "winner spotlight");
  lifts.sort((a, b) => a.peak - b.peak);

  // the duck has its own attack point: without it, bedLevelDbAt would ramp from the previous
  // breakpoint (the spotlight lift's end) and sag under the spotlight and like cards
  const breaks = new Set<number>([0, musicEnd, poweredStart, r6(Math.max(0, poweredStart - lead))]);
  for (const l of lifts) for (const t of [l.from, l.peak, l.hold, l.to]) breaks.add(r6(Math.min(t, musicEnd)));
  const level = (t: number) => {
    if (t >= poweredStart) return { db: duckDb, why: "powered card duck" };
    let db = 0;
    let why = "base";
    for (const l of lifts) {
      let x = 0;
      if (t >= l.peak && t <= l.hold) x = 1;
      else if (t > l.from && t < l.peak) x = (t - l.from) / (l.peak - l.from);
      else if (t > l.hold && t < l.to) x = 1 - (t - l.hold) / (l.to - l.hold);
      if (x * l.db > db) {
        db = x * l.db;
        why = l.reason;
      }
    }
    return { db, why };
  };
  const envelope: EnvelopeLift[] = [...breaks]
    .sort((a, b) => a - b)
    .map((t) => {
      const { db, why } = level(t);
      return { t_s: t, db: r3(db), reason: why };
    });

  const silences: Silence[] = rest > 0 ? [{ start_s: musicEnd, end_s: totalS, reason: "final rest" }] : [];
  const scoredS = r6(musicEnd);
  return {
    totalS,
    cues,
    entry: { start_s: 0, fadeInS: cues[0]?.fadeInS ?? 0 },
    tail: { start_s: r6(s.timeline_end / fps), end_s: musicEnd, fadeOutS },
    envelope,
    silences,
    coverage: { scoredS, silentS: r6(totalS - scoredS) },
    generation: {
      strategy: single ? "single" : "loop",
      takes,
      generationS,
      withRetryS: r6(generationS * 2),
      budgetS,
      fitsBudget: generationS <= budgetS + 1e-9,
      retryFits: generationS * 2 <= budgetS + 1e-9,
    },
  };
}

/** Bed level (dB relative to the cue gain) at absolute time `t`; linear between envelope points. */
export function bedLevelDbAt(env: EnvelopeLift[], t: number): number {
  const first = env[0];
  if (!first) return 0;
  if (t <= first.t_s) return first.db;
  for (let i = 1; i < env.length; i++) {
    const a = env[i - 1] as EnvelopeLift;
    const b = env[i] as EnvelopeLift;
    if (t <= b.t_s) return b.t_s === a.t_s ? b.db : a.db + ((b.db - a.db) * (t - a.t_s)) / (b.t_s - a.t_s);
  }
  return (env.at(-1) as EnvelopeLift).db;
}

/** Attach accepted takes to the placed cues; ready for `mixPlan({ scenes: [], cues })`. */
export function attachBedSources(cues: BedCue[], srcByTake: Record<string, string>): BedCue[] {
  return cues.map((c) => {
    const src = srcByTake[c.takeId];
    if (src === undefined) throw new Error(`no source for bed take '${c.takeId}'`);
    return { ...c, src };
  });
}

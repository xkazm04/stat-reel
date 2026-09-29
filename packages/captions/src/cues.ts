import type { Cue, Format, WordTiming } from "@statreel/schemas";
import { fitCharsPerLine } from "./geometry";
import { isGlued, joinDisplay } from "./text";

/** Netflix timed-text rules as adopted in DESIGN.md §6.5. */
export const CUE_RULES = {
  maxLines: 2,
  lineLimit: { vertical: 32, landscape: 42 },
  targetCps: 17,
  maxCps: 20,
  minDuration_s: 0.8,
  maxDuration_s: 7,
  minGapFrames: 2,
  /** gaps shorter than this are closed down to the minimum gap (avoids caption flicker) */
  chainGap_s: 0.5,
  /** default linger allowed after the last word when no `endLimit_s` is given */
  tailLinger_s: 1,
} as const;

export type BuildCuesOptions = {
  format: Format;
  fps: number;
  /** override the per-line character limit (default: `maxCharsPerLine(format)`) */
  maxCharsPerLine?: number;
  /** latest time the last cue may extend to (e.g. timeline duration); default last word end + 1 s */
  endLimit_s?: number;
};

/**
 * Characters per line: the DESIGN rule (32 vertical / 42 landscape), tightened to what fits the
 * burn-in caption box at the spec font size so burned captions never leave the safe zone.
 */
export const maxCharsPerLine = (format: Format): number =>
  Math.min(CUE_RULES.lineLimit[format], fitCharsPerLine(format));

/** Characters (incl. spaces) shown by a cue; a line break counts as one space. */
export const cueChars = (cue: Pick<Cue, "lines">): number => cue.lines.join(" ").length;

/** Reading speed of a cue in characters per second. */
export const cueCps = (cue: Cue): number => {
  const d = cue.end_s - cue.start_s;
  return d > 0 ? cueChars(cue) / d : Number.POSITIVE_INFINITY;
};

/** Highest reading speed across cues (0 for none). */
export const maxCps = (cues: Cue[]): number => cues.reduce((m, c) => Math.max(m, cueCps(c)), 0);

// ------------------------------------------------------------------ segmentation

/** A word plus any punctuation-only tokens glued to it: the unit that is never split. */
type Atom = { text: string; words: WordTiming[]; start: number; end: number; scene: string };

function toAtoms(words: WordTiming[]): Atom[] {
  const atoms: Atom[] = [];
  for (const w of words) {
    const last = atoms.at(-1);
    if (last && isGlued(w.display) && last.scene === w.scene_id) {
      last.words.push(w);
      last.text = joinDisplay(last.words.map((x) => x.display));
      last.end = Math.max(last.end, w.end_s);
    } else {
      atoms.push({ text: w.display, words: [w], start: w.start_s, end: w.end_s, scene: w.scene_id });
    }
  }
  return atoms;
}

/**
 * Lay out atom texts on one line if they fit, else on two balanced lines (mild preference for a
 * bottom-heavy pyramid and for breaking after punctuation). Null if two lines cannot hold them.
 */
export function layoutLines(parts: string[], maxChars: number): string[] | null {
  const full = joinDisplay(parts);
  if (full.length <= maxChars) return [full];
  let best: string[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let k = 1; k < parts.length; k++) {
    if (isGlued(parts[k] ?? "")) continue;
    const a = joinDisplay(parts.slice(0, k));
    const b = joinDisplay(parts.slice(k));
    if (a.length > maxChars || b.length > maxChars) continue;
    let score = Math.abs(a.length - b.length) + (a.length > b.length ? 1 : 0);
    if (/[,.!?;:…—–]$/.test(a)) score -= 3;
    if (score < bestScore) {
      bestScore = score;
      best = [a, b];
    }
  }
  return best;
}

const SENTENCE_END = /[.!?…]["')\]]*$/;
const CLAUSE_END = /[,;:—–]["')\]]*$/;

function breakPenalty(last: Atom, next: Atom | undefined): number {
  if (!next || next.scene !== last.scene) return 0;
  if (SENTENCE_END.test(last.text)) return 0;
  if (CLAUSE_END.test(last.text)) return 0.5;
  return 1.5;
}

function cpsPenalty(cps: number): number {
  let p = 0;
  if (cps > CUE_RULES.targetCps) p += (cps - CUE_RULES.targetCps) * 2;
  if (cps > CUE_RULES.maxCps) p += 100 + (cps - CUE_RULES.maxCps) * 10;
  return p;
}

type Segment = { atoms: Atom[]; lines: string[] };

/**
 * Split timed words into caption cues (DESIGN.md §6.5): ≤ 2 lines, per-line char limit, 15–17 CPS
 * target / 20 CPS hard max, 0.8–7 s, ≥ 2 frames between cues, never inside a word, always at scene
 * boundaries, preferably after punctuation. Segmentation is a shortest-path search over break
 * points; cue ends are then extended into available gaps. Cues that still exceed 20 CPS are kept
 * and show up in `maxCps`.
 */
export function buildCues(words: WordTiming[], opts: BuildCuesOptions): Cue[] {
  const { fps } = opts;
  const atoms = toAtoms(words);
  const n = atoms.length;
  if (n === 0) return [];
  const maxChars = opts.maxCharsPerLine ?? maxCharsPerLine(opts.format);
  const gap_s = CUE_RULES.minGapFrames / fps;
  const lastWordEnd = Math.max(...atoms.map((a) => a.end));
  const endLimit = opts.endLimit_s ?? lastWordEnd + CUE_RULES.tailLinger_s;

  const best = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const from = new Array<number>(n + 1).fill(-1);
  const segLines = new Array<string[] | undefined>(n + 1);
  best[0] = 0;

  for (let i = 0; i < n; i++) {
    const bi = best[i] ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(bi)) continue;
    const first = atoms[i] as Atom;
    let natEnd = first.end;
    for (let j = i + 1; j <= n; j++) {
      const last = atoms[j - 1] as Atom;
      if (last.scene !== first.scene) break;
      natEnd = Math.max(natEnd, last.end);
      const single = j === i + 1;
      if (!single && natEnd - first.start > CUE_RULES.maxDuration_s) break;
      const parts = atoms.slice(i, j).map((a) => a.text);
      const lines = layoutLines(parts, maxChars) ?? (single ? [parts[0] ?? ""] : null);
      if (!lines) break;

      const next = atoms[j];
      const avail = (next ? next.start - gap_s : endLimit) - first.start;
      const chars = lines.join(" ").length;
      const wanted = Math.max(natEnd - first.start, chars / CUE_RULES.targetCps, CUE_RULES.minDuration_s);
      const dur = Math.max(Math.min(wanted, avail, CUE_RULES.maxDuration_s), 1 / fps);
      const cost = 1 + breakPenalty(last, next) + cpsPenalty(chars / dur) + (dur < CUE_RULES.minDuration_s ? 3 : 0);
      if (bi + cost < (best[j] ?? Number.POSITIVE_INFINITY)) {
        best[j] = bi + cost;
        from[j] = i;
        segLines[j] = lines;
      }
    }
  }

  const segments: Segment[] = [];
  for (let j = n; j > 0; ) {
    const i = from[j] ?? -1;
    if (i < 0) throw new Error("caption segmentation failed");
    segments.unshift({ atoms: atoms.slice(i, j), lines: segLines[j] ?? [] });
    j = i;
  }

  return timeSegments(segments, fps, endLimit);
}

/** Assign frame-aligned times: extend for min duration / target CPS, keep the 2-frame gap, chain small gaps. */
function timeSegments(segments: Segment[], fps: number, endLimit_s: number): Cue[] {
  const eps = 1e-9;
  const gapF = CUE_RULES.minGapFrames;
  const maxDurF = Math.floor(CUE_RULES.maxDuration_s * fps + eps);
  const minDurF = Math.ceil(CUE_RULES.minDuration_s * fps - eps);
  const chainF = Math.round(CUE_RULES.chainGap_s * fps);
  const endLimitF = Math.round(endLimit_s * fps);

  const timed = segments.map((s) => ({
    startF: Math.round((s.atoms[0]?.start ?? 0) * fps),
    natEndF: Math.round(Math.max(...s.atoms.map((a) => a.end)) * fps),
    chars: s.lines.join(" ").length,
    seg: s,
    endF: 0,
  }));

  for (let k = 0; k < timed.length; k++) {
    const cur = timed[k];
    if (!cur) continue;
    const next = timed[k + 1];
    const maxF = cur.startF + maxDurF;
    const limitF = next ? next.startF - gapF : Math.max(endLimitF, cur.natEndF);
    const cpsF = cur.startF + Math.ceil((cur.chars / CUE_RULES.targetCps) * fps - eps);
    let endF = Math.min(Math.max(cur.natEndF, cur.startF + minDurF, cpsF), maxF, limitF);
    if (next && limitF - endF < chainF) endF = Math.min(limitF, maxF);
    if (endF <= cur.startF) {
      endF = cur.startF + 1;
      if (next && next.startF < endF + gapF) next.startF = endF + gapF;
    }
    cur.endF = endF;
  }

  return timed.map((c) => ({
    start_s: c.startF / fps,
    end_s: c.endF / fps,
    lines: c.seg.lines,
    words: c.seg.atoms.flatMap((a) => a.words),
  }));
}

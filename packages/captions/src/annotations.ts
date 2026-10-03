import type { Cue } from "@statreel/schemas";

/**
 * Cues from on-screen annotations (DESIGN.md §6.2, §6.5; ADR 007). The format has no narration, so
 * `buildCues` (which needs TTS word timings) never runs; the timed text a viewer reads is the
 * DataRace event cards. This maps those cards to cues so a music-only video still gets an SRT/VTT
 * sidecar (WCAG 1.2.2). Pure, frame-aligned, seek-stable: no clocks, no randomness.
 */

/** One annotation: `frame` is the card's start_frame; `dwell` is how many frames it stays up. */
export type AnnotationEvent = {
  id: string;
  /** title, optionally with date / fact on further lines ("\n"); more than two lines are folded */
  text: string;
  frame: number;
  dwell: number;
};

export type AnnotationCueOptions = {
  fps: number;
  /** minimum on-screen hold in seconds (DESIGN.md §6.2: text is readable for at least 2 s) */
  minHoldS?: number;
  /** frames between consecutive cues (Netflix minimum, DESIGN.md §6.5) */
  gapFrames?: number;
  /** last frame of the video; cues are cut to it and dropped if nothing is left */
  endFrame?: number;
};

type Span = { start: number; end: number; lines: string[] };

/** A cue holds at most two lines (CueSchema); overflow is folded into line 2 with " / ". */
function foldLines(lines: string[]): string[] {
  if (lines.length <= 2) return lines;
  return [lines[0] as string, lines.slice(1).join(" / ")];
}

/**
 * Overlap policy, applied in (frame, id) order:
 *  1. if the next card starts after this one ends plus the gap, nothing to do;
 *  2. else trim this cue to end `gapFrames` before the next, provided it still holds `minHoldS`;
 *  3. else merge (stack) the two into one cue spanning both, lines concatenated and folded to two.
 * A cue therefore never overlaps another, never sits under the minimum hold (except when cut by
 * `endFrame`), and no text is lost.
 */
export function cuesFromAnnotations(events: AnnotationEvent[], opts: AnnotationCueOptions): Cue[] {
  const { fps } = opts;
  const gap = opts.gapFrames ?? 2;
  const minHold = Math.ceil((opts.minHoldS ?? 2) * fps);
  const sorted = events
    .map((e) => ({ ...e, lines: e.text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "") }))
    .filter((e) => e.lines.length > 0)
    .sort((a, b) => a.frame - b.frame || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const spans: Span[] = [];
  let cur: Span | undefined;
  for (const e of sorted) {
    const start = Math.round(e.frame);
    const next: Span = { start, end: start + Math.max(Math.round(e.dwell), minHold), lines: e.lines };
    if (!cur) {
      cur = next;
    } else if (next.start >= cur.end + gap) {
      spans.push(cur);
      cur = next;
    } else if (next.start - gap - cur.start >= minHold) {
      cur.end = next.start - gap;
      spans.push(cur);
      cur = next;
    } else {
      cur = { start: cur.start, end: Math.max(cur.end, next.end), lines: [...cur.lines, ...next.lines] };
    }
  }
  if (cur) spans.push(cur);

  const cues: Cue[] = [];
  for (const s of spans) {
    const end = opts.endFrame === undefined ? s.end : Math.min(s.end, opts.endFrame);
    if (end <= s.start) continue;
    cues.push({ start_s: s.start / fps, end_s: end / fps, lines: foldLines(s.lines), words: [] });
  }
  return cues;
}

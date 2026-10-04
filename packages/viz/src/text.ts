/**
 * Text helpers. Frames are laid out without DOM measurement (seek-stable and identical in Node
 * tests), so widths come from a table of real advance widths generated from the OFL fonts in
 * fonts/ (`scripts/font-metrics.mjs` -> font-metrics.generated.ts, Latin-1 plus common
 * punctuation). A glyph the table does not know falls back to the old per-face average in em.
 * Kerning is not applied; it only tightens pairs, so a sum of advances is an upper bound.
 */
import { FONT_ADVANCES, FONT_METRIC_CODES } from "./font-metrics";

/** Average advance width in em: the fallback for glyphs the metrics table lacks. Mono is exact (0.6). */
export const CHAR_EM = {
  mono: 0.6,
  /** Barlow Condensed, upper case, weight 700-800 */
  condensedCaps: 0.46,
  /** Barlow Condensed, mixed case */
  condensed: 0.44,
  /** Inter, mixed case */
  ui: 0.56,
} as const;
export type FaceKey = keyof typeof CHAR_EM;

/** CSS font-weight each face key is measured at unless the caller passes one (what the compositions mostly use). */
export const DEFAULT_WEIGHT: Readonly<Record<FaceKey, number>> = {
  mono: 700,
  condensedCaps: 800,
  condensed: 700,
  ui: 500,
};
const TABLE_FACE: Record<FaceKey, string> = {
  mono: "mono",
  condensedCaps: "condensed",
  condensed: "condensed",
  ui: "ui",
};

/** Glyphs far wider than the face average (arrows, em dash), counted as two characters in the fallback. */
const WIDE = /[←-⇿—]/u;

const advanceMaps = new Map<string, Map<number, number>>();
/** codepoint -> advance in 1/1000 em for the table nearest `weight` of `face`; absent = unknown glyph. */
function advances(face: FaceKey, weight: number): Map<number, number> {
  const prefix = `${TABLE_FACE[face]}-`;
  const weights = Object.keys(FONT_ADVANCES)
    .filter((k) => k.startsWith(prefix))
    .map((k) => Number(k.slice(prefix.length)));
  const w = weights.reduce(
    (best, x) => (Math.abs(x - weight) < Math.abs(best - weight) ? x : best),
    weights[0] as number,
  );
  const key = `${prefix}${w}`;
  let m = advanceMaps.get(key);
  if (!m) {
    const row = FONT_ADVANCES[key] as readonly number[];
    m = new Map();
    FONT_METRIC_CODES.forEach((cp, i) => {
      const a = row[i] as number;
      if (a > 0) m?.set(cp, a);
    });
    advanceMaps.set(key, m);
  }
  return m;
}

/**
 * Width in px of `text` set in `face` at `fontSize` (and CSS `weight`, default per face) plus
 * `letterSpacing` px after every character. The sum of real advances; fallback per unknown glyph.
 */
export function measureText(
  text: string,
  fontSize: number,
  face: FaceKey,
  letterSpacing = 0,
  weight: number = DEFAULT_WEIGHT[face],
): number {
  const table = advances(face, weight);
  let w = 0;
  for (const ch of text) {
    const adv = table.get(ch.codePointAt(0) as number);
    w +=
      (adv !== undefined ? adv / 1000 : (WIDE.test(ch) && face !== "mono" ? 2 : 1) * CHAR_EM[face]) * fontSize +
      letterSpacing;
  }
  return w;
}

/** Same as `measureText`; the name the layouts already use. */
export const estimateWidth = measureText;

type WrapOpts = {
  weight?: number;
  /** split a single word wider than the column at a character boundary */
  breakWords?: boolean;
  /** fill every line to the column, breaking at any character (spaces at a line edge dropped): the densest wrap */
  flow?: boolean;
};

/** Splits a word that is wider than `maxWidth` into the longest runs that fit (at least one character each). */
function breakWord(word: string, maxWidth: number, fit: (s: string) => number): string[] {
  const parts: string[] = [];
  let run = "";
  for (const ch of word) {
    if (run && fit(run + ch) > maxWidth) {
      parts.push(run);
      run = ch;
    } else run += ch;
  }
  if (run) parts.push(run);
  return parts;
}

/**
 * Greedy word wrap to lines no wider than `maxWidth` (measured). A single long word stays whole
 * unless `breakWords` is set, which splits it at character boundaries (names with no space).
 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  face: FaceKey,
  letterSpacing = 0,
  opts: WrapOpts = {},
): string[] {
  const fit = (s: string): number => measureText(s, fontSize, face, letterSpacing, opts.weight);
  if (opts.flow) {
    const flowed: string[] = [];
    let cur = "";
    for (const ch of [...text.trim().replace(/\s+/g, " ")]) {
      if (cur && fit(cur + ch) > maxWidth) {
        flowed.push(cur.trimEnd());
        cur = ch === " " ? "" : ch;
      } else cur += ch;
    }
    if (cur.trim()) flowed.push(cur.trimEnd());
    return flowed;
  }
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (opts.breakWords && fit(w) > maxWidth) {
      // a word wider than the column is cut into full lines; its last run may take the next word
      if (line) lines.push(line);
      const parts = breakWord(w, maxWidth, fit);
      lines.push(...parts.slice(0, -1));
      line = parts.at(-1) ?? "";
      continue;
    }
    const next = line ? `${line} ${w}` : w;
    if (line && fit(next) > maxWidth) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** `text` cut to the longest prefix that fits `maxWidth` with a trailing "…" (unchanged when it already fits). */
export function ellipsize(
  text: string,
  maxWidth: number,
  fontSize: number,
  face: FaceKey,
  letterSpacing = 0,
  weight?: number,
): string {
  const fit = (s: string): number => measureText(s, fontSize, face, letterSpacing, weight);
  if (fit(text) <= maxWidth) return text;
  const chars = [...text.trimEnd()];
  while (chars.length > 1 && fit(`${chars.join("")}…`) > maxWidth) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

/**
 * Largest font size in [min, max] (step 2) at which `text` wraps into at most `maxLines` lines that
 * all fit `maxWidth` and whose block height fits `maxHeight`. If nothing fits, the `min` layout is
 * returned and `fits` is false (callers decide: ellipsize, or fail a test).
 */
export function fitText(
  text: string,
  {
    maxWidth,
    maxHeight = Infinity,
    maxLines = 4,
    min = 24,
    max = 160,
    face = "condensedCaps" as FaceKey,
    lineHeight = 1,
    letterSpacingEm = 0,
    weight,
    breakWords = false,
    flow = false,
  }: {
    maxWidth: number;
    maxHeight?: number;
    maxLines?: number;
    min?: number;
    max?: number;
    face?: FaceKey;
    lineHeight?: number;
    letterSpacingEm?: number;
    weight?: number;
    breakWords?: boolean;
    flow?: boolean;
  },
): { fontSize: number; lines: string[]; fits: boolean } {
  for (let size = max; size >= min; size -= 2) {
    const ls = letterSpacingEm * size;
    const lines = wrapText(text, maxWidth, size, face, ls, { weight, breakWords, flow });
    const fits =
      lines.length <= maxLines &&
      lines.every((l) => measureText(l, size, face, ls, weight) <= maxWidth) &&
      lines.length * size * lineHeight <= maxHeight;
    if (fits) return { fontSize: size, lines, fits: true };
  }
  return {
    fontSize: min,
    lines: wrapText(text, maxWidth, min, face, letterSpacingEm * min, { weight, breakWords, flow }),
    fits: false,
  };
}

/** 1 -> "1st", 22 -> "22nd", 43 -> "43rd", 11 -> "11th". */
export function ordinal(n: number): string {
  return `${n}${ordinalSuffix(n)}`;
}
export function ordinalSuffix(n: number): string {
  const v = Math.abs(Math.round(n)) % 100;
  if (v >= 11 && v <= 13) return "th";
  return ["th", "st", "nd", "rd"][v % 10] ?? "th";
}

/** Last whitespace-separated token ("Juan Manuel Fangio" -> "Fangio"). */
export const surname = (name: string): string => name.trim().split(/\s+/).at(-1) ?? name;

/** Fixed-decimal format with a proper minus sign. */
export function formatFixed(value: number, decimals: number): string {
  const s = Math.abs(value).toFixed(decimals);
  return value < 0 && Number(s) !== 0 ? `−${s}` : s;
}

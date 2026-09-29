/**
 * Text helpers. Frames are laid out without DOM measurement (seek-stable and identical in Node
 * tests), so widths are conservative per-face estimates in em.
 */

/** Average advance width in em. Mono is exact (0.6); the others are conservative upper bounds. */
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

/** Glyphs far wider than the face average (arrows, em dash), counted as two characters. */
const WIDE = /[←-⇿—]/u;

export const estimateWidth = (text: string, fontSize: number, face: FaceKey, letterSpacing = 0): number =>
  [...text].reduce(
    (w, ch) => w + (WIDE.test(ch) && face !== "mono" ? 2 : 1) * CHAR_EM[face] * fontSize + letterSpacing,
    0,
  );

/** Greedy word wrap to lines no wider than `maxWidth` (estimated). A single long word stays whole. */
export function wrapText(text: string, maxWidth: number, fontSize: number, face: FaceKey, letterSpacing = 0): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && estimateWidth(next, fontSize, face, letterSpacing) > maxWidth) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Largest font size in [min, max] (step 2) at which `text` wraps into at most `maxLines` lines that
 * all fit `maxWidth` and whose block height fits `maxHeight`.
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
  }: {
    maxWidth: number;
    maxHeight?: number;
    maxLines?: number;
    min?: number;
    max?: number;
    face?: FaceKey;
    lineHeight?: number;
    letterSpacingEm?: number;
  },
): { fontSize: number; lines: string[] } {
  for (let size = max; size >= min; size -= 2) {
    const ls = letterSpacingEm * size;
    const lines = wrapText(text, maxWidth, size, face, ls);
    const fits =
      lines.length <= maxLines &&
      lines.every((l) => estimateWidth(l, size, face, ls) <= maxWidth) &&
      lines.length * size * lineHeight <= maxHeight;
    if (fits) return { fontSize: size, lines };
  }
  return { fontSize: min, lines: wrapText(text, maxWidth, min, face, letterSpacingEm * min) };
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

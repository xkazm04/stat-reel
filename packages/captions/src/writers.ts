import type { Cue } from "@statreel/schemas";

function timestamp(seconds: number, sep: "," | "."): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000) % 60;
  const h = Math.floor(totalMs / 3600000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms, 3)}`;
}

/**
 * Cue text hazards, shared by both formats. A blank line ends a cue in SRT and VTT, and "-->" is
 * the timing separator, so either inside text corrupts the file. Annotation text comes from the
 * LLM co-pilot, so it is never trusted to be benign. "-->" becomes a right arrow (U+2192: it
 * keeps the meaning, and it is neutralised before VTT escaping so it never turns into "--&gt;").
 * Embedded newlines split into lines and blank lines are dropped. Benign text is unchanged.
 */
function cleanLines(lines: string[]): string[] {
  return lines
    .flatMap((l) => l.replaceAll("-->", "\u2192").split(/\r\n|\r|\n/))
    .filter((l) => l.trim() !== "");
}

/** WebVTT cue text is markup: `&`, `<` and `>` must be escaped (WebVTT spec, cue text parsing). */
function escapeVtt(line: string): string {
  return line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A cue with no text left after cleaning would be an empty block that ends the file early: dropped. */
function withText(cues: Cue[]): { cue: Cue; lines: string[] }[] {
  return cues.map((cue) => ({ cue, lines: cleanLines(cue.lines) })).filter((c) => c.lines.length > 0);
}

/** SubRip: 1-based index, `HH:MM:SS,mmm --> HH:MM:SS,mmm`, text lines, blank line between cues. */
export function toSrt(cues: Cue[]): string {
  const kept = withText(cues);
  if (kept.length === 0) return "";
  const blocks = kept.map(
    ({ cue: c, lines }, i) =>
      `${i + 1}\n${timestamp(c.start_s, ",")} --> ${timestamp(c.end_s, ",")}\n${lines.join("\n")}`,
  );
  return `${blocks.join("\n\n")}\n`;
}

/** WebVTT: `WEBVTT` header, `HH:MM:SS.mmm --> HH:MM:SS.mmm`, escaped text lines, blank line between cues. */
export function toVtt(cues: Cue[]): string {
  const blocks = withText(cues).map(
    ({ cue: c, lines }) =>
      `${timestamp(c.start_s, ".")} --> ${timestamp(c.end_s, ".")}\n${lines.map(escapeVtt).join("\n")}`,
  );
  return blocks.length === 0 ? "WEBVTT\n" : `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

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

/** SubRip: 1-based index, `HH:MM:SS,mmm --> HH:MM:SS,mmm`, text lines, blank line between cues. */
export function toSrt(cues: Cue[]): string {
  if (cues.length === 0) return "";
  const blocks = cues.map(
    (c, i) => `${i + 1}\n${timestamp(c.start_s, ",")} --> ${timestamp(c.end_s, ",")}\n${c.lines.join("\n")}`,
  );
  return `${blocks.join("\n\n")}\n`;
}

/** WebVTT: `WEBVTT` header, `HH:MM:SS.mmm --> HH:MM:SS.mmm`, text lines, blank line between cues. */
export function toVtt(cues: Cue[]): string {
  const blocks = cues.map((c) => `${timestamp(c.start_s, ".")} --> ${timestamp(c.end_s, ".")}\n${c.lines.join("\n")}`);
  return blocks.length === 0 ? "WEBVTT\n" : `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

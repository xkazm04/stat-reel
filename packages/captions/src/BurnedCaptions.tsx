import type { VideoTheme } from "@statreel/design-tokens";
import type { Cue, Format, WordTiming } from "@statreel/schemas";
import { Fragment, type ReactElement } from "react";
import { CAPTION_STYLE, CAPTION_WEIGHT, captionBox } from "./geometry";
import { isGlued, joinDisplay } from "./text";

/** The cue whose [start_s, end_s) contains t, or null. */
export function activeCueAt(cues: Cue[], t: number): Cue | null {
  for (const c of cues) if (c.start_s <= t && t < c.end_s) return c;
  return null;
}

/** Index into cue.words of the word whose [start_s, end_s) contains t, or -1 (pause / none). */
export function activeWordIndex(cue: Cue, t: number): number {
  return cue.words.findIndex((w) => w.start_s <= t && t < w.end_s);
}

type IndexedWord = { word: WordTiming; index: number };

/** Distribute cue.words over cue.lines; null when the lines are not a re-join of the words. */
export function wordsByLine(cue: Cue): IndexedWord[][] | null {
  const out: IndexedWord[][] = [];
  let idx = 0;
  for (const line of cue.lines) {
    const group: IndexedWord[] = [];
    while (idx < cue.words.length) {
      group.push({ word: cue.words[idx] as WordTiming, index: idx });
      idx++;
      if (joinDisplay(group.map((g) => g.word.display)).length >= line.length) break;
    }
    if (joinDisplay(group.map((g) => g.word.display)) !== line) return null;
    out.push(group);
  }
  return idx === cue.words.length ? out : null;
}

export type BurnedCaptionsProps = { cues: Cue[]; t: number; format: Format; theme: VideoTheme };

/**
 * Burned-in captions. A pure function of `t` (seconds): no state, no effects, no CSS
 * transitions, so any frame renders identically in any order.
 */
export function BurnedCaptions({ cues, t, format, theme }: BurnedCaptionsProps): ReactElement | null {
  const cue = activeCueAt(cues, t);
  // no visible text, no plate: an empty translucent sheet is the one cue the sidecars drop and the burn-in kept
  if (!cue || cue.lines.every((l) => l.trim() === "")) return null;
  const box = captionBox(format);
  const s = CAPTION_STYLE[format];
  const active = activeWordIndex(cue, t);
  const grouped = wordsByLine(cue);

  return (
    <div
      data-captions=""
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.maxHeight,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          boxSizing: "border-box",
          maxWidth: "100%",
          padding: `${s.padY}px ${s.padX}px`,
          borderRadius: s.radius,
          background: theme.captionBox,
          color: theme.captionInk,
          fontFamily: theme.fonts.ui,
          fontWeight: CAPTION_WEIGHT,
          fontSize: s.fontSize,
          lineHeight: s.lineHeight,
          // proportional: a cue is static text, and Inter's tnum also widens hyphens ("43rd - highest")
          fontVariantNumeric: "proportional-nums",
          textAlign: "center",
        }}
      >
        {grouped
          ? grouped.map((line) => (
              <div key={line[0]?.index ?? -1} style={{ whiteSpace: "nowrap" }}>
                {line.map(({ word, index }, wi) => (
                  <Fragment key={index}>
                    {wi > 0 && !isGlued(word.display) ? " " : null}
                    <span style={index === active ? { color: theme.captionActive } : undefined}>{word.display}</span>
                  </Fragment>
                ))}
              </div>
            ))
          : cue.lines.map((line) => (
              <div key={line} style={{ whiteSpace: "nowrap" }}>
                {line}
              </div>
            ))}
      </div>
    </div>
  );
}

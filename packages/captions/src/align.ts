import { type CharAlignment, type ScriptScene, sceneSpokenText, type WordTiming } from "@statreel/schemas";

/** Collapse whitespace runs, drop whitespace before punctuation (as the script join does), trim. */
const normalise = (s: string): string =>
  s
    .replace(/\s+/g, " ")
    .replace(/ ([,.!?;:])/g, "$1")
    .trim();

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const WS = /\s/;

type TimedChar = { ch: string; start: number; end: number };

/**
 * Group an ElevenLabs character-level alignment of `sceneSpokenText(scene)` into one WordTiming per
 * script token. A token is a unit even when its spoken form has spaces or hyphens
 * ("one hundred and five" -> display "105"). Times are shifted by `offset_s` (scene start in the
 * final timeline).
 */
/**
 * A token may carry a whole phrase ("Lewis Hamilton leads."). When its display and spoken forms have
 * the same number of words, map them pairwise so captions can break between words. When the counts
 * differ ("105" / "one hundred and five") the token stays atomic: its words can't be paired.
 */
function expandTokens<T extends { display: string; spoken: string }>(tokens: T[]): T[] {
  return tokens.flatMap((t) => {
    const d = t.display.trim().split(/\s+/).filter(Boolean);
    const s = t.spoken.trim().split(/\s+/).filter(Boolean);
    if (d.length > 1 && d.length === s.length) return d.map((word, i) => ({ ...t, display: word, spoken: s[i]! }));
    return [t];
  });
}

export function wordsFromAlignment(scene: ScriptScene, alignment: CharAlignment, offset_s: number): WordTiming[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (starts.length !== characters.length || ends.length !== characters.length) {
    throw new Error(
      `alignment for scene "${scene.scene_id}" has mismatched array lengths: ` +
        `characters=${characters.length}, starts=${starts.length}, ends=${ends.length}`,
    );
  }

  const spoken = sceneSpokenText(scene);
  const aligned = characters.join("");
  if (normalise(aligned) !== normalise(spoken)) {
    throw new Error(
      `alignment text does not match spoken text for scene "${scene.scene_id}": ` +
        `expected ${JSON.stringify(normalise(spoken))}, got ${JSON.stringify(normalise(aligned))}`,
    );
  }

  // Flatten to code units (an alignment entry is normally one character, but be safe).
  const flat: TimedChar[] = [];
  characters.forEach((entry, i) => {
    for (const ch of entry) flat.push({ ch, start: starts[i] ?? 0, end: ends[i] ?? 0 });
  });

  // The non-whitespace character sequences are equal (normalised texts match), so a greedy walk
  // that skips whitespace on both sides maps every token character to exactly one alignment entry.
  const words: WordTiming[] = [];
  let p = 0;
  let prevEnd = flat.find((c) => !WS.test(c.ch))?.start ?? 0;
  for (const token of expandTokens(scene.tokens)) {
    const chars = token.spoken.replace(/\s+/g, "");
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const ch of chars) {
      while (p < flat.length && WS.test(flat[p]?.ch ?? "")) p++;
      const c = flat[p];
      if (!c || c.ch !== ch) {
        throw new Error(`alignment walk failed in scene "${scene.scene_id}" at token ${JSON.stringify(token.spoken)}`);
      }
      start = Math.min(start, c.start);
      end = Math.max(end, c.end);
      p++;
    }
    if (!Number.isFinite(start)) {
      // token with an empty spoken form: zero-length at the previous word's end
      start = prevEnd;
      end = prevEnd;
    }
    if (end < start) end = start;
    prevEnd = end;
    words.push({
      scene_id: scene.scene_id,
      display: token.display,
      spoken: token.spoken,
      start_s: round6(offset_s + start),
      end_s: round6(offset_s + end),
    });
  }
  return words;
}

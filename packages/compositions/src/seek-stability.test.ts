/**
 * Static lint for seek-stable compositions (ADR 003 gaps): frames render out of order, so nothing
 * on the render path may keep state across frames, run effects, animate in CSS, or read a clock
 * or an unseeded RNG. Scans packages/compositions/src and packages/viz/src, tests excluded.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [here, path.resolve(here, "..", "..", "viz", "src")];

const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "CSS transition", re: /\btransition\s*:/ },
  { name: "CSS animation", re: /\banimation\s*:/ },
  { name: "@keyframes", re: /@keyframes/ },
  { name: "useEffect", re: /\buseEffect\b/ },
  { name: "useLayoutEffect", re: /\buseLayoutEffect\b/ },
  { name: "useState", re: /\buseState\b/ },
  { name: "useReducer", re: /\buseReducer\b/ },
  { name: "Math.random", re: /\bMath\.random\b/ },
  { name: "Date.now", re: /\bDate\.now\b/ },
  { name: "new Date()", re: /\bnew Date\(\s*\)/ },
  { name: "performance.now", re: /\bperformance\.now\b/ },
  { name: "requestAnimationFrame", re: /\brequestAnimationFrame\b/ },
  { name: "setTimeout/setInterval", re: /\bset(Timeout|Interval)\s*\(/ },
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts") ? [p] : [];
  });
}

/** Strip comments so documentation may name what it forbids. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("seek stability lint", () => {
  const files = roots.flatMap(sources);

  it("scans both packages", () => {
    expect(files.some((f) => f.includes(`${path.sep}viz${path.sep}`))).toBe(true);
    expect(files.some((f) => f.includes(`${path.sep}compositions${path.sep}`))).toBe(true);
  });

  it("has no state, effects, CSS animation, clocks or unseeded randomness on the render path", () => {
    const hits: string[] = [];
    for (const f of files) {
      const lines = code(readFileSync(f, "utf8")).split("\n");
      lines.forEach((line, i) => {
        for (const rule of FORBIDDEN)
          if (rule.re.test(line)) hits.push(`${path.relative(process.cwd(), f)}:${i + 1} ${rule.name}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

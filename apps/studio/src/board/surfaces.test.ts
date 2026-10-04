/**
 * Source gates for the Board's own surfaces (no DOM in this test env): rules that hold across every
 * component file, read from the sources with comments stripped so a file that only TALKS about a rule
 * cannot satisfy it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const sources = (ext: string): [string, string][] =>
  readdirSync(here)
    .filter((f) => f.endsWith(ext) && !f.includes(".test."))
    .map((f) => [f, stripComments(readFileSync(join(here, f), "utf8"))]);

describe("board mutations", () => {
  it("every component that runs a Board mutation renders its failure (no silent decide / undo / restore)", () => {
    const hooks = /const (\w+) = (useDecide|useUndoDecision|useDecideCase|useUndoCase|useRestore|usePatchStyle|useSetTopic)\(\)/g;
    const silent: string[] = [];
    let seen = 0;
    for (const [file, src] of sources(".tsx")) {
      for (const m of src.matchAll(hooks)) {
        seen++;
        if (!src.includes(`${m[1]}.isError`)) silent.push(`${file}: ${m[1]} = ${m[2]}()`);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(9);
    expect(silent).toEqual([]);
  });
});

describe("decision keys", () => {
  it("every single-letter decision handler goes through plainPress (no auto-repeat, no modifier)", () => {
    const handlers = sources(".tsx").filter(([, src]) => /\b(decisionForKey|caseDecisionForKey)\(/.test(src));
    expect(handlers.map(([f]) => f).sort()).toEqual(["CasesView.tsx", "WallVariant.tsx", "shared.tsx"]);
    expect(handlers.filter(([, src]) => !src.includes("plainPress(")).map(([f]) => f)).toEqual([]);
  });
});

const css = (): [string, string][] => sources(".css");
/** `selector { body }` pairs of a stylesheet (comments already stripped; nested @media blocks keep their inner rules). */
const rules = (src: string): { sel: string; body: string }[] =>
  [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: (m[1] ?? "").trim(), body: m[2] ?? "" }));

describe("board stylesheets", () => {
  it("never paints text in --color-signal (a 3:1 stroke token); text in the signal hue is --color-brand", () => {
    const hits = css().flatMap(([f, src]) =>
      rules(src)
        .filter((r) => /(^|[;\s])color:\s*var\(--color-signal\)/.test(r.body))
        .map((r) => `${f} ${r.sel}`),
    );
    expect(hits).toEqual([]);
  });

  it("sets no text below the --text-xs floor (12px: nothing a user must read is smaller)", () => {
    const small = css().flatMap(([f, src]) =>
      rules(src).flatMap((r) =>
        [...r.body.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)]
          .filter((m) => Number(m[1]) < 12)
          .map((m) => `${f} ${r.sel} ${m[1]}px`),
      ),
    );
    expect(small).toEqual([]);
  });
});

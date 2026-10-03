import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fontFamilies, identColors } from "./index";

/**
 * Parity gate between the CSS tokens (the source of truth, ADR 009) and their hand copies in
 * index.ts, plus a zero-reference gate so a token cannot sit unused. The studio duration tokens
 * (--motion-*) have no TS twin: the old `motion` export disagreed with the CSS and had no
 * consumer anywhere in the repo, so it was deleted rather than gated.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const read = (f: string): string => readFileSync(path.join(here, f), "utf8");
const shared = read("shared.css");
const theme = read("theme-photofinish.css");

const decl = (css: string, name: string): string => {
  const m = css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"));
  if (!m?.[1]) throw new Error(`token ${name} missing`);
  return m[1].trim();
};
/** A token value as a hex, following one `var(--other)` alias (idents alias the lanes). */
const resolveHex = (name: string): string => {
  const v = decl(theme, name);
  const alias = v.match(/^var\((--[\w-]+)\)$/)?.[1];
  return (alias ? decl(theme, alias) : v).toLowerCase();
};

describe("index.ts mirrors the CSS tokens", () => {
  it("fontFamilies match --font-display / --font-ui / --font-mono", () => {
    expect(fontFamilies.display).toBe(decl(shared, "--font-display"));
    expect(fontFamilies.ui).toBe(decl(shared, "--font-ui"));
    expect(fontFamilies.data).toBe(decl(shared, "--font-mono"));
  });

  it("identColors: one entry per --ident-<id> token, same hex", () => {
    const cssIds = [...theme.matchAll(/^\s*--ident-([\w-]+):/gm)].map((m) => m[1] as string);
    expect(Object.keys(identColors).sort()).toEqual([...cssIds].sort());
    for (const id of cssIds) expect(identColors[id], id).toBe(resolveHex(`--ident-${id}`));
  });

  it("every ident aliases a distinct lane (ten idents, ten lanes)", () => {
    const aliases = [...theme.matchAll(/^\s*--ident-[\w-]+:\s*var\((--lane-\d+)\)/gm)].map((m) => m[1]);
    expect(new Set(aliases).size).toBe(Object.keys(identColors).length);
  });
});

describe("no declared token is unreferenced", () => {
  const skipDir = new Set(["node_modules", "dist", ".git"]);
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      if (skipDir.has(n)) continue;
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(css|ts|tsx)$/.test(n) && !/\.test\./.test(n)) out.push(p);
    }
    return out;
  };
  const sources = [
    ...walk(path.join(root, "apps/studio/src")),
    ...readdirSync(path.join(root, "packages")).flatMap((p) => walk(path.join(root, "packages", p, "src"))),
  ];
  // the token files themselves count only through var(--x) (a declaration is not a use)
  const own = [shared, theme].join("\n");
  const external = sources
    .filter((f) => !f.endsWith("shared.css") && !f.endsWith("theme-photofinish.css"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  // referenced by building the name at runtime: identVar() -> --ident-<id>, Sources.tsx ->
  // --licence-<class>, FrontPhotoFinish.tsx -> --lane-<n>
  const DYNAMIC = ["--ident-", "--licence-", "--lane-"];

  const names = [...new Set([...own.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1] as string))];
  it("parses the token files", () => {
    expect(names.length).toBeGreaterThan(50);
  });
  for (const n of names) {
    it(`${n} is used`, () => {
      if (DYNAMIC.some((p) => n.startsWith(p))) return;
      const used = new RegExp(`${n}(?![\\w-])`).test(external) || new RegExp(`var\\(\\s*${n}(?![\\w-])`).test(own);
      expect(used, `${n} is declared but nothing references it`).toBe(true);
    });
  }
});

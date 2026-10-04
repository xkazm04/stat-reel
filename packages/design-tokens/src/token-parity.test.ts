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
  // A comment that NAMES a token is not a use: index.ts annotates every videoTheme value with the
  // token it copies, so an unstripped scan keeps a token "used" after its last real reference goes.
  // `://` (urls) is kept; a `//` inside a string can only make a token look unused (fails loud).
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/.*$/gm, "$1");
  // the token files themselves count only through var(--x) (a declaration is not a use)
  const own = stripComments([shared, theme].join("\n"));
  const external = sources
    .filter((f) => !f.endsWith("shared.css") && !f.endsWith("theme-photofinish.css"))
    .map((f) => stripComments(readFileSync(f, "utf8")))
    .join("\n");
  const isUsed = (n: string, ext: string, decls: string): boolean =>
    new RegExp(`${n}(?![\\w-])`).test(ext) || new RegExp(`var\\(\\s*${n}(?![\\w-])`).test(decls);

  it("a token named only in comments counts as unused (seeded)", () => {
    const ext = stripComments('const a = "#56616c"; // --seeded-token, the dim ink\n/* --seeded-token again */\n');
    expect(isUsed("--seeded-token", ext, "")).toBe(false);
    expect(isUsed("--seeded-token", stripComments("color: var(--seeded-token); // why"), "")).toBe(true);
    expect(isUsed("--seeded-token", stripComments('url("https://x.test/a") var(--seeded-token)'), "")).toBe(true);
  });
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
      expect(isUsed(n, external, own), `${n} is declared but nothing references it`).toBe(true);
    });
  }
});

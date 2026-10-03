import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Font integrity gate (DESIGN.md §6.5, CLAUDE.md: OFL only, from fonts/). Three hand lists
 * describe the same faces: fonts/fonts.manifest.json (provenance), tokens.css @font-face (the
 * studio) and FONT_FACES in packages/compositions/src/fonts.ts (the render). Nothing else
 * verifies the manifest's sha256 values, so this does, and pins the three lists to each other.
 *
 * Verification stays test-only: fonts.ts is bundled into Remotion's browser bundle (no node:fs
 * there) and FONTS_USED just copies the manifest hash into the provenance record, so the
 * hash it reports is only as honest as this test keeps the manifest.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

type Entry = { family: string; file: string; license: string; license_file: string; sha256: string };
const manifest = JSON.parse(readFileSync(path.join(root, "fonts/fonts.manifest.json"), "utf8")) as { fonts: Entry[] };

const sha256 = (buf: Uint8Array): string => createHash("sha256").update(buf).digest("hex");
/** The check the manifest test runs per file; exported-by-shape so the tamper test can reuse it. */
const matches = (buf: Uint8Array, expected: string): boolean => sha256(buf) === expected;

/** (family, file) pairs from tokens.css @font-face blocks, `../../../fonts/...` normalised to `fonts/...`. */
const cssFaces = (): { family: string; file: string; weight: string }[] => {
  const css = readFileSync(path.join(here, "tokens.css"), "utf8");
  const out: { family: string; file: string; weight: string }[] = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1] ?? "";
    const family = body.match(/font-family:\s*"([^"]+)"/)?.[1];
    const weight = body.match(/font-weight:\s*([\d ]+);/)?.[1]?.trim();
    const url = body.match(/url\("\.\.\/\.\.\/\.\.\/(fonts\/[^"]+)"\)/)?.[1];
    if (!family || !weight || !url) throw new Error(`unparsed @font-face: ${body}`);
    out.push({ family, file: url, weight });
  }
  return out;
};

/** The same triples from FONT_FACES in fonts.ts (read as text: it imports remotion and woff2 assets). */
const renderFaces = (): { family: string; file: string; weight: string }[] => {
  const src = readFileSync(path.join(root, "packages/compositions/src/fonts.ts"), "utf8");
  const out = [...src.matchAll(/family:\s*"([^"]+)",\s*file:\s*"([^"]+)",\s*url:\s*\w+,\s*weight:\s*"([^"]+)"/g)].map(
    (m) => ({ family: m[1] as string, file: m[2] as string, weight: m[3] as string }),
  );
  return out;
};

describe("fonts manifest integrity", () => {
  it("lists at least one font", () => {
    expect(manifest.fonts.length).toBeGreaterThan(0);
  });

  for (const f of manifest.fonts) {
    it(`${f.file}: sha256 matches the manifest`, () => {
      expect(matches(readFileSync(path.join(root, f.file)), f.sha256)).toBe(true);
    });

    it(`${f.file}: is OFL with the licence file present`, () => {
      expect(f.license).toBe("OFL-1.1");
      expect(existsSync(path.join(root, f.license_file)), f.license_file).toBe(true);
      expect(readFileSync(path.join(root, f.license_file), "utf8")).toMatch(/SIL OPEN FONT LICENSE/i);
    });
  }

  it("a tampered copy fails the hash check (in-memory, fonts/ is never edited)", () => {
    const f = manifest.fonts[0] as Entry;
    const good = readFileSync(path.join(root, f.file));
    const bad = Buffer.from(good);
    bad[bad.length >> 1] = (bad[bad.length >> 1] ?? 0) ^ 0xff;
    expect(matches(good, f.sha256)).toBe(true);
    expect(matches(bad, f.sha256)).toBe(false);
  });

  it("every woff2 under fonts/ is in the manifest", () => {
    const found = readdirSync(path.join(root, "fonts"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(path.join(root, "fonts", d.name)).map((n) => `fonts/${d.name}/${n}`))
      .filter((f) => f.endsWith(".woff2"));
    expect(found.sort()).toEqual(manifest.fonts.map((f) => f.file).sort());
  });
});

describe("font lists agree: manifest, tokens.css @font-face, FONT_FACES", () => {
  const key = (x: { family: string; file: string }) => `${x.family}|${x.file}`;
  const manifestKeys = manifest.fonts.map(key).sort();

  it("tokens.css declares exactly the manifest faces", () => {
    expect(cssFaces().map(key).sort()).toEqual(manifestKeys);
  });

  it("FONT_FACES (the render) declares exactly the manifest faces", () => {
    expect(renderFaces().map(key).sort()).toEqual(manifestKeys);
  });

  it("weights agree between tokens.css and FONT_FACES", () => {
    const w = (xs: { file: string; weight: string }[]) => Object.fromEntries(xs.map((x) => [x.file, x.weight]));
    expect(w(renderFaces())).toEqual(w(cssFaces()));
  });
});

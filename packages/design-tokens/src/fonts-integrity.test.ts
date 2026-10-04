import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
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

/**
 * The manifest's per-face claims read back from the binaries (DESIGN.md §6.5 "CI check rejects faces
 * without tnum"; M0 "manifest + tnum check"). Without this, `tnum`, `monospace`, `version` and the
 * @font-face weights are hand-typed promises: a re-subset that drops the tnum feature or a weight
 * range wider than the font's wght axis would pass every other gate. Minimal WOFF2 reader (Brotli via
 * node:zlib), the same container walk scripts/font-metrics.mjs does for advances; only untransformed
 * tables (name, OS/2, post, GSUB, fvar) are read.
 */
const WOFF2_TAGS = (
  "cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH " +
  "PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc " +
  "bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill"
)
  .split(" ")
  .map((t) => t.replace("_", " "));

const woff2Tables = (buf: Buffer): Map<string, Buffer> => {
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("not WOFF2");
  const n = buf.readUInt16BE(12);
  const compSize = buf.readUInt32BE(20);
  let p = 48;
  const base128 = (): number => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const c = buf[p++] ?? 0;
      v = v * 128 + (c & 127);
      if (!(c & 128)) break;
    }
    return v;
  };
  const dir: { tag: string; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const flags = buf[p++] ?? 0;
    let tag = WOFF2_TAGS[flags & 63] ?? "";
    if ((flags & 63) === 63) {
      tag = buf.toString("latin1", p, p + 4);
      p += 4;
    }
    const version = flags >> 6;
    const orig = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    dir.push({ tag, len: transformed ? base128() : orig });
  }
  const raw = zlib.brotliDecompressSync(buf.subarray(p, p + compSize));
  const out = new Map<string, Buffer>();
  let o = 0;
  for (const d of dir) {
    out.set(d.tag, raw.subarray(o, o + d.len));
    o += d.len;
  }
  return out;
};

type FaceFacts = { family: string; copyright: string; version: string; tnum: boolean; monospace: boolean; weight: string };
const faceFacts = (file: string): FaceFacts => {
  const t = woff2Tables(readFileSync(path.join(root, file)));
  const name = t.get("name") as Buffer;
  const nameStr = (id: number): string => {
    const count = name.readUInt16BE(2);
    const strings = name.readUInt16BE(4);
    for (let i = 0; i < count; i++) {
      const r = 6 + i * 12;
      if (name.readUInt16BE(r) !== 3 || name.readUInt16BE(r + 6) !== id) continue;
      const s = name.subarray(strings + name.readUInt16BE(r + 10), strings + name.readUInt16BE(r + 10) + name.readUInt16BE(r + 8));
      return String.fromCharCode(...Array.from({ length: s.length / 2 }, (_, k) => s.readUInt16BE(k * 2)));
    }
    return "";
  };
  const gsub = t.get("GSUB");
  const features = new Set<string>();
  if (gsub) {
    const list = gsub.readUInt16BE(6);
    for (let i = 0; i < gsub.readUInt16BE(list); i++) features.add(gsub.toString("latin1", list + 2 + i * 6, list + 6 + i * 6));
  }
  let weight = String((t.get("OS/2") as Buffer).readUInt16BE(4));
  const fvar = t.get("fvar");
  if (fvar) {
    const axes = fvar.readUInt16BE(4);
    for (let i = 0; i < fvar.readUInt16BE(8); i++) {
      const a = axes + i * fvar.readUInt16BE(10);
      if (fvar.toString("latin1", a, a + 4) === "wght")
        weight = `${fvar.readInt32BE(a + 4) / 65536} ${fvar.readInt32BE(a + 12) / 65536}`;
    }
  }
  return {
    family: nameStr(1),
    copyright: nameStr(0),
    version: nameStr(5),
    tnum: features.has("tnum"),
    monospace: (t.get("post") as Buffer).readUInt32BE(12) !== 0,
    weight,
  };
};

type Claim = Entry & { version: string; source_url: string; tnum: boolean; monospace: boolean; numeric_ok: boolean };
/** Every way a manifest entry (and its @font-face weight) disagrees with the binary; empty = honest. */
const claimMismatches = (c: Claim, f: FaceFacts, cssWeight: string | undefined): string[] => {
  const out: string[] = [];
  if (!f.family.startsWith(c.family)) out.push(`family: binary "${f.family}" vs manifest "${c.family}"`);
  if (!f.copyright.includes(c.source_url)) out.push(`source_url ${c.source_url} not in the binary copyright "${f.copyright}"`);
  if (f.version !== c.version) out.push(`version: binary "${f.version}" vs manifest "${c.version}"`);
  if (f.tnum !== c.tnum) out.push(`tnum: binary ${f.tnum} vs manifest ${c.tnum}`);
  if (f.monospace !== c.monospace) out.push(`monospace: binary ${f.monospace} vs manifest ${c.monospace}`);
  if (c.numeric_ok && !f.tnum && !f.monospace) out.push("numeric_ok, but the face has neither tnum nor fixed-pitch figures");
  if (cssWeight !== f.weight) out.push(`weight: tokens.css "${cssWeight}" vs binary "${f.weight}"`);
  return out;
};

describe("manifest claims match the font binaries", () => {
  const css = Object.fromEntries(cssFaces().map((x) => [x.file, x.weight]));
  for (const c of manifest.fonts as Claim[]) {
    it(`${c.file}: family, source, version, tnum, monospace and weight are what the file says`, () => {
      expect(claimMismatches(c, faceFacts(c.file), css[c.file])).toEqual([]);
    });
  }

  it("a false claim is caught (seeded: tnum, version, weight and numeric_ok flipped in memory)", () => {
    const c = (manifest.fonts as Claim[]).find((x) => x.tnum) as Claim;
    const facts = faceFacts(c.file);
    const honest = claimMismatches(c, facts, css[c.file]);
    expect(honest).toEqual([]);
    expect(claimMismatches({ ...c, tnum: false }, facts, css[c.file])).toHaveLength(1);
    expect(claimMismatches({ ...c, version: "Version 0.1" }, facts, css[c.file])).toHaveLength(1);
    expect(claimMismatches(c, facts, "100 1000")).toHaveLength(1);
    expect(claimMismatches(c, { ...facts, tnum: false }, css[c.file]).join()).toMatch(/neither tnum/);
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

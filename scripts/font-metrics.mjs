#!/usr/bin/env node
/**
 * Generates packages/viz/src/font-metrics.generated.ts: per-face advance widths read from the OFL
 * font files in fonts/ (WOFF2: Brotli via node:zlib, then cmap + hmtx + HVAR). No dependency.
 *
 * Frames are laid out without DOM measurement (seek-stable, identical in Node tests), so this
 * table is what `measureText` in packages/viz/src/text.ts sums. Kerning (GPOS) is not applied:
 * it only tightens pairs, so the sum is a safe upper bound.
 *
 *   node scripts/font-metrics.mjs          write the table
 *   node scripts/font-metrics.mjs --check  exit 1 if the committed table is stale
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "packages/viz/src/font-metrics.generated.ts");

/** Faces the compositions use (fonts.manifest.json), with the CSS font-weights emitted per face. */
const FACES = [
  { key: "condensed", file: "fonts/barlow-condensed/BarlowCondensed-%W.woff2", statics: [500, 600, 700, 800] },
  { key: "ui", file: "fonts/inter/Inter-Variable.woff2", variable: [400, 500, 600, 700] },
  { key: "mono", file: "fonts/jetbrains-mono/JetBrainsMono-Variable.woff2", variable: [400, 500, 600, 700, 800] },
];
const EXTRA = [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x2212, 0x2190, 0x2191, 0x2192, 0x2193];
const CODES = [...Array.from({ length: 0xff - 0x20 + 1 }, (_, i) => 0x20 + i), ...EXTRA];

const KNOWN = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

/** WOFF2 container -> { tag: { data, transformed } } of the decoded tables (glyf/loca stay transformed; unused here). */
function readWoff2(buf) {
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("not WOFF2");
  const n = buf.readUInt16BE(12);
  const compSize = buf.readUInt32BE(20);
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const c = buf[p++];
      v = v * 128 + (c & 127);
      if (!(c & 128)) break;
    }
    return v;
  };
  const dir = [];
  for (let i = 0; i < n; i++) {
    const flags = buf[p++];
    let tag;
    if ((flags & 63) === 63) {
      tag = buf.toString("latin1", p, p + 4);
      p += 4;
    } else tag = KNOWN[flags & 63];
    const version = flags >> 6;
    const origLen = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    const len = transformed ? base128() : origLen;
    dir.push({ tag, transformed, len });
  }
  const raw = zlib.brotliDecompressSync(buf.subarray(p, p + compSize));
  const tables = {};
  let o = 0;
  for (const d of dir) {
    tables[d.tag] = { data: raw.subarray(o, o + d.len), transformed: d.transformed };
    o += d.len;
  }
  return tables;
}

/** codepoint -> glyph id, from a format 4 or 12 cmap subtable. */
function cmapLookup(cmap) {
  const n = cmap.readUInt16BE(2);
  let best = null;
  for (let i = 0; i < n; i++) {
    const pid = cmap.readUInt16BE(4 + i * 8);
    const eid = cmap.readUInt16BE(6 + i * 8);
    const off = cmap.readUInt32BE(8 + i * 8);
    const fmt = cmap.readUInt16BE(off);
    const ok = (fmt === 12 && (pid === 0 || (pid === 3 && eid === 10))) || (fmt === 4 && (pid === 0 || (pid === 3 && eid === 1)));
    if (ok && (!best || fmt === 12)) best = { off, fmt };
  }
  if (!best) throw new Error("no usable cmap subtable");
  const { off, fmt } = best;
  if (fmt === 12) {
    const groups = cmap.readUInt32BE(off + 12);
    return (cp) => {
      for (let g = 0; g < groups; g++) {
        const s = cmap.readUInt32BE(off + 16 + g * 12);
        const e = cmap.readUInt32BE(off + 20 + g * 12);
        if (cp >= s && cp <= e) return cmap.readUInt32BE(off + 24 + g * 12) + cp - s;
      }
      return 0;
    };
  }
  const segX2 = cmap.readUInt16BE(off + 6);
  const endO = off + 14;
  const startO = endO + segX2 + 2;
  const deltaO = startO + segX2;
  const rangeO = deltaO + segX2;
  return (cp) => {
    for (let s = 0; s < segX2; s += 2) {
      if (cp > cmap.readUInt16BE(endO + s)) continue;
      const start = cmap.readUInt16BE(startO + s);
      if (cp < start) return 0;
      const delta = cmap.readInt16BE(deltaO + s);
      const ro = cmap.readUInt16BE(rangeO + s);
      if (ro === 0) return (cp + delta) & 0xffff;
      const g = cmap.readUInt16BE(rangeO + s + ro + (cp - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
}

/** Default-instance advance of every glyph (hmtx may be WOFF2-transformed: lsb arrays dropped, advances kept). */
function baseAdvances(t) {
  const nHM = t.hhea.data.readUInt16BE(34);
  const nGlyphs = t.maxp.data.readUInt16BE(4);
  const hm = t.hmtx.data;
  const adv = new Array(nGlyphs);
  // transformed hmtx: 1 flag byte, then advanceWidth[numHMetrics] as u16
  for (let g = 0; g < nHM; g++) adv[g] = hm.readUInt16BE(t.hmtx.transformed ? 1 + g * 2 : g * 4);
  for (let g = nHM; g < nGlyphs; g++) adv[g] = adv[nHM - 1];
  return adv;
}

/** The wght axis of a variable font: its index, and the user value normalised (incl. avar) to [-1, 1]. */
function wghtCoord(t, wght) {
  const fv = t.fvar.data;
  const axesOff = fv.readUInt16BE(4);
  const count = fv.readUInt16BE(8);
  const size = fv.readUInt16BE(10);
  let idx = -1;
  let min = 0;
  let def = 0;
  let max = 0;
  for (let i = 0; i < count; i++) {
    const o = axesOff + i * size;
    if (fv.toString("latin1", o, o + 4) === "wght") {
      idx = i;
      min = fv.readInt32BE(o + 4) / 65536;
      def = fv.readInt32BE(o + 8) / 65536;
      max = fv.readInt32BE(o + 12) / 65536;
    }
  }
  if (idx < 0) throw new Error("no wght axis");
  const v = Math.min(max, Math.max(min, wght));
  let nv = v === def ? 0 : v < def ? (v - def) / (def - min) : (v - def) / (max - def);
  const av = t.avar?.data;
  if (av) {
    let p = 8;
    for (let a = 0; a < count; a++) {
      const pairs = av.readUInt16BE(p);
      p += 2;
      if (a === idx) {
        const m = [];
        for (let k = 0; k < pairs; k++) m.push([av.readInt16BE(p + k * 4) / 16384, av.readInt16BE(p + k * 4 + 2) / 16384]);
        for (let k = 1; k < m.length; k++) {
          if (nv <= m[k][0]) {
            const [f0, t0] = m[k - 1];
            const [f1, t1] = m[k];
            nv = f1 === f0 ? t1 : t0 + ((nv - f0) * (t1 - t0)) / (f1 - f0);
            break;
          }
        }
      }
      p += pairs * 4;
    }
  }
  return { nv, idx, axisCount: count };
}

/** Advance-width deltas of every glyph from HVAR at coordinate `nv` on axis `axis` (others at default). */
function hvarDeltas(t, nv, axis, axisCount, nGlyphs) {
  const h = t.HVAR.data;
  const storeOff = h.readUInt32BE(4);
  const mapOff = h.readUInt32BE(8);
  const s = h.subarray(storeOff);
  const regionListOff = s.readUInt32BE(2);
  const dataCount = s.readUInt16BE(6);
  const regionCount = s.readUInt16BE(regionListOff + 2);
  const scalars = [];
  for (let r = 0; r < regionCount; r++) {
    let sc = 1;
    for (let a = 0; a < axisCount; a++) {
      const o = regionListOff + 4 + (r * axisCount + a) * 6;
      const st = s.readInt16BE(o) / 16384;
      const pk = s.readInt16BE(o + 2) / 16384;
      const en = s.readInt16BE(o + 4) / 16384;
      const c = a === axis ? nv : 0;
      let f;
      if (pk === 0 || st > pk || pk > en || (st < 0 && en > 0)) f = 1;
      else if (c < st || c > en) f = 0;
      else if (c === pk) f = 1;
      else f = c < pk ? (c - st) / (pk - st) : (en - c) / (en - pk);
      sc *= f;
    }
    scalars.push(sc);
  }
  const datas = [];
  for (let d = 0; d < dataCount; d++) {
    const o = s.readUInt32BE(8 + d * 4);
    const shorts = s.readUInt16BE(o + 2);
    const rc = s.readUInt16BE(o + 4);
    const regs = Array.from({ length: rc }, (_, i) => s.readUInt16BE(o + 6 + i * 2));
    datas.push({ o: o + 6 + rc * 2, shorts, rc, regs });
  }
  const deltaAt = (outer, inner) => {
    const d = datas[outer];
    const rowSize = d.shorts * 2 + (d.rc - d.shorts);
    let p = d.o + inner * rowSize;
    let sum = 0;
    for (let k = 0; k < d.rc; k++) {
      let v;
      if (k < d.shorts) {
        v = s.readInt16BE(p);
        p += 2;
      } else {
        v = s.readInt8(p);
        p += 1;
      }
      sum += v * scalars[d.regs[k]];
    }
    return sum;
  };
  const out = new Array(nGlyphs).fill(0);
  if (!mapOff) {
    for (let g = 0; g < nGlyphs; g++) out[g] = deltaAt(0, g);
    return out;
  }
  // DeltaSetIndexMap format 0: u8 format, u8 entryFormat, u16 mapCount, entries
  const m = h.subarray(mapOff);
  const entryFormat = m[1];
  const innerBits = (entryFormat & 0xf) + 1;
  const entrySize = ((entryFormat & 0x30) >> 4) + 1;
  const count = m.readUInt16BE(2);
  for (let g = 0; g < nGlyphs; g++) {
    const i = Math.min(g, count - 1);
    let e = 0;
    for (let b = 0; b < entrySize; b++) e = e * 256 + m[4 + i * entrySize + b];
    out[g] = deltaAt(Math.floor(e / 2 ** innerBits), e % 2 ** innerBits);
  }
  return out;
}

function widthsFor(file, weight, variable) {
  const t = readWoff2(fs.readFileSync(path.join(root, file)));
  const upm = t.head.data.readUInt16BE(18);
  const adv = baseAdvances(t);
  const lookup = cmapLookup(t.cmap.data);
  let deltas = null;
  if (variable) {
    const { nv, idx, axisCount } = wghtCoord(t, weight);
    deltas = hvarDeltas(t, nv, idx, axisCount, adv.length);
  }
  return CODES.map((cp) => {
    const g = lookup(cp);
    if (g === 0) return 0;
    return Math.round((((adv[g] ?? 0) + (deltas?.[g] ?? 0)) * 1000) / upm);
  });
}

const tables = {};
for (const f of FACES) {
  if (f.statics) for (const w of f.statics) tables[`${f.key}-${w}`] = widthsFor(f.file.replace("%W", String(w)), w, false);
  else for (const w of f.variable) tables[`${f.key}-${w}`] = widthsFor(f.file, w, true);
}

const lines = [
  "/**",
  " * GENERATED by scripts/font-metrics.mjs from the OFL fonts in fonts/ - do not edit.",
  " * Advance widths in 1/1000 em, no kerning, as comma-separated rows indexed like `FONT_METRIC_CODES_CSV`;",
  " * 0 = glyph missing from the face. Parsed once by font-metrics.ts (strings keep the file formatter-stable).",
  " */",
  // long strings sit on their own line, the way the repo formatter (Biome) lays them out
  `export const FONT_METRIC_CODES_CSV =
  "${CODES.join(",")}";`,
  "export const FONT_ADVANCES_CSV: Readonly<Record<string, string>> = {",
  ...Object.entries(tables).map(([k, v]) => `  "${k}":
    "${v.join(",")}",`),
  "};",
];
const text = `${lines.join("\n")}\n`;
if (process.argv.includes("--check")) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (cur !== text) {
    console.error("font-metrics.generated.ts is stale: run node scripts/font-metrics.mjs");
    process.exit(1);
  }
  console.log("font metrics up to date");
} else {
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(root, OUT)} (${Object.keys(tables).length} faces x ${CODES.length} glyphs)`);
}

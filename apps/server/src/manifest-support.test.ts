import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./config";
import { compositionBase, manifestBuildInfo, referencedAudioFiles } from "./manifest-support";
import { FONTS_REPORT_PREFIX, parseFontsReport } from "./render-support";

const report = (o: object) => `${FONTS_REPORT_PREFIX}${JSON.stringify(o)}`;

describe("parseFontsReport (checks.font_fallbacks is measured, not a literal)", () => {
  it("counts failed faces and families the document does not report as loaded", () => {
    expect(parseFontsReport([report({ loaded: ["Inter 100 900"], failed: [], check: { Inter: true, "JetBrains Mono": true } })])).toEqual({ measured: true, fallbacks: 0 });
    expect(parseFontsReport([report({ loaded: [], failed: ["Inter 100 900"], check: { Inter: false, "JetBrains Mono": true } })])).toEqual({ measured: true, fallbacks: 2 });
    expect(parseFontsReport([report({ failed: [], check: { Inter: false } })])).toEqual({ measured: true, fallbacks: 1 });
  });

  it("takes the worst report when several pages logged one", () => {
    const ok = report({ failed: [], check: { Inter: true } });
    const bad = report({ failed: [], check: { Inter: false } });
    expect(parseFontsReport([ok, bad, ok])).toEqual({ measured: true, fallbacks: 1 });
  });

  it("no usable report means unmeasured, never zero", () => {
    for (const logs of [undefined, [], ["unrelated log"], [`${FONTS_REPORT_PREFIX}{not json`], [report({ nothing: true })]]) {
      expect(parseFontsReport(logs)).toEqual({ measured: false, fallbacks: 0 });
    }
  });

  it("uses the same prefix the composition logs", () => {
    const src = readFileSync(path.join(repoRoot, "packages", "compositions", "src", "fonts.ts"), "utf8");
    expect(src).toContain(`FONTS_REPORT_PREFIX = "${FONTS_REPORT_PREFIX}"`);
    const worker = readFileSync(path.join(repoRoot, "apps", "server", "src", "render-worker.mjs"), "utf8");
    expect(worker).toContain(`FONTS_PREFIX = "${FONTS_REPORT_PREFIX}"`);
  });
});

describe("manifestBuildInfo", () => {
  it("derives composition, renderer and views from the package versions", () => {
    const root = mkdtempSync(path.join(tmpdir(), "statreel-manifest-"));
    mkdirSync(path.join(root, "packages", "compositions"), { recursive: true });
    writeFileSync(path.join(root, "packages", "compositions", "package.json"), JSON.stringify({ version: "0.7.3", dependencies: { remotion: "4.1.2" } }));
    expect(manifestBuildInfo("EraAdjustedSlope-landscape", root)).toEqual({
      composition: "EraAdjustedSlope@0.7.3", renderer: "remotion@4.1.2",
      views: ["f1_driver_era_adjusted"], models: ["mart_era_adjusted", "f1_driver_era_adjusted"],
    });
  });

  it("matches the repo's real packages and refuses a composition with no declared views", () => {
    expect(manifestBuildInfo("EraAdjustedSlope-vertical", repoRoot).composition).toMatch(/^EraAdjustedSlope@\d+\.\d+\.\d+$/);
    expect(() => manifestBuildInfo("Mystery-vertical", repoRoot)).toThrow("no declared data views");
    expect(compositionBase("EraAdjustedSlope-vertical")).toBe("EraAdjustedSlope");
  });
});

describe("referencedAudioFiles", () => {
  it("lists the voice and music files the timing plays, once each", () => {
    const base = "http://127.0.0.1:8787/files/audio/p1";
    expect(referencedAudioFiles({
      scenes: [{ scene_id: "a", start_s: 0, end_s: 1, voice_src: `${base}/k1.mp3` }, { scene_id: "b", start_s: 1, end_s: 2 }],
      music: [{ src: `${base}/k2.mp3`, start_s: 0, end_s: 2, gain_db: -18 }, { src: `${base}/k2.mp3`, start_s: 0, end_s: 2, gain_db: -18 }],
    })).toEqual(["k1.mp3", "k2.mp3"]);
    expect(referencedAudioFiles(undefined)).toEqual([]);
  });
});

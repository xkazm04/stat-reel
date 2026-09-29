#!/usr/bin/env node
/**
 * Smoke render: bundle src/entry.ts and write PNG stills of EraAdjustedSlope.
 *
 *   .tools/node-x64/node.exe packages/compositions/scripts/smoke.mjs <outDir>
 *
 * Runs under x64 Node on Windows-on-ARM (ADR 004). @remotion/bundler and @remotion/renderer are
 * resolved from apps/server/node_modules. Writes:
 *   vertical-t00.1.png, vertical-t10.png, vertical-t30.png, vertical-t55.png  (sampleEraProps)
 *   + context / payoff / captions+safe-zone / landscape stills for review.
 * Prints the fonts the page reports as loaded; exits non-zero if a required family is missing.
 */
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const repoRoot = path.resolve(pkgDir, "..", "..");
if (!process.argv[2]) {
  console.error("usage: node packages/compositions/scripts/smoke.mjs <outDir> [nameFilterRegex]");
  process.exit(2);
}
const outDir = path.resolve(process.argv[2]);
mkdirSync(outDir, { recursive: true });

const requireFromServer = createRequire(path.join(repoRoot, "apps", "server", "package.json"));
const { bundle } = requireFromServer("@remotion/bundler");
const { openBrowser, renderStill, selectComposition } = requireFromServer("@remotion/renderer");

// sampleEraProps, duplicated from @statreel/schemas fixtures (this script runs as plain JS, no TS loader)
const k = (id, col) => `f1db:driver:${id}:era-adjusted#${col}`;
const row = (id, name, rr, ar, rv, av) => ({
  player_id: id,
  name,
  raw_rank: rr,
  adjusted_rank: ar,
  raw_value: rv,
  adjusted_value: av,
  raw_rank_fact_key: k(id, "rank_raw"),
  adjusted_rank_fact_key: k(id, "rank_adjusted"),
  raw_fact_key: k(id, "points_awarded"),
  adjusted_fact_key: k(id, "points_per_start_current_system"),
});
const sampleEraProps = {
  format: "vertical",
  hook_shape: "contradiction",
  title: "Most points ≠ most dominant",
  metric_raw_label: "Career points (as awarded)",
  metric_adjusted_label: "Points per start (today's system)",
  rows: [
    row("juan-manuel-fangio", "Juan Manuel Fangio", 43, 1, 277.64, 17.118),
    row("alberto-ascari", "Alberto Ascari", 73, 2, 140.14, 14.29),
    row("max-verstappen", "Max Verstappen", 2, 3, 3452.5, 13.859),
    row("lewis-hamilton", "Lewis Hamilton", 1, 4, 5134.5, 13.846),
    row("michael-schumacher", "Michael Schumacher", 10, 6, 1566, 12.712),
    row("ayrton-senna", "Ayrton Senna", 22, 8, 614, 11.683),
  ],
  highlight_player_id: "juan-manuel-fangio",
  scenes: [
    { id: "hook", kind: "hook", on_screen: "Most points ≠ most dominant", focus: [] },
    {
      id: "context",
      kind: "context",
      on_screen: "Career points, as awarded",
      focus: ["lewis-hamilton", "max-verstappen"],
    },
    { id: "reveal", kind: "reveal", on_screen: "Re-scored per start", focus: ["juan-manuel-fangio"] },
    { id: "payoff", kind: "payoff", on_screen: "43rd → 1st", focus: ["juan-manuel-fangio"] },
    { id: "close", kind: "close", on_screen: "Most points, or most dominant?", focus: [] },
  ],
  attribution: "Data: F1DB (CC BY 4.0)",
  method_note: "Era-adjusted: every race re-scored with today's points, per start. Indy 500 excluded.",
  show_safe_zone: false,
};

/** A synthetic timeline with one caption cue around each probe time (no audio sources). */
function captionTimeline(times) {
  const lines = {
    0.1: ["Most points is not", "most dominant."],
    10: ["Points tables grew", "since the fifties."],
    16: ["Hamilton leads", "the raw table."],
    30: ["Re-score every race", "with today's points."],
    40: ["Fangio jumps from", "43rd to first."],
    55: ["Most points,", "or most dominant?"],
  };
  const cues = times.map((t) => {
    const ls = lines[t] ?? ["Caption probe"];
    const start = Math.max(0, t - 1);
    const end = start + 2.4;
    const words = ls.flatMap((l) => l.split(" "));
    const step = (end - start) / words.length;
    return {
      start_s: start,
      end_s: end,
      lines: ls,
      words: words.map((w, i) => ({
        scene_id: "s",
        display: w,
        spoken: w,
        start_s: start + i * step,
        end_s: start + (i + 1) * step,
      })),
    };
  });
  const n = sampleEraProps.scenes.length;
  return {
    duration_s: 58,
    scenes: sampleEraProps.scenes.map((s, i) => ({
      scene_id: s.id,
      start_s: (58 * i) / n,
      end_s: (58 * (i + 1)) / n,
    })),
    words: [],
    cues,
    music: [],
    voice_lead_s: 0,
  };
}

const probes = [
  { name: "vertical-t00.1", id: "EraAdjustedSlope-vertical", t: 0.1, props: sampleEraProps },
  { name: "vertical-t10", id: "EraAdjustedSlope-vertical", t: 10, props: sampleEraProps },
  { name: "vertical-t30", id: "EraAdjustedSlope-vertical", t: 30, props: sampleEraProps },
  { name: "vertical-t55", id: "EraAdjustedSlope-vertical", t: 55, props: sampleEraProps },
  { name: "vertical-t16-context", id: "EraAdjustedSlope-vertical", t: 16, props: sampleEraProps },
  { name: "vertical-t34-reveal-end", id: "EraAdjustedSlope-vertical", t: 34, props: sampleEraProps },
  { name: "vertical-t40-payoff", id: "EraAdjustedSlope-vertical", t: 40, props: sampleEraProps },
  {
    name: "vertical-t40-captions-safezone",
    id: "EraAdjustedSlope-vertical",
    t: 40,
    props: { ...sampleEraProps, show_safe_zone: true, timing: captionTimeline([0.1, 10, 16, 30, 40, 55]) },
  },
  {
    name: "vertical-t30-captions-safezone",
    id: "EraAdjustedSlope-vertical",
    t: 30,
    props: { ...sampleEraProps, show_safe_zone: true, timing: captionTimeline([0.1, 10, 16, 30, 40, 55]) },
  },
  {
    name: "vertical-t00.1-captions-safezone",
    id: "EraAdjustedSlope-vertical",
    t: 0.1,
    props: { ...sampleEraProps, show_safe_zone: true, timing: captionTimeline([0.1, 10, 16, 30, 40, 55]) },
  },
  {
    name: "landscape-t00.1",
    id: "EraAdjustedSlope-landscape",
    t: 0.1,
    props: { ...sampleEraProps, format: "landscape" },
  },
  { name: "landscape-t30", id: "EraAdjustedSlope-landscape", t: 30, props: { ...sampleEraProps, format: "landscape" } },
  {
    name: "landscape-t40-captions-safezone",
    id: "EraAdjustedSlope-landscape",
    t: 40,
    props: {
      ...sampleEraProps,
      format: "landscape",
      show_safe_zone: true,
      timing: captionTimeline([0.1, 10, 16, 30, 40, 55]),
    },
  },
];

const only = process.argv[3] ? new RegExp(process.argv[3]) : null;

// reuse the Chrome Headless Shell apps/server already downloaded (ADR 004 spike) instead of a second copy
const serverChrome = path.join(
  repoRoot,
  "apps/server/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe",
);
const browserExecutable = process.env.REMOTION_BROWSER ?? (existsSync(serverChrome) ? serverChrome : null);

const t0 = Date.now();
console.log(`bundling ${path.join(pkgDir, "src", "entry.ts")} ...`);
const serveUrl = await bundle({
  entryPoint: path.join(pkgDir, "src", "entry.ts"),
  webpackOverride: (c) => c,
});
console.log(`bundled in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${serveUrl}`);

const required = ["Barlow Condensed", "Inter", "JetBrains Mono"];
// one browser for every still (a cold Chrome per still costs ~10 s under x64 emulation)
const puppeteerInstance = await openBrowser("chrome", { browserExecutable, logLevel: "error" });
const problems = [];
for (const p of probes) {
  if (only && !only.test(p.name)) continue;
  const composition = await selectComposition({
    serveUrl,
    id: p.id,
    inputProps: p.props,
    puppeteerInstance,
    logLevel: "error",
  });
  const frame = Math.min(composition.durationInFrames - 1, Math.round(p.t * composition.fps));
  const output = path.join(outDir, `${p.name}.png`);
  const logs = [];
  await renderStill({
    serveUrl,
    composition,
    inputProps: p.props,
    frame,
    output,
    imageFormat: "png",
    onBrowserLog: (l) => logs.push(l.text),
    puppeteerInstance,
    logLevel: "error",
  });
  console.log(`${p.name}: frame ${frame}/${composition.durationInFrames} -> ${output}`);
  // fonts.ts logs "[statreel-fonts] {json}" once every face has loaded
  const fontLog = logs.find((l) => l.startsWith("[statreel-fonts]"));
  if (!fontLog) {
    problems.push(`${p.name}: no font report in the browser log`);
  } else {
    const report = JSON.parse(fontLog.slice("[statreel-fonts]".length));
    const missing = required.filter((f) => !report.check[f]);
    if (report.failed.length || missing.length)
      problems.push(`${p.name}: fonts failed=${report.failed} missing=${missing}`);
    else console.log(`  fonts ok: ${report.loaded.join(", ")}`);
  }
  for (const l of logs.filter((x) => !x.startsWith("[statreel-fonts]"))) console.log(`  [browser] ${l}`);
}

await puppeteerInstance.close({ silent: true });
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

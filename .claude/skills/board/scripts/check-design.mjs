// One design, checked the way harvest checks it. Seats run it from their workspace through the
// staged `data/check.mjs` wrapper (`node data/check.mjs variant-1`); harvest --strict calls inspect().
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assessClockLabels, assessFrameFacts, assessLongevity, checkImages, dataReadySports, dataReadyUseCases, FORMATS, longevitySamples, resolveFacts, stabilityProbe, stagedSeasonRange, validateDesign } from "./lib.mjs";

/** Owner rule (2026-10-01): nothing on screen is small. Every readable text is >= 28 px in the artboard. */
export const MIN_TEXT_PX = 28;
const LINE_TO_EM = 1.21; // rendered line box / font-size for the staged faces (measured: Barlow, Inter 1.21; JetBrains 1.32)

// Canvas text has no DOM: record each fillText/strokeText with its effective size in artboard px.
const CANVAS_PROBE = `(() => {
  window.__textLog = [];
  const P = CanvasRenderingContext2D.prototype;
  for (const fn of ["fillText", "strokeText"]) {
    const orig = P[fn];
    P[fn] = function (text, ...rest) {
      try {
        const px = parseFloat((this.font.match(/([\\d.]+)px/) || [])[1] || "10");
        const m = this.getTransform();
        const c = this.canvas;
        const css = c.getBoundingClientRect ? c.getBoundingClientRect().height / (c.height || 1) : 1;
        if (this.globalAlpha > 0.15) window.__textLog.push({ text: String(text).slice(0, 24), px: px * Math.hypot(m.c, m.d) * css });
      } catch {}
      return orig.call(this, text, ...rest);
    };
  }
})();`;

/** Readable text drawn at the current frame, with its effective size in artboard px. */
const MEASURE_TEXT = (lineToEm) => {
  const out = (window.__textLog || []).filter((x) => /[A-Za-z0-9]/.test(x.text));
  window.__textLog = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const W = innerWidth, H = innerHeight;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.trim();
    if (!/[A-Za-z0-9]/.test(text)) continue;
    const el = n.parentElement;
    if (!el || (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))) continue;
    let o = 1;
    for (let a = el; a; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity || "1");
    if (o < 0.15) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    for (const rc of r.getClientRects()) {
      if (rc.width < 1 || rc.height < 1 || rc.right < 0 || rc.bottom < 0 || rc.left > W || rc.top > H) continue;
      out.push({ text: text.slice(0, 24), px: rc.height / lineToEm });
      break;
    }
  }
  return out;
};

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const tableCache = new Map();

function loadData(dataDir) {
  if (!tableCache.has(dataDir)) {
    const tables = {};
    for (const f of readdirSync(dataDir).filter((f) => f.startsWith("f1_") && f.endsWith(".json"))) tables[f.slice(0, -5)] = JSON.parse(readFileSync(path.join(dataDir, f), "utf8"));
    // only cases the staged (F1) data can make; a Soccer-only format is not a valid target
    const all = JSON.parse(readFileSync(path.join(dataDir, "usecases.json"), "utf8"));
    tableCache.set(dataDir, { tables, useCases: dataReadyUseCases(all).map((u) => u.id), sports: dataReadySports(all), period: stagedSeasonRange(tables) });
  }
  return tableCache.get(dataDir);
}

export async function launch() {
  const { chromium } = createRequire(path.join(REPO, "package.json"))("@playwright/test");
  return chromium.launch({ channel: process.env.BOARD_BROWSER_CHANNEL ?? "chrome" });
}

/**
 * Everything harvest would reject or flag: shot.json contract, fact refs, network use, page errors,
 * the statreel API, duration agreement, longevity across the run, seek stability.
 * Returns { ok, errors[], meta, longevity, facts }.
 */
export async function inspect(variantDir, dataDir, { browser, useCases, sports } = {}) {
  variantDir = path.resolve(variantDir);
  dataDir = path.resolve(dataDir);
  const errors = [];
  const metaFile = path.join(variantDir, "shot.json");
  let meta = null;
  try {
    meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : null;
  } catch (e) {
    return { ok: false, errors: [`shot.json is not valid JSON: ${e.message}`], meta: null };
  }
  const data = loadData(dataDir);
  errors.push(...validateDesign(meta, { useCases: useCases ?? data.useCases, sports: sports ?? data.sports, period: data.period }));
  if (!meta || errors.length) return { ok: false, errors, meta };
  const facts = resolveFacts(meta.facts, data.tables);
  if (facts.cited === 0) errors.push("facts is empty: cite every figure an annotation states as <fact_key>#<column>");
  if (facts.unresolved.length) errors.push(`${facts.unresolved.length} fact ref(s) do not exist in data/: ${facts.unresolved.slice(0, 3).join(", ")}`);
  // generated images: every image file listed with prompt + role, text-banned, small (lib.checkImages)
  const imageFiles = {};
  const walk = (dir, rel = "") => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${f.name}` : f.name;
      if (f.isDirectory()) walk(path.join(dir, f.name), r);
      else if (/\.(png|jpe?g|webp|avif|gif)$/i.test(f.name)) imageFiles[r] = statSync(path.join(dir, f.name)).size;
    }
  };
  walk(variantDir);
  errors.push(...checkImages(meta.images, imageFiles));
  const html = path.join(variantDir, "index.html");
  if (!existsSync(html)) return { ok: false, errors: [...errors, "index.html is missing"], meta, facts };
  for (const f of readdirSync(variantDir).filter((f) => /\.(html|js|css)$/.test(f))) {
    const src = readFileSync(path.join(variantDir, f), "utf8");
    if (/(src|href)\s*=\s*["']https?:|@import\s+url\(["']?https?:|fetch\(\s*["']https?:/i.test(src)) errors.push(`${f} loads something from the network`);
    if (/Date\.now\(\)|performance\.now\(\)/.test(src) && !/capture/.test(src)) errors.push(`${f} reads the wall clock but never checks ?capture=1`);
  }
  const [w, h] = FORMATS[meta.format];
  const own = !browser;
  browser ??= await launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));
  page.on("request", (r) => /^https?:/.test(r.url()) && pageErrors.push(`network request: ${r.url()}`));
  let longevity = null;
  let truth = null;
  await page.addInitScript(CANVAS_PROBE);
  try {
    const url = pathToFileURL(html);
    url.searchParams.set("capture", "1");
    await page.goto(url.href, { waitUntil: "load", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.statreel && typeof window.statreel.seek === "function", null, { timeout: 15000 }).catch(() => {});
    const api = await page.evaluate(() => ({ seek: typeof window.statreel?.seek, clock: typeof window.statreel?.dataClock, duration: window.statreel?.duration }));
    if (api.seek !== "function" || api.clock !== "function") {
      errors.push("window.statreel.seek(t) and window.statreel.dataClock(t) must be functions once the page has loaded");
    } else {
      if (typeof api.duration !== "number" || Math.abs(api.duration - meta.duration_s) > 0.5) errors.push(`window.statreel.duration (${api.duration}) must equal shot.json duration_s (${meta.duration_s})`);
      const shot = async () => createHash("sha256").update(await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h }, type: "png" })).digest("hex");
      const samples = [];
      for (const t of longevitySamples(meta.duration_s)) {
        // one pass per sample frame: clock, optional frameFacts, and the frame's visible text (MEASURE_TEXT)
        const clock = await page.evaluate(async (tt) => { window.__textLog = []; await window.statreel.seek(tt); return Number(window.statreel.dataClock(tt)); }, t);
        const hash = await shot();
        const texts = (await page.evaluate(MEASURE_TEXT, LINE_TO_EM)).map(({ text, px }) => ({ text, px }));
        const declared = await page.evaluate((tt) => (typeof window.statreel.frameFacts === "function" ? window.statreel.frameFacts(tt) ?? null : null), t);
        samples.push({ t, clock, hash, texts, declared });
      }
      longevity = { ...assessLongevity(samples, meta.timeline), samples: samples.map(({ t, clock }) => ({ t, clock })) };
      for (const p of longevity.problems) errors.push(`longevity: ${p}`);
      // truth probes: the printed season and the declared standings must match the clock and the staged data
      const labels = assessClockLabels(samples, { unit: meta.timeline.unit });
      for (const p of labels.problems.slice(0, 3)) errors.push(`clock label: ${p}`);
      const declaredFrames = samples.filter((s) => s.declared);
      const factProblems = declaredFrames.flatMap((s) => assessFrameFacts(s.declared, data.tables, { t: s.t, clock: s.clock }).problems);
      for (const p of factProblems.slice(0, 3)) errors.push(`frameFacts: ${p}`);
      truth = { labels: { checked: labels.checked, unlabelled: labels.unlabelled, skipped: labels.skipped ?? null }, frameFacts: declaredFrames.length ? `${declaredFrames.length} frames recomputed` : "not declared" };
      const seen = new Map();
      let mismatches = 0;
      for (const t of stabilityProbe(meta.duration_s)) {
        await page.evaluate(async (tt) => { await window.statreel.seek(tt); }, t);
        const hsh = await shot();
        if (seen.has(t) && seen.get(t) !== hsh) mismatches++;
        seen.set(t, hsh);
      }
      if (mismatches) errors.push(`not seek-stable: ${mismatches} frame(s) differ when revisited (the frame must be a pure function of t)`);
      const small = new Map();
      for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        await page.evaluate(async (tt) => { window.__textLog = []; await window.statreel.seek(tt); }, Math.round(meta.duration_s * f * 30) / 30);
        for (const x of await page.evaluate(MEASURE_TEXT, LINE_TO_EM)) if (x.px < MIN_TEXT_PX - 1 && !small.has(x.text)) small.set(x.text, x.px);
      }
      if (small.size) errors.push(`text too small: ${small.size} text item(s) under ${MIN_TEXT_PX} px, e.g. ${[...small].slice(0, 4).map(([s, px]) => `"${s}" ${px.toFixed(0)}px`).join(", ")} - every readable text must be >= ${MIN_TEXT_PX} px; drop it or enlarge it`);
    }
  } catch (e) {
    errors.push(`page failed: ${e.message.split("\n")[0]}`);
  } finally {
    await page.close();
    if (own) await browser.close();
  }
  for (const e of [...new Set(pageErrors)].slice(0, 5)) errors.push(`page error: ${e.slice(0, 200)}`);
  return { ok: errors.length === 0, errors, meta, longevity, facts, truth };
}

export async function main(variantArg, dataDir) {
  if (!variantArg) {
    console.log("usage: node data/check.mjs variant-N   (run from your workspace)");
    process.exit(2);
  }
  const r = await inspect(path.resolve(variantArg), dataDir);
  if (r.ok) {
    const l = r.longevity;
    console.log(`PASS ${variantArg}: ${r.meta.duration_s}s, clock ${l.clock_from}->${l.clock_to}, ${r.facts.cited} facts resolved, seek-stable, ${r.truth?.labels.checked ?? 0} clock labels checked`);
  } else {
    console.log(`FAIL ${variantArg}:`);
    for (const e of r.errors) console.log(`  - ${e}`);
  }
  process.exit(r.ok ? 0 : 1);
}

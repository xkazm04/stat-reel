// One design, checked the way harvest checks it. Seats run it from their workspace through the
// staged `data/check.mjs` wrapper (`node data/check.mjs variant-1`); harvest --strict calls inspect().
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assessLongevity, FORMATS, longevitySamples, resolveFacts, stabilityProbe, validateDesign } from "./lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const tableCache = new Map();

function loadData(dataDir) {
  if (!tableCache.has(dataDir)) {
    const tables = {};
    for (const f of readdirSync(dataDir).filter((f) => f.startsWith("f1_") && f.endsWith(".json"))) tables[f.slice(0, -5)] = JSON.parse(readFileSync(path.join(dataDir, f), "utf8"));
    // only cases the staged (F1) data can make; a Soccer-only format is not a valid target
    const useCases = JSON.parse(readFileSync(path.join(dataDir, "usecases.json"), "utf8")).filter((u) => u.cells.some((c) => c.sport === "F1" && c.status === "data-ready")).map((u) => u.id);
    tableCache.set(dataDir, { tables, useCases });
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
export async function inspect(variantDir, dataDir, { browser, useCases } = {}) {
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
  errors.push(...validateDesign(meta, { useCases: useCases ?? data.useCases }));
  if (!meta || errors.length) return { ok: false, errors, meta };
  const facts = resolveFacts(meta.facts, data.tables);
  if (facts.cited === 0) errors.push("facts is empty: cite every figure an annotation states as <fact_key>#<column>");
  if (facts.unresolved.length) errors.push(`${facts.unresolved.length} fact ref(s) do not exist in data/: ${facts.unresolved.slice(0, 3).join(", ")}`);
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
        const clock = await page.evaluate(async (tt) => { await window.statreel.seek(tt); return Number(window.statreel.dataClock(tt)); }, t);
        samples.push({ t, clock, hash: await shot() });
      }
      longevity = { ...assessLongevity(samples, meta.timeline), samples: samples.map(({ t, clock }) => ({ t, clock })) };
      for (const p of longevity.problems) errors.push(`longevity: ${p}`);
      const seen = new Map();
      let mismatches = 0;
      for (const t of stabilityProbe(meta.duration_s)) {
        await page.evaluate(async (tt) => { await window.statreel.seek(tt); }, t);
        const hsh = await shot();
        if (seen.has(t) && seen.get(t) !== hsh) mismatches++;
        seen.set(t, hsh);
      }
      if (mismatches) errors.push(`not seek-stable: ${mismatches} frame(s) differ when revisited (the frame must be a pure function of t)`);
    }
  } catch (e) {
    errors.push(`page failed: ${e.message.split("\n")[0]}`);
  } finally {
    await page.close();
    if (own) await browser.close();
  }
  for (const e of [...new Set(pageErrors)].slice(0, 5)) errors.push(`page error: ${e.slice(0, 200)}`);
  return { ok: errors.length === 0, errors, meta, longevity, facts };
}

export async function main(variantArg, dataDir) {
  if (!variantArg) {
    console.log("usage: node data/check.mjs variant-N   (run from your workspace)");
    process.exit(2);
  }
  const r = await inspect(path.resolve(variantArg), dataDir);
  if (r.ok) {
    const l = r.longevity;
    console.log(`PASS ${variantArg}: ${r.meta.duration_s}s, clock ${l.clock_from}->${l.clock_to}, ${r.facts.cited} facts resolved, seek-stable`);
  } else {
    console.log(`FAIL ${variantArg}:`);
    for (const e of r.errors) console.log(`  - ${e}`);
  }
  process.exit(r.ok ? 0 : 1);
}

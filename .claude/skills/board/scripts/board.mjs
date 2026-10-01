#!/usr/bin/env node
/**
 * board - StatReel's design-board loop (see ../SKILL.md).
 *
 *   node board.mjs sync                      pull the owner's decisions -> Obsidian ledger
 *   node board.mjs status                    ledger summary + board counts
 *   node board.mjs loop --id <loop> [--shots 3] [--participants <specs>] [--timeout-min 45]
 *                                            stage real data, write the brief, init + run a contest round
 *   node board.mjs stage --id <loop>         stage data + brief only (no seats) - for inspection
 *   node board.mjs harvest --id <loop> [--strict]
 *                                            render each design's cut-out, post it to the Board (--strict: only designs
 *                                            that pass the full check - facts, page errors, longevity, seek)
 *   node board.mjs mass --prefix <p> --participants <specs> [--target 100] [--max-rounds 20] [--shots 3] [--timeout-min 120]
 *                                            round after round of loop + harvest --strict until the target is on the Board
 *   node board.mjs import --image <png> --title <t> --use-case <id> --style-id <id> --style-name <n> [--summary s]
 *
 * Needs the StatReel server on 127.0.0.1:8787 (it stages data through the guarded MCP `query` tool and
 * posts to /api/board). Builtins only, except Playwright (resolved from the repo) for harvest.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyFeedback, assessLongevity, emptyLedger, excerptWindow, FORMATS, frameTimes, longevitySamples, loopPhase, rejectedCases, renderBrief, renderLedgerMarkdown, seatLanes, stabilityProbe, validateDesign } from "./lib.mjs";
import { inspect } from "./check-design.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const API = process.env.STATREEL_API ?? "http://127.0.0.1:8787";
const VAULT = process.env.STATREEL_VAULT ?? "C:/Users/mkdol/Documents/Obsidian/statreel";
const BOARD_VAULT = path.join(VAULT, "Board");
const LEDGER = path.join(BOARD_VAULT, "ledger.json");
const CONTEST = path.join(REPO, ".claude", "skills", "contest", "scripts", "contest.mjs");
const ARENA = path.join(REPO, ".contest", "arena");

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const die = (m) => {
  console.error(`board: ${m}`);
  process.exit(1);
};

async function api(pathname, body) {
  const res = await fetch(API + pathname, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const json = await res.json();
  if (!res.ok) throw new Error(`${pathname}: ${json.error ?? res.status}`);
  return json;
}

async function mcpQuery(sql) {
  const res = await fetch(`${API}/mcp`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "query", arguments: { sql } } }),
  });
  const out = JSON.parse((await res.json()).result.content[0].text);
  if (out.error) throw new Error(`query refused: ${out.error}`);
  return out;
}

const readLedger = () => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : emptyLedger());
function writeLedger(l) {
  mkdirSync(BOARD_VAULT, { recursive: true });
  writeFileSync(LEDGER, JSON.stringify(l, null, 2));
  writeFileSync(path.join(BOARD_VAULT, "Ledger.md"), renderLedgerMarkdown(l));
}

async function sync() {
  const before = readLedger();
  const { items } = await api(`/api/board/feedback${before.cursor ? `?since=${encodeURIComponent(before.cursor)}` : ""}`);
  const after = applyFeedback(before, items);
  writeLedger(after);
  const fresh = items.filter((i) => !before.seen.includes(i.id));
  if (fresh.length) {
    const log = path.join(BOARD_VAULT, "Feedback.md");
    const lines = fresh.map((i) => `- ${i.decided_at} · **${i.decision}** · ${i.title} · style \`${i.style?.id}\` · case \`${i.use_case_id ?? `proposed: ${i.proposed_case?.name}`}\`${i.note ? ` · "${i.note}"` : ""}`);
    writeFileSync(log, (existsSync(log) ? readFileSync(log, "utf8") : "# Board feedback\n\n") + lines.join("\n") + "\n");
  }
  console.log(`synced ${fresh.length} new decision(s); ${after.seen.length} total; phase ${loopPhase(after)}; ledger ${path.join(BOARD_VAULT, "Ledger.md")}`);
  return after;
}

/** The contest runner cannot exec the Windows npm shim; point it at the real claude.exe when present. */
function claudeBinEnv() {
  if (process.env.CONTEST_CLAUDE_BIN || process.platform !== "win32" || !process.env.APPDATA) return {};
  const exe = path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  return existsSync(exe) ? { CONTEST_CLAUDE_BIN: exe } : {};
}

/** Page through the guarded query tool (it caps each answer at 5000 rows). */
async function mcpAll(sql, order) {
  const rows = [];
  let columns = [];
  for (let offset = 0; ; offset += 5000) {
    const page = await mcpQuery(`select * from (${sql}) order by ${order} limit 5000 offset ${offset}`);
    columns = page.columns.length ? page.columns : columns;
    rows.push(...page.rows);
    if (page.rows.length < 5000) break;
  }
  return { rows, columns };
}

/** Only time-evolution use cases are offered to loops (ADR 007); the headline M1 skeleton is not. */
async function timeEvolutionUseCases() {
  const heat = await api("/api/heatmap");
  return heat.usecases.filter((u) => (u.family ?? "time-evolution") === "time-evolution").map((u) => ({
    ...u, cells: heat.cells.filter((c) => c.usecase === u.id).map(({ sport, mode, status, reason }) => ({ sport, mode, status, reason })),
  }));
}

async function stage(dir) {
  const data = path.join(dir, "data");
  mkdirSync(data, { recursive: true });
  const usecases = await timeEvolutionUseCases();
  const series = {
    f1_race_results: await mcpAll("select * from llm.f1_race_results where started", "season, round, entry_order"),
    f1_driver_seasons: await mcpAll("select * from llm.f1_driver_seasons where starts > 0", "season, player_id"),
    f1_constructor_seasons: await mcpAll("select * from llm.f1_constructor_seasons where races_started > 0", "season, team_id"),
    f1_driver_bios: await mcpAll("select * from llm.f1_driver_bios", "player_id"),
    f1_seasons: await mcpAll("select * from llm.f1_seasons", "season"),
  };
  const files = { usecases, ...Object.fromEntries(Object.entries(series).map(([k, v]) => [k, v.rows])) };
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(path.join(data, `${name}.json`), JSON.stringify(value));
    writeFileSync(path.join(data, `${name}.js`), `window.STATREEL = window.STATREEL || {};\nwindow.STATREEL.${name} = ${JSON.stringify(value)};\n`);
  }
  cpSync(path.join(REPO, "fonts"), path.join(data, "fonts"), { recursive: true });
  cpSync(path.join(HERE, "..", "references", "seat-skeleton.html"), path.join(data, "skeleton.html"));
  writeFileSync(path.join(data, "check.mjs"), [
    "// The board harness for one variant: node data/check.mjs variant-N (run from your workspace).",
    'import path from "node:path";', 'import { fileURLToPath } from "node:url";',
    `const { main } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, "check-design.mjs")).href)});`,
    "await main(process.argv[2], path.dirname(fileURLToPath(import.meta.url)));", "",
  ].join("\n"));
  const tokensDir = path.join(REPO, "packages", "design-tokens", "src");
  mkdirSync(path.join(data, "statreel-tokens"), { recursive: true });
  for (const f of readdirSync(tokensDir).filter((f) => f.endsWith(".css"))) cpSync(path.join(tokensDir, f), path.join(data, "statreel-tokens", f));
  const col = (k) => series[k].columns.join(", ");
  writeFileSync(path.join(data, "SCHEMA.md"), [
    "# data/ - real StatReel time series (read-only)", "",
    "Load with `<script src=\"../data/<name>.js\">` (sets `window.STATREEL.<name>`) or read the `.json`. Every row has a `fact_key`; cite a figure as `<fact_key>#<column>`.", "",
    `- \`usecases\` (${usecases.length}): the time-evolution formats - id, name, data_time {unit, from, to}, chart_form, arc (what the viz reveals as time passes), duration_s {min, max} (30-90 s), requires.kinds, sports (if sport-specific), and \`cells\` (feasibility per sport and mode).`,
    `- \`f1_race_results\` (${series.f1_race_results.rows.length} starts, race by race, 1950 onwards; ordered by season, round): ${col("f1_race_results")}. The Indianapolis 500 rounds (1950-1960, \`is_indianapolis\`) had a separate field - usually exclude them.`,
    `- \`f1_driver_seasons\` (${series.f1_driver_seasons.rows.length}): ${col("f1_driver_seasons")}.`,
    `- \`f1_constructor_seasons\` (${series.f1_constructor_seasons.rows.length}): ${col("f1_constructor_seasons")}.`,
    `- \`f1_driver_bios\` (${series.f1_driver_bios.rows.length}): ${col("f1_driver_bios")}.`,
    `- \`f1_seasons\` (${series.f1_seasons.rows.length}): ${col("f1_seasons")}. The current season is in progress: rounds after today have no results.`,
    "- Licence of all figures: F1DB, CC BY 4.0 (`attribution` column).",
    "- `fonts/`: the only allowed faces (OFL). `statreel-tokens/`: the app's brand tokens (two themes), for reference only - discovering new presentation styles is the point.",
  ].join("\n"));
  return data;
}

function patchParticipantBriefs(loopDir, { caseIds = [], round = 0 } = {}) {
  // The contest template promises CDN libraries and a judge panel; a board loop is offline and owner-reviewed.
  const entries = path.join(loopDir, "entries");
  const seats = readdirSync(entries).filter((s) => existsSync(path.join(entries, s, "PARTICIPANT.md"))).sort();
  const lanes = seatLanes(caseIds, seats.length, round);
  const addendum = readFileSync(path.join(HERE, "..", "references", "seat-addendum.md"), "utf8");
  for (const [si, seat] of seats.entries()) {
    const f = path.join(entries, seat, "PARTICIPANT.md");
    let t = readFileSync(f, "utf8");
    t = t.replace(/Libraries only from a public CDN\s+\(jsdelivr, cdnjs, unpkg\) and only when they earn their weight; a variant that also works\s+offline is worth more than one that does not\./,
      "No network at all: no CDN libraries, no\n  remote fonts or images - the variant must work fully offline.");
    t = t.replace("The panel is blind\n  and a leak is redacted before judging.", "The review is blind\n  and a leak is redacted before judging.");
    t = t.replace("Write for a judge who has not seen the other variants.", "Write for a reviewer who has not seen the other variants.");
    const lane = lanes[si].length ? `This round your variants start from the use cases ${lanes[si].map((c) => `\`${c}\``).join(" and ")}.` : "Pick the use cases yourself.";
    if (!t.includes("## How to work this round")) t += addendum.replace("{{lane}}", lane);
    writeFileSync(f, t);
  }
}

async function loop() {
  const id = opt("id") ?? die("--id <loop> is required (e.g. loop-001)");
  const shots = Number(opt("shots", "3"));
  const ledger = await sync();
  const contestId = `board-${id}`;
  const stageDir = path.join(REPO, ".contest", "staging", contestId);
  const data = await stage(stageDir);
  const { items: board } = await api("/api/board");
  const brief = renderBrief({ template: readFileSync(path.join(HERE, "..", "references", "loop-brief.md"), "utf8"), ledger, shots, board });
  writeFileSync(path.join(stageDir, "BRIEF.md"), brief);
  const init = ["init", "--id", contestId, "--title", `StatReel Board - ${id} (${loopPhase(ledger)})`, "--brief", path.join(stageDir, "BRIEF.md"),
    "--variants", String(shots), "--review", "owner", "--data", data, "--timeout-min", opt("timeout-min", "60"),
    "--vault", VAULT, "--vault-subdir", "Board/Contests"];
  if (opt("participants")) init.push("--participants", opt("participants"));
  const r1 = spawnSync(process.execPath, [CONTEST, ...init], { cwd: REPO, stdio: "inherit" });
  if (r1.status !== 0) die("contest init failed");
  const rejected = new Set(rejectedCases(ledger));
  const caseIds = (await timeEvolutionUseCases()).map((u) => u.id).filter((c) => !rejected.has(c));
  patchParticipantBriefs(path.join(ARENA, contestId), { caseIds, round: Number(opt("round", "0")) });
  mkdirSync(path.join(BOARD_VAULT, "Loops"), { recursive: true });
  writeFileSync(path.join(BOARD_VAULT, "Loops", `${id}.md`), `# ${id}\n\n- phase: ${loopPhase(ledger)}\n- shots per seat: ${shots}\n- contest: ${contestId}\n- started: ${new Date().toISOString()}\n\n## Brief\n\n${brief}\n`);
  console.log(`running seats for ${contestId} (this takes up to ${opt("timeout-min", "60")} min)...`);
  const r2 = spawnSync(process.execPath, [CONTEST, "run", "--id", contestId], { cwd: REPO, stdio: "inherit", env: { ...process.env, ...claudeBinEnv() } });
  if (r2.status !== 0) die("contest run failed");
  console.log(`done. next: node board.mjs harvest --id ${id}`);
}

async function harvest() {
  const id = opt("id") ?? die("--id <loop> is required");
  const contestId = `board-${id}`;
  const entries = path.join(ARENA, contestId, "entries");
  if (!existsSync(entries)) die(`no arena for ${contestId}`);
  const req = createRequire(path.join(REPO, "package.json"));
  const { chromium } = req("@playwright/test");
  const browser = await chromium.launch({ channel: process.env.BOARD_BROWSER_CHANNEL ?? "chrome" });
  const outDir = path.join(REPO, "data", "board", "items");
  mkdirSync(outDir, { recursive: true });
  let posted = 0;
  const useCases = (await timeEvolutionUseCases()).map((u) => u.id);
  const strict = argv.includes("--strict");
  const report = [];
  const seats = readdirSync(entries).filter((s) => existsSync(path.join(entries, s, "PARTICIPANT.md"))).sort();
  for (const [si, seat] of seats.entries()) {
    for (const v of readdirSync(path.join(entries, seat)).filter((d) => /^variant-\d+$/.test(d)).sort()) {
      const dir = path.join(entries, seat, v);
      const metaFile = path.join(dir, "shot.json");
      let meta = null;
      try {
        meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : null;
      } catch {
        meta = null;
      }
      const errors = validateDesign(meta, { useCases });
      if (!errors.length && strict) {
        const r = await inspect(dir, path.join(entries, seat, "data"), { browser, useCases });
        errors.push(...r.errors);
      }
      report.push({ seat, variant: v, ok: !errors.length, errors, style: meta?.style?.id ?? null, case: meta?.use_case_id ?? meta?.proposed_case?.name ?? null });
      if (errors.length) {
        console.log(`skip ${seat}/${v}: ${errors.join("; ")}`);
        continue;
      }
      const [w, h] = FORMATS[meta.format];
      const base = `${id}-${String.fromCharCode(65 + si)}${v.split("-")[1]}`;
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const url = new URL(`file:///${path.join(dir, "index.html").split(path.sep).join("/")}`);
      url.searchParams.set("capture", "1");
      await page.goto(url.href, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const apiOk = await page.evaluate(() => typeof window.statreel?.seek === "function" && typeof window.statreel?.dataClock === "function");
      if (!apiOk) {
        console.log(`skip ${seat}/${v}: window.statreel.seek(t) and dataClock(t) are required`);
        await page.close();
        continue;
      }
      const cut = await renderCutout(page, meta, w, h, path.join(outDir, `${base}.mp4`), path.join(outDir, `${base}.png`));
      const longevity = await measureLongevity(page, meta, w, h);
      await page.close();
      console.log(`  ${meta.duration_s}s run, cut-out ${cut.excerpt.start_s.toFixed(1)}-${(cut.excerpt.start_s + cut.excerpt.duration_s).toFixed(1)}s, seek-stable: ${cut.seek_stable}, longevity: ${longevity.ok ? "ok" : longevity.problems.join("; ")}`);
      const item = await api("/api/board", {
        image: `items/${base}.png`, video: `items/${base}.mp4`, duration_s: cut.excerpt.duration_s, width: w, height: h,
        title: meta.title, summary: meta.summary ?? null,
        use_case_id: meta.use_case_id ?? null, proposed_case: meta.proposed_case ?? null, style: meta.style,
        source: { skill: "board", loop: id, contest: contestId, seat, variant: v, facts: meta.facts ?? [], chart_form: meta.chart_form,
          clip: { ...cut, full_duration_s: meta.duration_s, timeline: meta.timeline, longevity } },
      });
      console.log(`posted ${item.id}  ${meta.style.name} · ${meta.use_case_id ?? `proposed: ${meta.proposed_case.name}`} · ${meta.title}`);
      posted++;
    }
  }
  await browser.close();
  writeFileSync(path.join(ARENA, contestId, "harvest.json"), JSON.stringify({ id, strict, posted, report }, null, 2));
  console.log(`${posted} shot(s) on the Board. Review them at /board, then run: node board.mjs sync`);
}

/** The Board's one cut-out: 8 s from the middle of the full run, frame by frame (+ poster, + seek probe). */
async function renderCutout(page, meta, w, h, mp4, poster) {
  const excerpt = excerptWindow(meta.duration_s, 8);
  const shifted = { ...meta, duration_s: excerpt.duration_s, poster_t: excerpt.duration_s / 2 };
  const offsetPage = {
    evaluate: (fn, t) => page.evaluate(fn, typeof t === "number" ? t + excerpt.start_s : t),
    screenshot: (o) => page.screenshot(o),
  };
  const r = await renderClip(offsetPage, shifted, w, h, mp4, poster);
  return { excerpt, fps: r.fps, frames: r.frames, seek_stable: r.seek_stable, mismatches: r.mismatches };
}

/** Sample dataClock(t) and the picture across the full run; see lib.assessLongevity. */
async function measureLongevity(page, meta, w, h) {
  const samples = [];
  for (const t of longevitySamples(meta.duration_s)) {
    const clock = await page.evaluate(async (tt) => { await window.statreel.seek(tt); return Number(window.statreel.dataClock(tt)); }, t);
    const hash = createHash("sha256").update(await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h }, type: "png" })).digest("hex");
    samples.push({ t, clock, hash });
  }
  return { ...assessLongevity(samples, meta.timeline), samples: samples.map(({ t, clock }) => ({ t, clock })) };
}

/** Render a seekable artboard to MP4 (+ poster) and probe that each frame is a pure function of t. */
async function renderClip(page, meta, w, h, mp4, poster) {
  const fps = meta.fps ?? 30;
  const seek = (t) => page.evaluate(async (tt) => { await window.statreel.seek(tt); }, t);
  const shot = () => page.screenshot({ clip: { x: 0, y: 0, width: w, height: h }, type: "png" });
  const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", mp4], { stdio: ["pipe", "ignore", "pipe"] });
  let ffErr = "";
  ff.stderr.on("data", (d) => (ffErr += d));
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}: ${ffErr}`)))));
  const times = frameTimes(meta.duration_s, fps);
  for (const t of times) {
    await seek(t);
    const buf = await shot();
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
  await seek(meta.poster_t);
  writeFileSync(poster, await shot());
  // out-of-order revisits: identical pixels are required for a seek-stable frame
  const seen = new Map();
  let mismatches = 0;
  for (const t of stabilityProbe(meta.duration_s)) {
    await seek(t);
    const hash = createHash("sha256").update(await shot()).digest("hex");
    if (seen.has(t) && seen.get(t) !== hash) mismatches++;
    seen.set(t, hash);
  }
  return { duration_s: meta.duration_s, fps, frames: times.length, poster_t: meta.poster_t, seek_stable: mismatches === 0, mismatches };
}

/**
 * Many cheap rounds: sync -> loop (lanes rotate per round) -> harvest --strict, until `--target`
 * designs from this run are on the Board. Stops after `--max-rounds`, or after 3 rounds in a row
 * that posted nothing. The owner's decisions made meanwhile reach the next round's brief at sync.
 */
async function mass() {
  const prefix = opt("prefix") ?? die("--prefix <name> is required (e.g. gm)");
  const target = Number(opt("target", "100"));
  const maxRounds = Number(opt("max-rounds", "20"));
  const participants = opt("participants") ?? die("--participants <specs> is required");
  const fromThisRun = async () => (await api("/api/board?status=all")).items.filter((i) => String(i.source?.loop ?? "").startsWith(`${prefix}-`)).length;
  const logFile = path.join(BOARD_VAULT, "Loops", `mass-${prefix}.md`);
  mkdirSync(path.dirname(logFile), { recursive: true });
  if (!existsSync(logFile)) writeFileSync(logFile, `# mass run ${prefix}\n\n- target: ${target}\n- participants: ${participants}\n\n| round | finished | posted | skipped | on Board (run) |\n|---|---|---|---|---|\n`);
  const done = existsSync(ARENA) ? readdirSync(ARENA).filter((d) => d.startsWith(`board-${prefix}-`)).length : 0;
  let dry = 0;
  for (let r = done; r < done + maxRounds; r++) {
    const have = await fromThisRun();
    if (have >= target) break;
    const id = `${prefix}-${String(r + 1).padStart(3, "0")}`;
    console.log(`\n=== ${id}: ${have}/${target} on the Board ===`);
    const node = (args) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { cwd: REPO, stdio: "inherit", env: process.env });
    node(["loop", "--id", id, "--participants", participants, "--shots", opt("shots", "3"), "--timeout-min", opt("timeout-min", "120"), "--round", String(r)]);
    if (existsSync(path.join(ARENA, `board-${id}`))) node(["harvest", "--id", id, "--strict"]);
    const h = existsSync(path.join(ARENA, `board-${id}`, "harvest.json")) ? JSON.parse(readFileSync(path.join(ARENA, `board-${id}`, "harvest.json"), "utf8")) : { posted: 0, report: [] };
    const now = await fromThisRun();
    appendFileSync(logFile, `| ${id} | ${new Date().toISOString()} | ${h.posted} | ${h.report.filter((x) => !x.ok).length} | ${now} |\n`);
    dry = h.posted ? 0 : dry + 1;
    if (dry >= 3) {
      console.log("3 rounds in a row posted nothing - stopping; read harvest.json in the last arenas");
      break;
    }
  }
  console.log(`mass ${prefix}: ${await fromThisRun()}/${target} on the Board`);
}

async function status() {
  const l = readLedger();
  const { items } = await api("/api/board");
  const by = (s) => items.filter((i) => i.status === s).length;
  console.log(`board: ${items.length} items (${by("pending")} pending, ${by("accepted")} accepted, ${by("rejected")} rejected)`);
  console.log(`ledger: ${l.seen.length} decisions folded, phase ${loopPhase(l)}, ${Object.keys(l.styles).length} styles, ${Object.keys(l.cases).length} cases`);
}

async function importImage() {
  const src = opt("image") ?? die("--image <png> required");
  const name = `import-${Date.now()}-${path.basename(src)}`;
  const outDir = path.join(REPO, "data", "board", "items");
  mkdirSync(outDir, { recursive: true });
  copyFileSync(src, path.join(outDir, name));
  const item = await api("/api/board", {
    image: `items/${name}`, title: opt("title") ?? die("--title required"), summary: opt("summary") ?? null,
    use_case_id: opt("use-case") ?? die("--use-case required"),
    style: { id: opt("style-id") ?? die("--style-id required"), name: opt("style-name") ?? opt("style-id") },
    source: { skill: "board", import: path.basename(src) },
  });
  console.log(`posted ${item.id}`);
}

async function stageOnly() {
  const id = opt("id") ?? die("--id <loop> is required");
  const dir = path.join(REPO, ".contest", "staging", `board-${id}`);
  const data = await stage(dir);
  writeFileSync(path.join(dir, "BRIEF.md"), renderBrief({ template: readFileSync(path.join(HERE, "..", "references", "loop-brief.md"), "utf8"), ledger: readLedger(), shots: Number(opt("shots", "3")) }));
  console.log(`staged ${data} and ${path.join(dir, "BRIEF.md")} (no seats run)`);
}

const cmds = { sync, status, loop, harvest, mass, import: importImage, stage: stageOnly };
if (!cmds[cmd]) die(`usage: board.mjs ${Object.keys(cmds).join("|")} ...`);
await cmds[cmd]();

#!/usr/bin/env node
/**
 * board - StatReel's design-board loop (see ../SKILL.md).
 *
 *   node board.mjs sync                      pull the owner's decisions -> Obsidian ledger
 *   node board.mjs status                    ledger summary + board counts
 *   node board.mjs loop --id <loop> [--shots 3] [--participants <specs>] [--timeout-min 45]
 *                                            stage real data, write the brief, init + run a contest round
 *   node board.mjs stage --id <loop>         stage data + brief only (no seats) - for inspection
 *   node board.mjs harvest --id <loop>       screenshot every variant, post it to the Board
 *   node board.mjs import --image <png> --title <t> --use-case <id> --style-id <id> --style-name <n> [--summary s]
 *
 * Needs the StatReel server on 127.0.0.1:8787 (it stages data through the guarded MCP `query` tool and
 * posts to /api/board). Builtins only, except Playwright (resolved from the repo) for harvest.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyFeedback, emptyLedger, FORMATS, loopPhase, renderBrief, renderLedgerMarkdown, validateShot } from "./lib.mjs";

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

async function stage(dir) {
  const data = path.join(dir, "data");
  mkdirSync(data, { recursive: true });
  const heat = await api("/api/heatmap");
  const usecases = heat.usecases.map((u) => ({
    ...u, cells: heat.cells.filter((c) => c.usecase === u.id).map(({ sport, mode, status, reason }) => ({ sport, mode, status, reason })),
  }));
  const era = await mcpQuery("select * from llm.f1_driver_era_adjusted where eligible order by rank_adjusted");
  const seasons = await mcpQuery("select * from llm.f1_driver_seasons where starts > 0 order by season, points_current_system desc");
  const files = { usecases, f1_era_adjusted: era.rows, f1_driver_seasons: seasons.rows };
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(path.join(data, `${name}.json`), JSON.stringify(value, null, 1));
    writeFileSync(path.join(data, `${name}.js`), `window.STATREEL = window.STATREEL || {};\nwindow.STATREEL.${name} = ${JSON.stringify(value)};\n`);
  }
  cpSync(path.join(REPO, "fonts"), path.join(data, "fonts"), { recursive: true });
  // the brand tokens are split into shared + one file per theme (ADR 006): stage them all, for reference
  const tokensDir = path.join(REPO, "packages", "design-tokens", "src");
  mkdirSync(path.join(data, "statreel-tokens"), { recursive: true });
  for (const f of readdirSync(tokensDir).filter((f) => f.endsWith(".css"))) cpSync(path.join(tokensDir, f), path.join(data, "statreel-tokens", f));
  writeFileSync(path.join(data, "SCHEMA.md"), [
    "# data/ - real StatReel material (read-only)", "",
    "Load with `<script src=\"../data/<name>.js\">` (sets `window.STATREEL.<name>`) or read the `.json`.", "",
    `- \`usecases\` (${usecases.length}): id, name, stage, requires.kinds, composition, formats, duration_s, and \`cells\` (per sport and mode: status go|data-ready|ask|blocked + reason). Only F1 capabilities are tested today.`,
    `- \`f1_era_adjusted\` (${era.rows.length} eligible drivers, >= 30 starts): the \`llm.f1_driver_era_adjusted\` view. Columns: ${era.columns.join(", ")}. Every row has a \`fact_key\`; cite a figure as \`<fact_key>#<column>\`.`,
    `- \`f1_driver_seasons\` (${seasons.rows.length} driver-seasons): the \`llm.f1_driver_seasons\` view. Columns: ${seasons.columns.join(", ")}.`,
    "- Licence of all figures: F1DB, CC BY 4.0 (`attribution` column). Adjusted = every race re-scored with today's points, per start; an estimate.",
    "- `fonts/`: the only allowed faces (OFL). `statreel-tokens/`: the app's current brand tokens (shared + the On Air and Photo Finish themes), for reference only - discovering new presentation styles is the point.",
  ].join("\n"));
  return data;
}

function patchParticipantBriefs(loopDir) {
  // The contest template promises CDN libraries and a judge panel; a board loop is offline and owner-reviewed.
  const entries = path.join(loopDir, "entries");
  for (const seat of readdirSync(entries)) {
    const f = path.join(entries, seat, "PARTICIPANT.md");
    if (!existsSync(f)) continue;
    let t = readFileSync(f, "utf8");
    t = t.replace(/Libraries only from a public CDN\s+\(jsdelivr, cdnjs, unpkg\) and only when they earn their weight; a variant that also works\s+offline is worth more than one that does not\./,
      "No network at all: no CDN libraries, no\n  remote fonts or images - the variant must work fully offline.");
    t = t.replace("The panel is blind\n  and a leak is redacted before judging.", "The review is blind\n  and a leak is redacted before judging.");
    t = t.replace("Write for a judge who has not seen the other variants.", "Write for a reviewer who has not seen the other variants.");
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
  const brief = renderBrief({ template: readFileSync(path.join(HERE, "..", "references", "loop-brief.md"), "utf8"), ledger, shots });
  writeFileSync(path.join(stageDir, "BRIEF.md"), brief);
  const init = ["init", "--id", contestId, "--title", `StatReel Board - ${id} (${loopPhase(ledger)})`, "--brief", path.join(stageDir, "BRIEF.md"),
    "--variants", String(shots), "--review", "owner", "--data", data, "--timeout-min", opt("timeout-min", "45"),
    "--vault", VAULT, "--vault-subdir", "Board/Contests"];
  if (opt("participants")) init.push("--participants", opt("participants"));
  const r1 = spawnSync(process.execPath, [CONTEST, ...init], { cwd: REPO, stdio: "inherit" });
  if (r1.status !== 0) die("contest init failed");
  patchParticipantBriefs(path.join(ARENA, contestId));
  mkdirSync(path.join(BOARD_VAULT, "Loops"), { recursive: true });
  writeFileSync(path.join(BOARD_VAULT, "Loops", `${id}.md`), `# ${id}\n\n- phase: ${loopPhase(ledger)}\n- shots per seat: ${shots}\n- contest: ${contestId}\n- started: ${new Date().toISOString()}\n\n## Brief\n\n${brief}\n`);
  console.log(`running seats for ${contestId} (this takes up to ${opt("timeout-min", "45")} min)...`);
  const r2 = spawnSync(process.execPath, [CONTEST, "run", "--id", contestId], { cwd: REPO, stdio: "inherit", env: process.env });
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
  const seats = readdirSync(entries).filter((s) => existsSync(path.join(entries, s, "PARTICIPANT.md")));
  for (const [si, seat] of seats.entries()) {
    for (const v of readdirSync(path.join(entries, seat)).filter((d) => /^variant-\d+$/.test(d)).sort()) {
      const dir = path.join(entries, seat, v);
      const metaFile = path.join(dir, "shot.json");
      const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : null;
      const errors = validateShot(meta);
      if (errors.length) {
        console.log(`skip ${seat}/${v}: ${errors.join("; ")}`);
        continue;
      }
      const [w, h] = FORMATS[meta.format];
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.goto(new URL(`file:///${path.join(dir, "index.html").replace(/\\/g, "/")}`).href, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(2500); // let any arrival motion settle on its final frame
      const name = `${id}-${String.fromCharCode(65 + si)}${v.split("-")[1]}.png`;
      await page.screenshot({ path: path.join(outDir, name), clip: { x: 0, y: 0, width: w, height: h } });
      await page.close();
      const item = await api("/api/board", {
        image: `items/${name}`, width: w, height: h, title: meta.title, summary: meta.summary ?? null,
        use_case_id: meta.use_case_id ?? null, proposed_case: meta.proposed_case ?? null, style: meta.style,
        source: { skill: "board", loop: id, contest: contestId, seat, variant: v, facts: meta.facts ?? [] },
      });
      console.log(`posted ${item.id}  ${meta.style.name} · ${meta.use_case_id ?? `proposed: ${meta.proposed_case.name}`} · ${meta.title}`);
      posted++;
    }
  }
  await browser.close();
  console.log(`${posted} shot(s) on the Board. Review them at /board, then run: node board.mjs sync`);
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

const cmds = { sync, status, loop, harvest, import: importImage, stage: stageOnly };
if (!cmds[cmd]) die(`usage: board.mjs ${Object.keys(cmds).join("|")} ...`);
await cmds[cmd]();

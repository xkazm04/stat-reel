// Biome ratchet: read-only `biome check` over apps/packages/e2e, per-rule counts vs scripts/biome-baseline.json.
// Fails if any rule's count increased. Usage:
//   node scripts/biome-ratchet.mjs                 compare with the baseline
//   node scripts/biome-ratchet.mjs --update        rewrite the baseline from the current tree
//   node scripts/biome-ratchet.mjs --root <dir>    measure another checkout (e.g. a `git archive HEAD` export)
// Never writes to source files; `--update` writes only the baseline JSON.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compare, countByRule, formatReport, instrumentProblem, sortKeys } from "./biome-ratchet-core.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repo, "scripts", "biome-baseline.json");
const args = process.argv.slice(2);
const update = args.includes("--update");
const rootIdx = args.indexOf("--root");
const root = rootIdx >= 0 ? path.resolve(args[rootIdx + 1] ?? "") : repo;

// `pnpm exec biome` resolves the workspace binary; pnpm is a .cmd shim on Windows so it needs a shell there.
const r = spawnSync(
  "pnpm",
  ["exec", "biome", "check", `--config-path=${root}`, "--reporter=json", "--max-diagnostics=none", ...["apps", "packages", "e2e"].map((d) => path.join(root, d))],
  { cwd: repo, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, shell: process.platform === "win32" },
);
// the JSON report is the first line starting with "{" (pnpm may print a banner before it); biome exits 1 when it has diagnostics
const start = (r.stdout ?? "").indexOf("{");
let report;
try {
  report = JSON.parse(r.stdout.slice(start));
} catch {
  console.error(`biome ratchet: could not read biome's JSON report (exit ${r.status})\n${(r.stderr ?? "").slice(0, 2000)}${(r.stdout ?? "").slice(0, 500)}`);
  process.exit(2);
}
const blind = instrumentProblem(report);
if (blind) {
  console.error(blind);
  process.exit(2);
}
const current = countByRule(report);
const total = Object.values(current).reduce((a, b) => a + b, 0);

if (update) {
  writeFileSync(baselinePath, `${JSON.stringify({ rules: sortKeys(current) }, null, 2)}\n`);
  console.log(`biome ratchet: baseline written (${total} diagnostics across ${Object.keys(current).length} rules)`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8")).rules;
const result = compare(baseline, current);
console.log(formatReport(result, total));
process.exit(result.ok ? 0 : 1);

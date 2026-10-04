// One offline gate: typecheck, vitest, script tests, board harness tests, pytest, OPA, dbt parse, Biome ratchet. Every step runs even
// when an earlier one fails, so one invocation reports everything that is red. `--only a,b` narrows it.
// Usage: node scripts/check.mjs [--only typecheck,opa]   (also `pnpm check` / `just check`)
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exitCode, formatTable, parseOnly, requirePopulation, runSteps } from "./check-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const venvBin = path.join(root, "pipeline", ".venv", win ? "Scripts" : "bin");

/**
 * `--warn-error`: dbt only WARNS on a deprecation (slated to become an error in a later dbt), a --select that
 * selects nothing or a config path that matches no model, and exits 0 - so the gate would stay green on exactly
 * what it exists to catch early.
 */
export function dbtParseArgs(target) {
  return ["parse", "--warn-error", "--project-dir", "pipeline/dbt", "--profiles-dir", "pipeline/dbt", "--target-path", target];
}

/** dbt parse needs no warehouse: dummy env, and a scratch target dir so the shared pipeline/dbt/target is untouched. */
function dbtParse() {
  const target = mkdtempSync(path.join(tmpdir(), "statreel-dbt-parse-"));
  const dbt = path.join(venvBin, win ? "dbt.exe" : "dbt");
  const run = () =>
    sh(dbt, dbtParseArgs(target), {
      STATREEL_WAREHOUSE: path.join(target, "dummy.duckdb"),
      F1DB_SNAPSHOT: path.join(target, "dummy-snapshot"),
    });
  try {
    return run();
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
}

function sh(cmd, args, env = {}) {
  // pnpm is a .cmd shim on Windows, which only spawns through a shell; the args here are fixed literals.
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env }, shell: win && cmd === "pnpm" });
  if (r.error) return { ok: false, detail: r.error.message };
  return { ok: r.status === 0, detail: r.status === 0 ? undefined : `exit ${r.status}` };
}

/** Repo-relative files under `dir` whose basename matches `re` (sorted; [] when the dir is missing). */
function filesIn(dir, re, recursive = false) {
  try {
    return readdirSync(path.join(root, dir), { recursive })
      .map((f) => String(f).replaceAll("\\", "/"))
      .filter((f) => re.test(path.posix.basename(f)))
      .map((f) => `${dir}/${f}`)
      .sort();
  } catch {
    return [];
  }
}

/** node --test over an explicit file list: a glob that matches nothing would exit 0 with "tests 0". */
export function nodeTestStep(dir, re) {
  const files = filesIn(dir, re);
  return requirePopulation(`${dir}/ (${re})`, files) ?? sh(process.execPath, ["--test", ...files]);
}

/** opa test exits 0 on a directory without a single *_test.rego. */
function opaTest() {
  const files = filesIn("policy", /_test\.rego$/, true);
  return requirePopulation("policy/**/*_test.rego", files) ?? sh(path.join(root, ".tools", win ? "opa.exe" : "opa"), ["test", "policy"]);
}

export const STEPS = [
  { name: "typecheck", run: () => sh("pnpm", ["-s", "typecheck"]) },
  { name: "vitest", run: () => sh("pnpm", ["-s", "test"]) },
  { name: "scripts", run: () => nodeTestStep("scripts", /\.test\.mjs$/) },
  { name: "board", run: () => nodeTestStep(".claude/skills/board/tests", /\.mjs$/) },
  { name: "pytest", run: () => sh("uv", ["run", "--project", "pipeline", "pytest", "pipeline/tests", "-m", "not live"]) },
  { name: "opa", run: opaTest },
  { name: "dbt-parse", run: dbtParse },
  { name: "biome-ratchet", run: () => sh(process.execPath, ["scripts/biome-ratchet.mjs"]) },
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let only;
  try {
    only = parseOnly(process.argv.slice(2), STEPS.map((s) => s.name));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const steps = only ? STEPS.filter((s) => only.includes(s.name)) : STEPS;
  const results = await runSteps(steps, (s) => {
    console.log(`\n=== ${s.name} ===`);
    return s.run();
  });
  console.log(`\n${formatTable(results)}`);
  process.exit(exitCode(results));
}

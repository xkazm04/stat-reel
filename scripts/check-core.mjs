// Pure parts of scripts/check.mjs: run every step even when one fails, summarise, pick the exit code.
// Kept free of process/child_process so the summary and exit-code logic is unit-tested with fake runners
// (a gate that cannot be shown to fail is not a gate).

/** @typedef {{ name: string }} Step */
/** @typedef {{ name: string, ok: boolean, ms: number, detail?: string }} Result */

/** Parse `--only a,b` / `--only=a,b` out of argv; returns null for "all steps". Unknown names throw. */
export function parseOnly(argv, known) {
  let raw;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") raw = argv[i + 1] ?? "";
    else if (argv[i].startsWith("--only=")) raw = argv[i].slice("--only=".length);
  }
  if (raw === undefined) return null;
  const names = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) throw new Error(`--only needs a step list (${known.join(", ")})`);
  const unknown = names.filter((n) => !known.includes(n));
  if (unknown.length) throw new Error(`unknown step(s): ${unknown.join(", ")} (known: ${known.join(", ")})`);
  return names;
}

/**
 * Run steps in order through `run(step)` -> { ok, detail? } (sync or async). A throwing runner counts as a
 * failure, never aborts the remaining steps. `now` is injectable for deterministic durations.
 */
export async function runSteps(steps, run, now = () => Date.now()) {
  /** @type {Result[]} */
  const results = [];
  for (const step of steps) {
    const t0 = now();
    let ok = false;
    let detail;
    try {
      const r = await run(step);
      ok = r.ok === true;
      detail = r.detail;
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }
    results.push({ name: step.name, ok, ms: now() - t0, detail });
  }
  return results;
}

export function exitCode(results) {
  return results.length > 0 && results.every((r) => r.ok) ? 0 : 1;
}

export function formatDuration(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** PASS/FAIL table, one row per step, then a one-line verdict. */
export function formatTable(results) {
  const w = Math.max(4, ...results.map((r) => r.name.length));
  const lines = results.map((r) => `${r.name.padEnd(w)}  ${r.ok ? "PASS" : "FAIL"}  ${formatDuration(r.ms).padStart(7)}${!r.ok && r.detail ? `  ${r.detail}` : ""}`);
  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  lines.push("", failed.length ? `FAILED: ${failed.join(", ")}` : results.length ? "ALL PASS" : "NO STEPS RAN");
  return lines.join("\n");
}

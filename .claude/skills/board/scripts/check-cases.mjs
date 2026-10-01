// A case seat's self-check: node data/check-cases.mjs (from the workspace). Validates
// variant-1/cases.json the way harvest-cases does: the server's rules (decade, beats, tension,
// sources), staged evidence resolving to real rows, registry ids that exist, no repeats.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveFacts, titleKey, validateCaseIdea } from "./lib.mjs";

/** Errors per case for one cases.json; `existing` titles and `registryIds` come from the staged data/. */
export function checkCases(cases, { tables = {}, existing = [], registryIds = [], avoidIds = [], count = null } = {}) {
  const out = [];
  if (!Array.isArray(cases)) return { ok: false, global: ["cases.json must be a JSON array"], cases: out };
  const global = [];
  if (count && cases.length < count) global.push(`${cases.length} cases; the brief asks for ${count}`);
  const seen = new Set(existing.map(titleKey));
  for (const [i, c] of cases.entries()) {
    const errors = validateCaseIdea(c);
    if (c?.data_status === "staged") {
      const r = resolveFacts(c.evidence ?? [], tables);
      if (!r.cited) errors.push("data_status staged needs evidence: real <fact_key>#<column> refs from data/*.json");
      if (r.unresolved.length) errors.push(`${r.unresolved.length} evidence ref(s) not in data/: ${r.unresolved.slice(0, 2).join(", ")}`);
    }
    for (const s of c?.sources ?? []) {
      if (s?.registry_id && !registryIds.includes(s.registry_id)) errors.push(`registry_id ${s.registry_id} is not in the registry`);
      if (s?.registry_id && avoidIds.includes(s.registry_id)) errors.push(`${s.registry_id} is marked avoid in the registry - never propose it`);
    }
    if (c?.data_status === "registry" && !(c.sources ?? []).some((s) => s?.registry_id && registryIds.includes(s.registry_id))) {
      errors.push("data_status registry needs a source with a registry_id from the registry");
    }
    const k = titleKey(c?.title ?? "");
    if (k && seen.has(k)) errors.push("repeats a case that already exists (same title)");
    seen.add(k);
    out.push({ index: i, title: c?.title ?? `#${i + 1}`, errors });
  }
  return { ok: !global.length && out.every((c) => !c.errors.length), global, cases: out };
}

export function loadContext(dataDir) {
  const tables = {};
  for (const f of readdirSync(dataDir).filter((f) => f.startsWith("f1_") && f.endsWith(".json"))) tables[f.slice(0, -5)] = JSON.parse(readFileSync(path.join(dataDir, f), "utf8"));
  const ctx = JSON.parse(readFileSync(path.join(dataDir, "case-context.json"), "utf8"));
  return { tables, existing: ctx.existing, registryIds: ctx.registry_ids, avoidIds: ctx.avoid_ids, count: ctx.count };
}

export async function main(workspace, dataDir) {
  const file = path.join(workspace, "variant-1", "cases.json");
  if (!existsSync(file)) {
    console.log("FAIL: variant-1/cases.json is missing");
    process.exit(1);
  }
  let cases;
  try {
    cases = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`FAIL: variant-1/cases.json is not valid JSON: ${e.message}`);
    process.exit(1);
  }
  const r = checkCases(cases, loadContext(dataDir));
  for (const g of r.global) console.log(`FAIL: ${g}`);
  for (const c of r.cases) {
    if (!c.errors.length) console.log(`PASS #${c.index + 1} ${c.title}`);
    else {
      console.log(`FAIL #${c.index + 1} ${c.title}:`);
      for (const e of c.errors) console.log(`  - ${e}`);
    }
  }
  console.log(r.ok ? `PASS: all ${r.cases.length} cases` : "FAIL: fix the lines above and rerun");
  process.exit(r.ok ? 0 : 1);
}

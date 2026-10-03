// Pure parts of scripts/biome-ratchet.mjs. HEAD is not Biome-clean (hundreds of diagnostics), so `pnpm lint` is
// permanently red and tells nobody anything. The ratchet makes the debt one-way instead: per-rule counts are
// committed, a rule's count may fall but never rise, and a new rule starts at 0.

/** Count diagnostics per rule category from Biome's `--reporter=json` payload. `format` and organizeImports count as rules. */
export function countByRule(report) {
  const counts = {};
  for (const d of report.diagnostics ?? []) {
    const rule = d.category ?? "unknown";
    counts[rule] = (counts[rule] ?? 0) + 1;
  }
  return sortKeys(counts);
}

export function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Compare current per-rule counts with the baseline.
 * increases: rules that got worse (including rules absent from the baseline) - these fail the gate.
 * decreases: rules that improved (including rules that vanished) - these only hint at `--update`.
 */
export function compare(baseline, current) {
  const increases = [];
  const decreases = [];
  for (const rule of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    const before = baseline[rule] ?? 0;
    const after = current[rule] ?? 0;
    if (after > before) increases.push({ rule, before, after });
    else if (after < before) decreases.push({ rule, before, after });
  }
  const byRule = (a, b) => (a.rule < b.rule ? -1 : 1);
  return { ok: increases.length === 0, increases: increases.sort(byRule), decreases: decreases.sort(byRule) };
}

export function formatReport({ ok, increases, decreases }, total) {
  const line = (r) => `  ${r.rule}: ${r.before} -> ${r.after}`;
  const out = [];
  if (increases.length) out.push("Biome diagnostics INCREASED (fix them, or justify and re-baseline with --update):", ...increases.map(line));
  if (decreases.length) out.push("Biome diagnostics decreased - lock the gain in with: node scripts/biome-ratchet.mjs --update", ...decreases.map(line));
  out.push(ok ? `biome ratchet ok (${total} diagnostics, none above baseline)` : `biome ratchet FAILED (${total} diagnostics)`);
  return out.join("\n");
}

# 002 - Capability tests are declared in YAML and evaluated in Python, not as dbt tests

- Status: accepted
- Date: 2026-09-29
- Affects: DESIGN.md §5.4 (capability tests), §7 (heatmap inputs)

## Context

DESIGN.md §5.4 plans capability tests as "dbt tests + custom macros" whose results land in
`meta.capabilities`. dbt tests return pass or fail per test node. They don't produce the row
the heatmap needs: coverage years, row count, licence class, and one human-readable reason per
failed check. Getting that row would mean parsing `run_results.json` and re-querying anyway.

## Decision

- `pipeline/capabilities.yaml` declares one entry per (sport, kind, source) with a warehouse
  relation and checks: `min_rows`, `coverage_from_max`, `min_seasons`, `max_null_ratio`,
  `max_staleness_days`.
- `statreel_ingest.capabilities` evaluates them after every `dbt build` and replaces
  `meta.capabilities` with one row per entry: `status` pass/fail and a `detail` that lists every
  failed check.
- A missing relation is a `fail` with a reason, not a crash. A source with verdict `avoid` can
  never pass.
- dbt tests still guard schema integrity (not_null, unique, accepted_values). Capabilities answer
  a different question: is this data good enough to make videos from?

## Consequences

- A new sport or source adds YAML rows, and the heatmap picks them up (§7 extensibility holds).
- `live` capabilities fail off-season on purpose (staleness), which is the honest heatmap state.

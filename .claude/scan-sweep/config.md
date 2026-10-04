---
contextMap: context-map.json
memoryOutbox: .personas/memory-outbox.jsonl
backlogDigest: .personas/backlog-digest.json
openBacklogs: .claude/scan-history/open-backlogs.jsonl
findingsDir: .claude/scan-history/findings   # one <context-slug>.jsonl per round: every finding, every lane
depth: 16
neverSweep: []
---

# /scan-sweep overlay for StatReel

Adopted 2026-10-04 (registry skill `scan-sweep`, linked by `ai-registry/scripts/link-registry.mjs`).
Read `CLAUDE.md` and `DESIGN.md` first; the repo law in `.claude/perfect/config.md` ("Repo law") binds
every sweep too.

## Gates

- always: `pnpm -s typecheck` (tsc -b) and targeted `npx vitest run <files>`; `pnpm -s test` before a round's last commit
- touched TS: `npx biome lint <touched files>` - never `--write` on directories (HEAD is not Biome-clean); `pnpm lint:ratchet` must stay green
- pipeline/**: `uv run --project pipeline pytest`
- policy/**: `opa test policy`
- pipeline/dbt/**: `pnpm check --only dbt` (dbt parse)
- whole offline suite: `pnpm check` (PASS/FAIL table) - run by the director after each wave
- slow: `pnpm e2e` (replay) - director only, at the end of the loop

## Never re-propose

The `/perfect` vault (`<vault>/Perfect/Perfect.md`, "Owner decisions waiting" and every note under
`directions/`) is this repo's decided backlog: shipped directions and parked owner decisions are not
findings. A sweep finding that needs one of the CLAUDE.md "ask the owner before" acts is Lane C
(operator-only), never built.

## Small contexts

Contexts under 10 files are swept with a same-group sibling as one round:
Calendar, Metrics & Sources UI + Heatmap UI; Projects & Produce Pipeline + Board, Library & Calendar
Services + Heatmap, Topics & Metrics Services.

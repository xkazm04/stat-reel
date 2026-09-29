---
vault: ["C:/Users/mkdol/Documents/Obsidian/statreel"]
vault_subdir: Contest
arena: .contest/arena
participants: "claude:claude-opus-5-5@xhigh,codex:gpt-6-sol@high,grok:grok-4.7@high"
judges: ""
variants: 3
timeout_min: 90
---

# contest overlay - StatReel

## Engines
All three CLIs resolve on PATH on Fox (`claude` 2.1.284, `codex` 0.155.1, `grok` 1.0.40); codex and grok
headless write paths probed 2026-09-29 before the first contest.

**Panel.** The owner runs StatReel contests with **no LLM judges**: the host's visual pass is evidence, the
owner's review is the verdict. With all three families competing a blind panel could not satisfy the
family rule anyway.

## Data
`scripts/stage-contest-data.py <out-dir>` builds the material from committed sources: the source
registry and use-case table (DESIGN.md Appendix A/B, later `data/registry/`), heatmap cells derived
from them by the §7 rule, the OFL fonts in `fonts/`, and sample projects/era figures marked
`synthetic` in `data/SCHEMA.md`. Once `warehouse.duckdb` exists, stage `meta.capabilities` and
`mart_era_adjusted` instead of the synthetic figures.

## Taste
- **Practical before spectacular.** The owner opens these pages to do the job - pick a feasible video,
  make it, ship it. A striking first frame that hides the next action loses.
- **Fun, fast, easy.** One obvious next action per screen; motion that explains (a cell turning Go, a
  video moving a stage), never motion that waits.
- **Brand carries into the work surfaces.** The landing's identity must survive translation into dense
  app pages (heatmap grid, studio library) - a brand that only works as a hero is a failure.
- **Type floors.** No body or label text a user must read below 12 px; numbers in tabular figures.
- **Honest absence.** "No source", "not tested yet" and "blocked by licence" never render identically.
- **Sports without borrowed marks.** No league/team logos, crests, athlete photos or broadcast frames -
  the identity is typographic, chromatic and data-driven.

## Skill improvement log
- 2026-09-29 brand-screens: multi-page variants (index/heatmap/studio) need a per-page host pass - visual-pass.mjs opens index.html only; the host measured all 3 pages x 1280/1920 + landing at 390 and found the field's one hard-constraint breach (A/3 landing, 28 labels < 12 px) on a page the seat reported as fixed.

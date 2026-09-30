---
name: board
description: "StatReel design-board loop for the product format: 30-90 s viz-led videos of stats evolving over time (matplotlib-style animated charts - bar-chart races, line races, streamgraphs; data time maps to video time; no narration). Each Board item is a full-run design (seek(t) + dataClock(t) artboard); the harness renders one 8 s cut-out from the middle of the run and measures longevity across it (monotonic data clock, coverage, no static stretches, seek-stability). The owner accepts or rejects (reject style / reject case / reject both); an Obsidian ledger carries the feedback into the next loop. Invoke with /board loop <id> [--shots 3], /board harvest <id>, /board sync, /board status."
version: 0.3.0
memory: vault
argument-hint: "loop <id> [--shots 3] [--participants specs] | harvest <id> | sync | status | import ..."
---

# Board - long-running data videos, judged by a cut-out

**The format (ADR 007).** A StatReel video runs 30-90 s and shows sports statistics **evolving over
time**: data time (seasons 1950→2026, a season race by race, a career start by start) maps to video
time. It is in the tradition of matplotlib animated charts: bar-chart races, line races,
streamgraphs, cumulative tallies. The visualization tells the story. There is no narration, only a
title, a data clock, sparse timed annotations and music. **Not** headlines, posters, punchline numbers
or hook-and-reveal shorts. That misunderstanding cost loops 001-004, which are now archived in
`Board/Archive/headline-era/`.

A Board item is **one full-run design**. The owner sees **one 8 s cut-out from the middle of the run**
(never the finale), so a design can't lean on its last frame, together with the harness's
**longevity** evidence for the whole run.

Everything runs through `scripts/board.mjs` (Node builtins, plus Playwright and ffmpeg from the
repo for frame capture and encoding). Its pure half, `scripts/lib.mjs`, is pinned by `node --test tests/test_lib.mjs`. The StatReel server
must be running on 127.0.0.1:8787.

## The loop

1. **Sync**: `node scripts/board.mjs sync`. Pulls every decision since the ledger cursor from
   `/api/board/feedback` into `<vault>/Board/ledger.json`. It also renders `Board/Ledger.md` (style and
   case tallies with the owner's notes) and appends `Board/Feedback.md`. It is idempotent by item id.
2. **Loop**: `node scripts/board.mjs loop --id <id> [--shots 3] [--timeout-min 60] [--participants ...]`. It:
   - stages **real time series** through the server's guarded `llm.*` query tool: race-by-race
     results, driver seasons, constructor seasons, bios and seasons. It pages past the tool's
     5000-row cap. Only **time-evolution** use cases are staged, never the legacy headline M1 case.
     Fonts and brand tokens are staged too;
   - renders `references/loop-brief.md` with the ledger. Accepted styles are the floor ("never copy
     one"). Rejected styles are anti-patterns, quoted with the owner's notes. Cases carry their tallies;
   - runs a contest round through the linked `contest` skill: default UI roster, owner review,
     `--vault-subdir Board/Contests`. Each variant is one artboard `index.html` plus `shot.json`;
   - patches the contest template's CDN and panel lines, because a board loop is offline and
     owner-reviewed.
3. **Harvest**: `node scripts/board.mjs harvest --id <id>`. `validateDesign` checks each `shot.json`:
   - 30-90 s `duration_s`
   - a `timeline {unit, from, to}` that runs forward
   - `chart_form`
   - a time-evolution use case, or a proposed case with `data_time`
   - a stable style id, and fact refs

   The artboard must expose `window.statreel.seek(t)` and `dataClock(t)`. The harness renders the
   **8 s cut-out centred at 45% of the run** frame by frame to an H.264 MP4, plus a poster. It runs
   the out-of-order **seek-stability** probe. It then samples 12 moments across the whole run for
   **longevity**: the data clock never runs backwards, covers at least 85% of the timeline and stalls
   for at most 30% of the run, and the picture changes (at most 30% identical samples). The findings
   travel as `source.clip` and show on the Board as badges.
4. **The owner reviews** at `/board`, then sync again. Repeat.

**Phases.** `lib.mjs:loopPhase` decides.
- **discovery** runs until the owner has made at least 12 decisions and accepted at least one style.
  Seats must deliver genuinely different visual languages, cover two or more cases, and propose at
  least one new case the data supports.
- **exploit** comes after that. Seats extend accepted styles onto cases the owner hasn't judged yet,
  and propose new cases in accepted styles.

## Rules every design must keep

- Real figures only: frames are computed from the staged rows, and every figure an annotation states
  is cited as `<fact_key>#<column>` in `shot.json`.
- The data clock advances monotonically for the whole run, and the picture is viz-led, with no
  narration and no text-led story.
- The attribution `Data: F1DB (CC BY 4.0)` is visible for the whole run.
- Vertical designs keep critical content inside the safe box for the whole run: top 270, bottom 670,
  left 65, right 130.
- No league, team, sponsor or broadcaster marks, and no athlete photos. Illustration must read as
  illustration.
- OFL fonts only. No network.

## Memory (Obsidian, `<vault>/Board/`)

| File | Holds |
|---|---|
| `ledger.json` | machine state: cursor, seen ids, per-style and per-case tallies, owner notes |
| `Ledger.md` | the same, readable |
| `Feedback.md` | append-only log of every decision with the owner's note |
| `Loops/<id>.md` | each loop's phase and the exact brief the seats read |
| `Contests/` | the contest instrument's own vault pages for board rounds |

Cost: one loop is one contest round, reported at roughly $30–60 for two seats at 45 min. Report the
seats' wall time and cost after each loop, from `.contest/arena/board-<id>/runs/*/record.json`.

## Skill improvement log

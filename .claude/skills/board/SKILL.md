---
name: board
description: "StatReel design-board loop for the product format: 30-90 s viz-led videos of stats evolving over time (matplotlib-style animated charts - bar-chart races, line races, streamgraphs; data time maps to video time; no narration). Each Board item is a full-run design (seek(t) + dataClock(t) artboard); the harness renders one 8 s cut-out from the middle of the run and measures longevity across it (monotonic data clock, coverage, no static stretches, seek-stability). The owner accepts or rejects (reject style / reject case / reject both); an Obsidian ledger carries the feedback into the next loop. Invoke with /board loop <id> [--shots 3], /board harvest <id>, /board sync, /board status."
version: 0.4.0
memory: vault
argument-hint: "loop <id> | harvest <id> [--strict] | mass --prefix <p> | cases <id> | harvest-cases <id> | sync | status | import ..."
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
   - a data-ready time-evolution use case, or a proposed case with `data_time` and a `sport` that has data-ready cells (F1 today; `dataReadyUseCases` is the one predicate for lanes, harvest and check.mjs)
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
- Attribution on screen and text inside the vertical safe box are gated by `check.mjs`
  (`attributionPresent`, `textOutsideSafeBox` in `scripts/lib.mjs` hold the numbers).
- No league, team, sponsor or broadcaster marks, and no athlete photos. Illustration must read as
  illustration.
- Every readable text is at least 28 px (owner rule; `check.mjs` measures DOM, SVG and canvas text).
- Generated images (grok `image_gen`) carry texture, mood or scene only, never data. Each is listed in
  `shot.json` `images[]` with its exact prompt (ending in the text ban) and role, is illustrated rather
  than photo-real, is never a figure in a slot naming a real person, and stays under 2.5 MB (15 MB per
  design). See `references/seat-addendum.md` and ADR 008.
- OFL fonts only. No network at render time.

## Libraries and the case loop (ADR 008)

- **Styles** (`/board?tab=styles`, `GET/PATCH /api/styles`): every style with its verdict. The owner
  locks signatures and retires styles. `sync` writes this into `ledger.style_status`, and the brief
  lists locked styles to rebuild faithfully and retired ones never to reuse. Chart forms with 5 or
  more designs on the Board are named as overused.
- **Case loop**: `node scripts/board.mjs cases --id cs-NNN [--count 8] [--participants ...] [--round N]`
  runs text-only seats, one domain per seat (sports beyond F1, games, geo-economy, music, culture and
  science, motorsport depth and wildcards, rotated by `--round`), with web search on. Each seat writes
  `variant-1/cases.json` and must pass `node data/check-cases.mjs`. That check requires at least 10
  years, at least 4 beats, a tension, unknowns, and sources with licence, plus real fact refs when
  `staged`. Then run `harvest-cases --id cs-NNN`, which de-duplicates and posts to `/api/cases`. The
  owner decides on the Use cases tab: accept, too short, no insight, no data, duplicate.
- A `new-source` idea never triggers ingestion. The owner approves a source, it is added to
  `data/registry/sources.yaml`, and only then is it ingested through `statreel_ingest`.
- **Mass design runs**: `mass --prefix <p> --participants <grok seats> --target N` repeats sync →
  loop → `harvest --strict` until N designs pass every check.

## Memory (Obsidian, `<vault>/Board/`)

| File | Holds |
|---|---|
| `ledger.json` | machine state: cursor, seen ids, per-style and per-case tallies, owner notes |
| `Ledger.md` | the same, readable |
| `Feedback.md` | append-only log of every decision with the owner's note |
| `Loops/<id>.md` | each loop's phase and the exact brief the seats read |
| `Contests/` | the contest instrument's own vault pages for board rounds |

Cost: a claude seat runs about $20 for 50 min; a grok-4.7 seat runs about $1.8 for 40 min (gk-001..006: 36 seat runs,
about $63, 108/108 designs passing). One loop is one contest round. Report the
seats' wall time and cost after each loop, from `.contest/arena/board-<id>/runs/*/record.json`.

## Skill improvement log

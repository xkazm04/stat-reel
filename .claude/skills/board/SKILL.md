---
name: board
description: "StatReel design-board loop. Generates static visual shots (one frame of a StatReel data-viz video at its strongest moment) for existing or newly proposed use cases, in candidate presentation styles. Posts them to the app's Board, where the owner accepts or rejects: reject style, reject case, or reject both. Learns from that feedback through an Obsidian ledger, which becomes the floor and the anti-patterns of the next loop. Early loops run like /contest --landing, to discover the best form of presentation and new use cases. Invoke with /board loop <id> [--shots 3], /board harvest <id>, /board sync, /board status."
version: 0.1.0
memory: vault
argument-hint: "loop <id> [--shots 3] [--participants specs] | harvest <id> | sync | status | import ..."
---

# Board - shots in, the owner's taste out

The Board is the owner's gate on visual direction (ADR 006). It is a huge grid of static shots, and
each one is judged on two axes:

- **style**: the form of presentation
- **case**: the use case, existing or proposed

Rejections name the axis they're about (reject style, reject case, reject both), so one loop teaches
the next precisely. This skill produces the shots and carries that feedback forward. The owner is the
only judge. There is no LLM panel.

Everything runs through `scripts/board.mjs` (Node builtins, plus Playwright from the repo for
screenshots). Its pure half, `scripts/lib.mjs`, is pinned by `node --test tests/test_lib.mjs`. The StatReel server
must be running on 127.0.0.1:8787.

## The loop

1. **Sync**: `node scripts/board.mjs sync`. Pulls every decision since the ledger cursor from
   `/api/board/feedback` into `<vault>/Board/ledger.json`. It also renders `Board/Ledger.md` (style and
   case tallies with the owner's notes) and appends `Board/Feedback.md`. It is idempotent by item id.
2. **Loop**: `node scripts/board.mjs loop --id loop-NNN [--shots 3] [--participants ...]`. It:
   - stages **real** data through the server's guarded `llm.*` query tool (use cases with feasibility
     cells, the era-adjusted view, driver seasons), plus the OFL fonts and the current brand tokens;
   - renders `references/loop-brief.md` with the ledger. Accepted styles are the floor ("never copy
     one"). Rejected styles are anti-patterns, quoted with the owner's notes. Cases carry their tallies;
   - runs a contest round through the linked `contest` skill: default UI roster, owner review,
     `--vault-subdir Board/Contests`. Each variant is one artboard `index.html` plus `shot.json`;
   - patches the contest template's CDN and panel lines, because a board loop is offline and
     owner-reviewed.
3. **Harvest**: `node scripts/board.mjs harvest --id loop-NNN`. Validates each `shot.json` (title,
   format, stable style id, a use case or a proposed case, figures as fact refs). It then screenshots
   the artboard at its exact size into `data/board/items/` and posts it to `/api/board` with its
   provenance.
4. **The owner reviews** at `/board`, then sync again. Repeat.

**Phases.** `lib.mjs:loopPhase` decides.
- **discovery** runs until the owner has made at least 12 decisions and accepted at least one style.
  Seats must deliver genuinely different visual languages, cover two or more cases, and propose at
  least one new case the data supports.
- **exploit** comes after that. Seats extend accepted styles onto cases the owner hasn't judged yet,
  and propose new cases in accepted styles.

## Rules the shots must keep

- Real figures only, each cited as `<fact_key>#<column>` in `shot.json`. Adjusted values are labelled
  "era-adjusted" and presented rank-led.
- The attribution `Data: F1DB (CC BY 4.0)` is on the frame.
- Vertical shots respect the safe box: top 270, bottom 670, left 65, right 130.
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

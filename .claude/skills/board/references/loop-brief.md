StatReel makes **30–90 second videos of sports statistics evolving over time**, in the tradition of
matplotlib animated charts: bar-chart races, evolving line races, streamgraphs, cumulative tallies,
distributions drifting through the decades. Data time (seasons 1950→2026, a season race by race, a
career start by start) maps to video time, and **the visualization tells the story**. There is no
narration and no voice. On screen: a title, a running data clock (the season or round), the chart
with its axes and labels, and a few timed annotations at the turns of the story. It plays with a music
bed.

This loop feeds the owner's **design Board**. Each variant you deliver is **one full video design**:
a complete 30–90 s run. The Board shows the owner **one 8-second cut-out taken from the middle of
your run**, not the ending, so the design has to hold up at any moment of the timeline. The owner
accepts or rejects it: reject the *style*, the *use case*, or both.

Not wanted, and rejected on sight: headline or poster designs, a single punchline number, a before
and after ("43rd → 1st"), a hook-and-reveal structure, anything whose story is told by text rather
than by the data moving through time.

Loop phase: **{{phase}}** ({{decisions}} owner decisions so far).

- **discovery:** your {{shots}} variants are {{shots}} genuinely different ways to show data over
  time. Vary the chart form, the visual language (colour, texture, type attitude), the pacing, and how
  the data clock is shown. Cover at least two use cases. One variant may **propose a new
  time-evolution use case** that the staged data supports.
- **exploit:** extend the styles the owner accepted onto use cases the owner hasn't judged yet.

## The material

Everything is in `data/`. Read `data/SCHEMA.md` first.

- **Real data only.** The series are race-by-race results, driver seasons, constructor seasons,
  driver bios and seasons. Compute your frames from these rows (cumulative sums, rolling windows,
  shares per season). Invent nothing. Any figure an annotation states is listed as a fact ref in
  `shot.json`.
- The time-evolution use cases, their data time, chart form and arc are in `data/usecases.json`.
  Only F1 data is tested today.

## What the owner has said so far (the Board ledger)

Accepted styles, the floor to build on (never copy one):
{{styles_accepted}}

Rejected styles, never repeat these:
{{styles_rejected}}

Use cases so far:
{{cases}}

Already on the Board and waiting for the owner. Do **not** repeat these styles, and do not repeat
these style + case pairings:
{{tried}}

## Making it work as a running video

- **Pacing.** The data clock advances monotonically over the whole run. Pick seconds per season (or
  per round) so the viewer can follow; slow down at the turns of the story and move faster through
  quiet stretches, but never stop the clock for long.
- **The clock and the picture agree on every frame.** The season or round printed on screen, `dataClock(t)`
  and the values drawn are the same moment. A new season appears only when its first race is drawn, and
  "round 16 / 16" never sits under the next season's year. Annotations disappear once their moment has
  passed (after their hold), so they never contradict the current values.
- **Readability in motion.** The running clock is always visible and large. Entities that move keep
  their identity (colour or label follows them); rank swaps animate so the eye can track them. Labels
  never flicker. Counters use tabular figures. **Every readable text is at least 28 px** in the
  artboard (ticks, legends and the attribution included). Text size is not part of any style.
- **Continuity.** The chart's frame (axes, scale, layout) stays stable. Rescale smoothly when values
  outgrow it, never jump. Nothing appears or disappears without a transition.
- **Annotations** are sparse, timed to the data (the moment a lead changes, a record falls, an era
  begins). Each is held at least 2 seconds and cites its fact refs.
- **Beginning and end.** At t = 0 the title and the chart frame are already readable. The run ends on
  the latest data with a short hold. The cut-out comes from the middle, so the middle has to be as
  good as the ends.
- In vertical designs, keep critical content inside the safe box (top 270, bottom 670, left 65,
  right 130) for the whole run.

## Deliverable, per variant (in addition to the contract below)

- `variant-N/index.html` is the artboard: `body { margin: 0 }` and one element exactly 1080×1920
  (or 1920×1080), with nothing outside it. Once fonts are ready it defines:

  ```js
  window.statreel = {
    duration: 72,           // the full run, 30-90 s
    seek(t) { /* draw the frame at t seconds: a pure function of t */ },
    dataClock(t) { return /* the data time shown at t, e.g. 1987.4 (season) or 13 (round) */; },
  };
  ```

  - `seek` may return a Promise. The frame must depend on `t` only: no CSS animation or transition,
    no timers, no accumulated state, no unseeded `Math.random()`, no `Date.now()`.
  - Opened normally in a browser the page plays itself (for example a `requestAnimationFrame` loop
    calling `seek`). With `?capture=1` in the URL it must not self-play: the harness drives it.
  - The harness renders your 8 s cut-out frame by frame and samples `seek`/`dataClock` across the
    whole run. That checks longevity: the clock advances monotonically, covers your timeline and never
    stalls; the picture keeps changing; frames revisited out of order are identical.
- `variant-N/shot.json`:

  ```json
  {"title": "...", "summary": "one sentence: what the data shows as time passes",
   "format": "vertical",
   "use_case_id": "career-wins-race",
   "proposed_case": null,
   "chart_form": "bar-chart race",
   "duration_s": 72,
   "timeline": {"unit": "season", "from": 1950, "to": 2026},
   "style": {"id": "kebab-case-stable-id", "name": "Style name", "notes": "the style in one sentence"},
   "facts": ["f1db:race:...#points_awarded"]}
  ```

  - `timeline.unit` is one of season, race, matchday, career-start, date, and `from`/`to` are
    numbers in that unit.
  - For a new case use `"proposed_case": {"name", "pitch", "data_time", "requires": [kinds]}` with
    `use_case_id: null`.
  - A style `id` is how the owner's feedback finds your style in later loops. Reuse an id only for the
    same style.

## Hard constraints

- The attribution `Data: F1DB (CC BY 4.0)` is visible for the whole run.
- No league, team, sponsor or broadcaster marks, and no athlete photos.
- Fonts only from `data/fonts/` (Barlow Condensed, Inter, JetBrains Mono; OFL). Numbers use tabular
  figures. No network.

# 007 - The format is 30-90 s viz-led videos of stats evolving over time

- Status: accepted
- Date: 2026-09-30
- Supersedes: the narrative-short framing in DESIGN.md §6.2-6.6 (hook → reveal → payoff, narration-led)
  and the "strongest moment" Board brief (ADR 006, board skill 0.1-0.2).

## Context

The owner stopped board loops 002-005. They had produced headline and poster designs ("Fangio
43 → 1", "0.5 points") with no longevity. The owner's words:

> "We aim to evolve matplot videos which have 30-90s visualizing stats over time in short videos.
> [...] The task to create short videos was to cut the long ranged videos and have overview how it can
> look. The use cases nor the styles cannot be realistically use for anything longer where we can let
> the data visualization tell the story."

Owner decisions, 2026-09-30:
- A Board item shows **one cut-out** of a full timeline.
- **Viz-led, no narration.**
- Archive the 24 off-brief items and reset the ledger.
- Correct the skill, the use cases and DESIGN now. The M1 composition rework follows once the Board
  shows a direction.

## Decision

- **Video.** 30-90 s. Data time (a season, race by race, 1950→2026, a career) maps monotonically to
  video time. Chart forms in the tradition of matplotlib animated charts: bar-chart races, evolving
  line, area and stream charts, cumulative tallies, ridgelines drifting through decades. On screen:
  a title, a running data clock (season or date), axes and labels, and a few timed annotations at the
  turns of the story, each held long enough to read. There is **no narration**. Audio is a music bed
  (plus optional SFX).
- **Use cases** are time-evolution formats. Each declares its data time, chart form, duration band
  and *arc*: what the visualization reveals as time passes. The headline format
  `era-adjusted-rankings` stays only as the **legacy** M1 walking skeleton (`family: headline`)
  until its composition is replaced. It is not offered to Board loops.
- **Board.** Each item is a design for a full timeline. The artboard implements the whole 30-90 s
  run (`seek(t)` over it, and `dataClock(t)` reporting the current data time). The harness renders
  **one 5-10 s cut-out** taken from the middle of the run, not the finale, so a design can't hide
  behind its last frame. It also measures **longevity** across the full run:
  - the data clock advances monotonically and covers the declared range;
  - the picture keeps changing (no long static hold);
  - frames are seek-stable.
- **New `llm.*` views** carry the time series the formats need: race-by-race results, constructor
  seasons, driver bios. Every row has a `fact_key`.

## Consequences (pending, tracked for the M1 rework)

- DESIGN §6.2 (composition model), §6.4 (audio: music only; TTS optional/unused) and §6.5 (captions:
  annotations instead of speech captions) are rewritten. The publish gate's "captions burned in" and
  CPS rules apply only when a video has speech. That policy change lands with the first
  time-evolution composition.
- The co-pilot's prompt pack changes from writing a script to choosing a story over time: data
  range, pacing, annotation beats.

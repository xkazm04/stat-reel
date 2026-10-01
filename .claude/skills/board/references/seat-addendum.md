
## How to work this round (read before you start)

**Your lane.** {{lane}} Start there. Variant 3 may instead propose a new time-evolution case that the
data supports. Your three variants must look like three different studios made them. Each needs its
own style `id`, and no style id may appear in the "Already on the Board" or "Rejected" lists of the
brief.

**Order of work, per variant:**

1. Read `BRIEF.md` and `data/SCHEMA.md` once. Decide the story over time. Example: "1950→2026, who
   holds the wins record and when it changes hands".
2. Start from the plumbing in `data/skeleton.html`. It shows data loading, precomputed states, a
   pacing curve, a pure `seek(t)`, `dataClock(t)` and capture-safe self-play. Keep that structure and
   throw its look away completely; it is not a style.
3. Write `variant-N/index.html` and `variant-N/shot.json`.
4. Run **`node data/check.mjs variant-N`** from your workspace. It is the harness that decides whether
   your design reaches the owner. Fix every `FAIL` line and rerun until it prints `PASS`. A variant
   that does not pass is discarded unseen.

**Mistakes that got designs rejected or flagged before:**

- **The year label ran ahead of the data.** "1988 · round 16/16" was printed over the 1987 bars. The
  printed season and round, `dataClock(t)` and the values drawn must come from the same data step.
- **Facts that do not exist.** Every entry in `facts` must be a real `fact_key` from `data/*.json`
  plus one of that row's columns (`<fact_key>#<column>`). Copy keys from the rows you used; never
  type them from memory.
- **Clock coverage.** `dataClock` has to sweep at least 85% of `timeline.from`→`timeline.to` over the
  run and must not stand still for long stretches. Hold the end for 2 s at most.
- **Use the safe box fully; keep the bands outside it non-critical.** In 1080×1920, critical content
  (clock, chart, labels, annotations) fills the safe box: top 270, bottom 670, left 65, right 130. The
  bands outside it may carry atmosphere such as texture or colour, but nothing the viewer must read.
- **Text too small for a phone.** In a 1080-wide artboard, anything the viewer must read is at least
  28 px, and the data clock is the largest element on screen.
- **Labels colliding during rank swaps.** Interpolate positions and keep labels attached to their
  bars, without overlap.
- **Non-pure frames.** CSS transitions, `setTimeout`, `Date.now()` or state carried between
  `seek()` calls all fail the seek-stability check.
- **The Indianapolis 500 rounds (1950–1960)** are a separate field. Exclude them (`is_indianapolis`)
  from wins and points races.
- **Data size.** Load the staged `.js` files with `<script src="../data/...js">`. Do not paste the
  data into your HTML.

**Budget.** Three variants that pass are worth far more than three ambitious ones that fail. Finish
one variant through `PASS`, then start the next.


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

- **The year label ran ahead of the data.** "1988 · round 16/16" was printed over the 1987 bars.
  `check.mjs` fails any sampled frame whose printed season is not `floor(dataClock(t))` (the clock is
  the largest year-bearing text). Optionally declare `window.statreel.frameFacts(t)` ->
  `{period, metric, scope, from, top: [{name, value}]}` (see `data/skeleton.html`): `check.mjs` then
  recomputes the standings from `data/f1_race_results.json` and fails a drawn value that is wrong or
  a leader that is missing. Not declared = not checked.
- **Facts that do not exist.** Every entry in `facts` must be a real `fact_key` from `data/*.json`
  plus one of that row's columns (`<fact_key>#<column>`). Copy keys from the rows you used; never
  type them from memory.
- **Clock coverage.** `dataClock` has to sweep at least 85% of `timeline.from`→`timeline.to` over the
  run and must not stand still for long stretches. Hold the end for 2 s at most.
- **Use the safe box fully; keep the bands outside it non-critical.** In 1080×1920 the clock, chart,
  labels, annotations and the attribution fill the safe box (`check.mjs` fails any text outside it and
  prints the numbers). The bands outside it may carry atmosphere such as texture or colour, but nothing
  the viewer must read.
- **Text too small: a hard failure.** Every readable text, including axis ticks, legends, labels, the
  attribution and canvas text, is at least 28 px in the artboard. `check.mjs` measures it at five
  moments and fails the variant otherwise (the same frames gate the safe box and the attribution). If a label cannot be 28 px, drop it: fewer, larger labels
  beat many small ones. Text size is not part of any style. When you build on an accepted style, raise
  all its text to 28 px or more. The data clock is the largest element on screen.
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

## Images: art that supports the data (encouraged)

You can generate images with your `image_gen` tool: textures, illustrated backdrops, scene art and
motifs. Combine them with the code-drawn chart so the video is well-executed art, not another plain
x/y chart. The rules:

- **Code draws everything checkable.** Bars, lines, axes, labels, numbers, the data clock and names
  come from the data in code. Images carry texture, mood and scene only. To texture a bar, use the
  image as a fill clipped by the bar shape that code draws from the data.
- **No text in any image.** End every prompt with "no text, letters, numbers, logos or watermarks".
  Avoid nouns that make the model write: scoreboards, jerseys, signage, tickets, dashboards, labelled
  maps. Describe shapes doing things instead. Look at each image and discard any that contain
  letters.
- **No quantities, trends or arrows in images.** A rising mural behind a chart claims a trend the
  data may not show.
- **No real people and no likeness.** Never put a generated figure where a real driver, artist or
  team is named. Use a monogram, silhouette shape or empty state there. No team, sponsor or league
  marks.
- **Illustrated, not photo-real.** Photo-real footage claims that a real event was filmed.
- **Leave room.** Say in the prompt where the chart, labels and clock will sit, for example "empty
  calm area in the centre third".
- **One look across a series.** Put your style first in every prompt (technique, palette with
  roles, finish) and keep it word for word between images of the same variant.
- **Files.** Save images inside the variant folder (for example `variant-1/img/`), convert them to
  JPG or WebP under 2.5 MB each (`ffmpeg -i in.png -q:v 3 out.jpg`) and keep the total under 15 MB.
  Delete unused files, and list every image in `shot.json` `images[]` with its exact prompt and
  role (texture, backdrop, scene, motif or fill). `check.mjs` enforces all of this.

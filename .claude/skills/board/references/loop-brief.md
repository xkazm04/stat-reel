StatReel turns licensed sports data into short narrated data-visualisation videos. This loop feeds
the owner's **design Board**: a huge grid of static shots that the owner accepts or rejects. They can
reject the *style*, the *use case*, or both. Each variant you deliver is **one clip of 5–10 seconds**:
the strongest moment of a StatReel video, in motion, as a viewer would see it on a phone (vertical
1080×1920) or, when the case needs width, landscape 1920×1080. The owner judges whether the style
**works as running video**, not only as a poster. A beautiful frame that can't move is a rejected
style.

Loop phase: **{{phase}}** ({{decisions}} owner decisions so far).

- **discovery:** find the best *form of presentation*. Your {{shots}} variants must be {{shots}}
  genuinely different visual languages (different composition, chart form, typography attitude,
  colour logic, texture). Across them, cover at least two different use cases. At least one variant
  should **propose a new use case** that the staged data actually supports.
- **exploit:** the owner has accepted some styles. Extend them (do not copy them) onto use cases the
  owner hasn't judged yet, and propose new cases in an accepted style.

## The material

Everything is in `data/`. Read `data/SCHEMA.md` first.

- **Real figures only.** Every number on a shot must come from a row in `data/` and be listed as a
  fact ref in `shot.json`. Adjusted metrics are estimates, so label them "era-adjusted" and lead with
  rank rather than decimals.
- The ten existing use cases, their required data kinds and today's feasibility are in
  `data/usecases.json`. Only F1 data (history, bios, live) is tested today, so a shot for another sport
  must be a *proposed* case and must name the data kinds it would need.

## What the owner has said so far (the Board ledger)

Accepted styles, the floor to build on (never copy one):
{{styles_accepted}}

Rejected styles, never repeat these:
{{styles_rejected}}

Use cases so far:
{{cases}}

Already on the Board and waiting for the owner. Do **not** repeat these styles, and do not repeat
these style + case pairings. Explore elsewhere, so the owner sees a wider field:
{{tried}}

## Motion: it has to work as video

Every clip is rendered **frame by frame**. The harness calls `window.statreel.seek(t)` for
t = 0, 1/30, 2/30, and so on, and screenshots each frame. Moments are also revisited **out of order**
to check that the frame is a pure function of t, because the real video renderer (Remotion) renders
frames in parallel and out of order.

- The frame at time t must depend on t only:
  - No CSS `animation` or `transition`, no `setTimeout` or `setInterval` driving the picture, no
    state that accumulates between frames.
  - No `Math.random()` without a seed, no `Date.now()`, no `performance.now()`.
  - A clip that fails the probe is flagged "not seek-stable" on the Board.
- **Frame 0 already reads.** Videos start there and viewers swipe in the first second, so the hook
  line or headline number is legible from t = 0. It may be animated, but it must not be blank.
- The clip **builds and lands**. Motion carries the meaning (a line draws, ranks move, a numeral
  rolls to its value), then the whole frame **holds, readable, for at least 1.5 s**. Nothing the
  viewer must read moves while it's being read.
- Pace for a phone: easing, not jitter. Any count-up uses tabular figures. Keep motion calm enough to
  read on a 6-inch screen.
- In vertical clips, keep the caption band (y 1040–1250) free of anything the viewer must read,
  because burned-in captions go there in the real video. The safe box applies throughout the clip,
  not only on the last frame.
- It may loop (the end flows back into the start) or end on the hold. Say which in `NOTES.md`.

## Deliverable, per variant (in addition to the contract below)

- `variant-N/index.html` is the artboard: `body { margin: 0 }` and one element exactly 1080×1920
  (or 1920×1080), with nothing outside it. It defines, synchronously once fonts are ready:
  `window.statreel = { duration: <5-10>, seek(t) { /* draw the frame for t seconds */ } }`.
  `seek` may return a Promise. Opened normally in a browser, the page should also play itself for
  preview (for example a `requestAnimationFrame` loop that calls `seek`). With `?capture=1` in the
  URL it must not self-play: the harness drives it.
- `variant-N/shot.json`:

  ```json
  {"title": "...", "summary": "one sentence: what the frame says",
   "format": "vertical",
   "use_case_id": "era-adjusted-rankings",
   "proposed_case": null,
   "style": {"id": "kebab-case-stable-id", "name": "Style name", "notes": "the style in one sentence"},
   "duration_s": 8, "poster_t": 6.5, "fps": 30,
   "facts": ["f1db:driver:juan-manuel-fangio:era-adjusted#rank_adjusted"]}
  ```

  - Use `"proposed_case": {"name", "pitch", "requires": [kinds]}` with `use_case_id: null` for a new
    case.
  - A style `id` is how the owner's feedback finds your style in later loops. Reuse an id only for the
    same style.
  - `poster_t` is the moment used as the still on the Board grid; choose one inside the hold.

## Hard constraints

- The attribution `Data: F1DB (CC BY 4.0)` is visible on the frame.
- In vertical shots, keep critical content inside the safe box: top 270, bottom 670, left 65,
  right 130.
- No league, team, sponsor or broadcaster marks, and no athlete photos. Illustration is welcome and
  must read as illustration.
- Fonts only from `data/fonts/` (Barlow Condensed, Inter, JetBrains Mono; OFL). Numbers use tabular
  figures. No network.

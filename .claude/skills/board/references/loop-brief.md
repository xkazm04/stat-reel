StatReel turns licensed sports data into short narrated data-visualisation videos. This loop feeds
the owner's **design Board**: a huge grid of static shots that the owner accepts or rejects. They can
reject the *style*, the *use case*, or both. Each variant you deliver is **one static shot**: a single
frame of a StatReel video at its strongest moment, as a viewer would see it on a phone (vertical
1080×1920) or, when the case needs width, landscape 1920×1080.

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

## Deliverable, per variant (in addition to the contract below)

- `variant-N/index.html` is the artboard: `body { margin: 0 }` and one element exactly 1080×1920
  (or 1920×1080), with nothing outside it. It is screenshotted at that size.
- `variant-N/shot.json`:

  ```json
  {"title": "...", "summary": "one sentence: what the frame says",
   "format": "vertical",
   "use_case_id": "era-adjusted-rankings",
   "proposed_case": null,
   "style": {"id": "kebab-case-stable-id", "name": "Style name", "notes": "the style in one sentence"},
   "facts": ["f1db:driver:juan-manuel-fangio:era-adjusted#rank_adjusted"]}
  ```

  - Use `"proposed_case": {"name", "pitch", "requires": [kinds]}` with `use_case_id: null` for a new
    case.
  - A style `id` is how the owner's feedback finds your style in later loops. Reuse an id only for the
    same style.

## Hard constraints

- The attribution `Data: F1DB (CC BY 4.0)` is visible on the frame.
- In vertical shots, keep critical content inside the safe box: top 270, bottom 670, left 65,
  right 130.
- No league, team, sponsor or broadcaster marks, and no athlete photos. Illustration is welcome and
  must read as illustration.
- Fonts only from `data/fonts/` (Barlow Condensed, Inter, JetBrains Mono; OFL). Numbers use tabular
  figures. No network.

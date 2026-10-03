# 005 - "On Air" is the brand and UI baseline; the product shows real data only

- Status: superseded by [009](009-photo-finish-single-theme.md) (the "On Air" theme is removed; the real-data-only rule stands)
- Date: 2026-09-30
- Affects: DESIGN.md §6.1 (screens), §6.5 (typography/brand), `packages/design-tokens`, `apps/studio`,
  video theme in `packages/compositions`

## Context

The first design contest (`brand-screens`) ran without the landing-specific `--landing` preset. Its
variant A/3 "Patchbay" served as a temporary baseline while M1 was finished. The owner then reran the
contest with `--landing` (contest 1.8.0: seats claude-sonnet-5.5@max + claude-opus-5.5@xhigh, owner
review, landing bar) and the same requirement brief (`landing-screens`).

## Decision

- Owner verdict: **A/1 "On Air"** wins. In the owner's words: "throw current UI and make this UI as new
  baseline with aim to complete the DESIGN.md and wire functionality implemented to work with real data
  from now on".
- The brand is a broadcast package for a one-person sports channel:
  - night-stadium ground, with volt `#d6ff3f` reserved for "cleared to air";
  - broadcast parallelograms and display-scale Barlow Condensed;
  - status as shape + pattern + label;
  - one drawn ident and colour per format.
- `packages/design-tokens/src/tokens.css` holds the A/1 tokens (OFL fonts self-hosted). `videoTheme`
  follows the same palette, so the videos and the studio read as one brand. Composition golden hashes
  were updated deliberately.
- The Patchbay studio is removed. The new studio implements all seven DESIGN §6.1 screens:
  - Front (landing)
  - Heatmap
  - Projects
  - Studio
  - Render & Gate
  - Publish
  - Metrics
  - plus Sources
- **Real data only.** Every number on screen comes from the API: registry, tested capabilities,
  heatmap, projects, props, renders, publications, metrics. Missing data is an honest, labelled empty
  state, never a sample. Dry-run publications say they have no platform metrics.

## Consequences

- The contest's synthetic staging is design material only. Nothing from it ships.
- A future rebrand swaps `packages/design-tokens` and the studio styles. The server and packages don't
  change.

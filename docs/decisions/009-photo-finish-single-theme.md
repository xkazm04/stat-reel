# 009 - Photo Finish is the single studio theme

- **Status:** accepted (2026-10-03; owner answered Q1)
- **Date:** 2026-10-03
- **Spec:** [`docs/specs/2026-10-03-app-refresh/SPEC.md`](../specs/2026-10-03-app-refresh/SPEC.md) (A, B)
- **Affects:** `packages/design-tokens`, `apps/studio` (theme runtime, Nav, Wordmark, Front, Heatmap, Projects, Calendar, Board styles), `DESIGN.md` §2/§6.1/§10. Supersedes ADR 005 and supersedes ADR 006 in part.

## Context
- ADR 005 set "On Air" as the brand baseline. ADR 006 added Photo Finish as a second theme, switchable in the studio.
- Two themes double the CSS and TSX branching: `useTheme()` branches in Front, Heatmap, HeatmapCell and Projects, plus `[data-theme]` blocks in five stylesheets.
- The owner has decided to build on Photo Finish only.
- The theme is client-only state (`localStorage["statreel.theme"]`). No server setting exists.

## Decision
1. Photo Finish is the only studio theme. Delete the On Air tokens, the theme switch, the `ThemeProvider` and its branches, and the On Air-only components and styles.
2. `<html data-theme="photofinish">` stays as a static attribute, so the existing scoped selectors keep working. The Photo Finish tokens also resolve on `:root`. Flattening the selectors is optional (T12).
3. **Migration:** on boot, delete any stored `statreel.theme` value. Every browser lands on Photo Finish.
4. **Helpers:** `onair.ts` is renamed `display.ts`, keeping its generic helpers and deleting the dead ones.
5. **Frame Stat icon:** the wordmark gets the Frame Stat icon (concept C) before "STAT".
   - The Barlow Condensed STAT|REEL typography and the clay-red finish line don't change.
   - Geometry lives once in `packages/design-tokens/src/logo.ts` and is shared by the studio, the favicon and the video end card.
   - Colours: graphite frame, sheet-coloured cut-outs, and a signal-red leading bar.
6. **Video palette (owner decision, 2026-10-03):** `videoTheme` moves to Photo Finish as well: the sheet background, graphite text and one clay-red signal, with text contrast of at least 4.5:1. The export name stays the same, so callers don't change. Generated videos (ADR 010) start from this palette.
   - Values: ground `#eceff2`, surface `#ffffff`, graphite ink `#12161a`, muted `#38414a`, dim `#56616c`, hairlines `#c6ced5`, signal `#e4432a` (strokes and fills), brand `#b8321a` (`accentInk`: any text in the signal colour, because `#e4432a` on the sheet is only about 3.6:1).
   - Burned captions: graphite on a translucent sheet plate (`rgba(245, 247, 249, 0.94)`), active word in the brand red. `video-theme.test.ts` asserts at least 4.5:1 for every text colour (and the plate over both the sheet and graphite).
   - Rows faded on purpose by the slopegraph's focus dimming (opacity) are a deliberate de-emphasis and are not part of the contrast assertion.

## Consequences
- Less CSS and TSX, one visual language, and simpler tests. The On Air "broadcast" front page goes away.
- Screenshot diffs guard the removal of shared CSS (spec A.3).
- ADR 005's status becomes "superseded by 009". ADR 006 becomes "superseded in part by 009: modules remain, the second theme is removed".
- **Reference images change:** M1 `EraAdjustedSlope` and the burned captions change appearance. Composition golden hashes, caption snapshots and any frame/thumbnail expectations **must be regenerated deliberately** in one reviewed commit (spec task T2b).

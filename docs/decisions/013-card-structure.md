# 013 - Cards: one shared structure for every screen

- Status: accepted
- Date: 2026-10-04
- Source: the brand-screens contest, variant A/3 ("modules" with a header row on a faceplate), restated in Photo Finish (ADR 009).

## Context

Our screens were bare content on one flat sheet, divided only by hairlines: a table, a toolbar, an empty
state and a stat strip all sat at the same level, so a page had no figure and ground and sections were
hard to scan. The contest variant solved this by wrapping every section in a raised module with a header
row, and sub-sections in recessed insets. Our content has diverged since, but the technique carries over.

## Decision

- **One component, `components/Card.tsx`, plus `CardGrid` and `Band`.** A card is a raised white sheet
  (hairline edge, soft shadow, 8 px radius) with an optional header (title, mono tag, actions), a body and
  an optional footer. A card inside a card is a recessed well with no shadow (a React context tracks depth).
- **Parameters are data, the look is CSS** (`styles/card.css`, tokens `--card-*` in `theme-photofinish.css`):
  `title`, `tag`, `actions`, `footer`, `tone` (paper / well / signal), `elevation` (0-2), `pad`
  (none / sm / md / lg), `accent` (a coloured top edge), `scroll`, `stickyHead`, `busy`, `as`, `level`,
  `titleId`, `titleTabIndex`, `testId`. `CardGrid` lays cards out in responsive columns; `Band` is a titled
  group of cards (number, title, lede). `.card-surface` gives the same skin to bespoke containers.
- **Where it applies** (audit of every page): Calendar (channels with a nested card per channel, ready,
  week, slots), Sources (registry card with its filter toolbar, tested capabilities), Metrics
  (publications, per-use-case and per-sport cards), Rundown (race sheet, list), Board (counts, filters,
  queue strip, tabs, use-case and style groups), Heatmap (topics grid card with legend toolbar; the
  feasibility grid and the cell layer's summary, photo-finish, capability tests, side notes), Studio
  (control-room stage bar and the four panels; Render & gate: video, gate, checks, manifest).
- **Where it does not:** the Front (full-bleed scenes with their own art direction), the board wall's
  tiles and lightboxes (media, not text structure), and the video player frame.
- Structure rules: a page that is a stack of cards uses `page--cards` (one 16 px rhythm; `Defer`
  wrappers add no box); tables go in `pad="none"` cards with a `card__toolbar` for their filters; the
  header carries counts and actions, the footer carries keys and legends.

## Consequences

- Sections are findable at a glance and new pages get structure by composition, not by new CSS.
- Existing stable ids, focus targets and test ids are kept (`titleId`, `testId`).
- Photo Finish's "rules, not shadows" line is relaxed by the owner for section containers; instruments
  inside a card (grids, lanes, tables) keep their rules.

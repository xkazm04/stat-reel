# 006 - Two winning themes (A/1 dark, A/3 light), shared modules, Calendar and Board

- Status: accepted; superseded in part by [009](009-photo-finish-single-theme.md): the modules (Calendar, Board) remain, the second theme is removed
- Date: 2026-09-30
- Supersedes part of: ADR 005 (one baseline, A/1). Affects DESIGN.md §6.1.

## Owner decisions (verbatim)

- "lets port also A/3, extend UI per my requirements and wire with DESIGN.MD, adjust A/1 to have same
  new modules. We will keep for some time both variants as winners, A/1 for dark theme, A/3 for light -
  until one variants become more dominant and wins in the future"
- Landing (A/3): "Remove section The instrument"; "Design and add subtle pattern or elements to
  decorate the sections to escape pure gray background".
- Heatmap: "two-layered structure, dedicating heatmap independently, with detail on click inside as
  new layer", so both layers can spread as the app grows.
- Studio (A/3): remove the project-list side panel. The parent rundown already lists projects. Track
  timeline full width, video player as the centred main content, the script as a modal opened from
  an interactive element, and the sides kept for parametrisation.
- "Studio should be focused on composing the video, for publishing itself we can use separate module
  called 'Calendar' with channel management and timing on top of successfully composed videos".
- New screen **Board**: a huge grid of visual-only outputs and use-case ideas, with expandable detail
  and a human gate: accept, **Reject style**, **Reject case**, **Reject both**. Three page variants
  prototyped first. Items are generated at skill level by a design skill with Obsidian memory that
  loops on the feedback. The first loops work like `/contest --landing`.

## Decision

- **Themes.** One React studio and one module structure, with two themes selected by `data-theme`:
  - `onair` (A/1, dark)
  - `photofinish` (A/3, light)

  A shared semantic token vocabulary lives in `packages/design-tokens`, with one file per theme.
  Theme-specific set pieces are allowed only where the concept demands them: A/1's tilted programme
  monitor, A/3's finish-line strip. The owner switches themes in the nav, and the choice persists per
  browser.
- **Screens** (DESIGN §6.1 revised):
  - Front
  - Heatmap: grid layer, then a cell detail layer
  - Rundown (projects)
  - Studio: compose only, plus the Render & Gate tab
  - Calendar: channels and scheduling
  - Board
  - Metrics
  - Sources

  The Publish tab moves out of Studio into Calendar.
- **Calendar.**
  - `channels`: platform, name, mode (dry or live), connection state.
  - `schedule`: a gated render on a channel at a time, with status.
  - A server scheduler tick publishes due items through the existing publish job (private only).
  - "Publish now" means scheduling at the current time.
- **Board.**
  - `board_items`: an image, title, summary, use case (existing or proposed), style, provenance, status,
    decision, note.
  - Decisions are `accept | reject_style | reject_case | reject_both`, each with an optional note.
  - The design skill reads decisions back through the API and writes them into its Obsidian ledgers.
  - Nothing synthetic is ever shown as a real result. Board items are labelled design outputs.

## Consequences

- The Remotion video theme stays `onair` for now; a per-channel video theme is future work.
- When one theme clearly dominates, delete the other theme file and its set pieces. The modules are
  shared, so nothing else changes.

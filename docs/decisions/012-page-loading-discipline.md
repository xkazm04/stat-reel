# 012 - Page loading: lazy routes, staggered arrival, transitions, revalidating reads

- Status: accepted
- Date: 2026-10-03
- Extends: ADR 006 (two themes, studio modules). Standards consulted: registry `page-load-pipeline`,
  `motion`, `async-ui-states`, `lazy-section-addressability`.

## Context

The studio shipped as one bundle (every screen, the Remotion player, all three Board variants), each
screen mounted everything in one commit, route changes cut instantly, and the server sent every
`/api` response uncompressed with no revalidation and the built assets with no cache headers.

## Decision

**1. Lazy loading.**
- Every route is its own chunk (`lazyRouteComponent`); `defaultPreload: "intent"` fetches it on hover or focus.
- `@remotion/player` is behind `components/LazyProgramme.tsx` (`Slate` moved to its own file, shown while the player loads).
- The script dialog and each Board tab and variant load on demand.
- Each route `loader` starts that screen's queries (`warm(...)`) so data and chunk load in parallel.
  Loaders never await the data; the screen renders its own skeletons from the same cache entries.
- Both fronts share `routes/useProgramme.ts` so neither theme's chunk pulls in the other.

**2. Staggered arrival (top to bottom).**
- `components/arrive.tsx` `<Defer tier>` holds a section back by `tier x 70 ms` (cap 420 ms) on an idle slice.
- A same-size placeholder reserves the space and keeps the section's grid cell (no layout shift).
- Nested Defers start counting when the parent mounts, so a section's children cascade after the section.
- `visible` also waits until the placeholder is within 240 px of the viewport.
- Tiers: hero/header 0; primary content 1; secondary 2-3; below-the-fold `visible`.
- Kept atomic (not deferred): the Heatmap grid (ARIA grid + roving focus registry; back-focus runs against its DOM) and anything a deep link needs at once.

**3. Transitions.**
- Each screen's `<main>` eases in once (opacity + 10 px rise, 240 ms, `--ease-out`).
- A Defer section fades in once.
- `backwards` fill, so no transform survives and `position: fixed` descendants are not trapped.
- A Defer with an `id` is one-shot: a revisit in the same session mounts at once, without the fade.
- Pending UI (`PagePending`, `.loading`) shows only after 150 ms and then stays 250 ms.
- Reduced motion removes every animation here; the staggered mount stays because it spreads work, not motion.
- The parallelogram wipe (ADR 006) is untouched.

**4. Anchors.** A pending section keeps its `id` on the placeholder (`anchor`) and mounts at once when the URL hash names it.

**5. Server.**
- `GET /api/*` is gzipped, carries a strong ETag and `Cache-Control: no-cache`, so unchanged JSON is a bodyless 304.
  Heatmap JSON: 53 KB to 3 KB gzipped.
- `/events`, `/files` and `/mcp` are never compressed or buffered.
- Built `/assets/*` (content-hashed) are `immutable, max-age=1y`; `index.html` and the SPA fallback are `no-cache`.

## Consequences

- First paint of a screen no longer waits for the Remotion player, the other theme's front, or sections below the fold.
- Placeholder heights (`minHeight`) are estimates; revisit if a section's real height drifts far from its placeholder.
- `/files` (renders, audio) still has no conditional-request handling; not changed here.
- Not done: font preloading. Vite hashes the font URLs referenced from `tokens.css`, so a preload needs a build plugin. Fonts already use `font-display: swap`.

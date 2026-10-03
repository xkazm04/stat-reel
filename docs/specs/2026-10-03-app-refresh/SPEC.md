# StatReel app refresh: implementation spec (2026-10-03)

- **Status:** revision 2 (2026-10-03), with the owner's answers to Q1–Q7 applied (see "Decisions (2026-10-03)"). Read-only analysis; no app code was changed.
- **Scope:** four changes. (a) remove the "On Air" theme, (b) add the Frame Stat icon to the wordmark,
  (c) redesign `/heatmap` as topic × video ordinal, (d) Board: hide rejected items and add a background
  generation queue (Claude Code CLI) triggered by accepts.
- **Revision 2:** applies the owner's answers to Q1–Q7. Changed sections: Decisions (new), A.4, C.3/C.4/C.6/C.7, D.1, D.2, D.4 (separate worker process), D.5 (web + `fetch_asset`, no caps), D.6–D.9, D.11–D.13, D.14 (new), E (T2b new, T4/T5/T7/T8/T10/T14 changed), F.
- **Inputs read:** `CLAUDE.md`, `DESIGN.md`, ADR 001–008, `apps/server/src/*`, `apps/studio/src/*`,
  `packages/{design-tokens,llm,schemas,compositions}`, `e2e/m1.spec.ts`, `.claude/skills/board/SKILL.md`,
  `image-triage/ART-DIRECTION.md`, `image-triage/video-v2/{logo/LOGO.md,TIMING.md,REVIEW.md}`, the box
  prototypes (`proto/src/sv2/eventstack.tsx`, `proto/src/timing/timing.mjs`, `statreel-logo.mjs`,
  `poweredby3.tsx`), a read-only copy of `data/app.sqlite` (2026-10-01 22:34 CEST state) and `claude --help`
  (Claude Code 2.1.288 on the owner's PC).
- **ADR drafts beside this file:** `ADR-009-photo-finish-single-theme.md`, `ADR-010-generation-job-queue.md`,
  `ADR-011-topic-activity-heatmap.md`. Move each one to `docs/decisions/NNN-…` in the task that implements it
  (CLAUDE.md: update DESIGN.md and add an ADR when a decision changes).
- **`reference/`:** copies of the box-only prototypes the tasks port, because `proto/` exists only on the box
  and not in the PC repo: `eventstack.tsx.txt`, `timing.mjs.txt`, `statreel-logo.mjs.txt`, `poweredby3.tsx.txt`,
  `make-plan-v3.mjs.txt`, `C-frame-stat-master.svg`, `LOGO.md`, `TIMING-search-box-wars-v2.md`. They are
  reference material only. Port them into packages and never import them from the docs folder.

---

## 0. Facts that shape the design (verified)

| Fact | Where | Consequence |
|---|---|---|
| Theme is client-only: `localStorage["statreel.theme"]`, plus an inline script in `apps/studio/index.html`. The server `settings` table is empty and has no theme key. | `apps/studio/src/theme.ts`, `index.html`, the sqlite copy | (a) needs only a client-side migration. No DB migration. |
| `theme-onair.css` owns `:root` (the default), and `theme-photofinish.css` is scoped to `[data-theme="photofinish"]`. Unscoped studio CSS is the On Air dressing; Photo Finish overrides it through `[data-theme="photofinish"] …` selectors (studio.css 104, photofinish.css 71, board.css 37, pages.css 17, calendar.css 17). | design-tokens, studio styles | Keep `data-theme="photofinish"` on `<html>` permanently, so every scoped override still applies. Delete only On Air-scoped rules. Flattening the selectors is an optional later task. |
| A table named **`jobs`** already exists (render, audio, publish, LLM: `JobRunner`, one job per kind, `resume()` re-queues `running`). | `apps/server/src/{db,jobs}.ts` | The new queue gets its own table, **`generation_jobs`**, so it doesn't collide with `jobs` or change its semantics. |
| `case_ideas`: 114 rows (106 pending, 6 accepted, 2 archived, 0 rejected). **All 6 accepted ideas are `data_status = new-source`.** | sqlite copy | A real-data video can't be generated for any accepted case today. The ethics layer forbids fetching unapproved sources (CLAUDE.md). So `generate_video` is **data-gated** (D.6). Visual options may use clearly labelled sample data. |
| `board_items`: 138 rows (73 pending, 9 accepted, 31 rejected, 25 archived). The 9 accepted items are all registry F1 use cases, made by the `board` skill. | sqlite copy | No automatic backfill enqueue on deploy. Only new accepts trigger jobs, and legacy accepted items get a manual "Generate video" button. |
| `projects` = 0 and `renders` = 0 in the owner's app DB (e2e runs use their own DBs via `STATREEL_APP_DB`). | sqlite copy, `playwright.config.ts` | The new topic heatmap starts **empty** for the owner, so its empty states are first-class. |
| Claude Code 2.1.288 has `-p/--print`, `--output-format stream-json`, `--verbose`, `--model`, `--fallback-model`, `--effort`, `--permission-mode {acceptEdits,auto,bypassPermissions,manual,dontAsk,plan}`, `--permission-prompts {host,none}`, `--tools`, `--allowedTools`, `--disallowedTools`, `--restricted`, `--add-dir`, `--mcp-config`, `--strict-mcp-config`, `--max-budget-usd`, `--no-session-persistence`, `--settings`, `--append-system-prompt`, `--json-schema`. **No `--max-turns`** in `--help`. `--system-prompt-file` isn't listed separately (it's only mentioned in the `--bare` text). | `claude --help` on the PC | The runner uses only the listed flags. The existing co-pilot passes `--system-prompt-file` (`packages/llm/src/index.ts:84`). Verify that it still works (risk R7). |
| The claude binary resolves to `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe` (present). `resolveClaudeBin()` already handles this. | PC, `packages/llm` | Reuse `resolveClaudeBin()` and spawn without a shell. |
| Registry subjects exist. `data-video-virality` → `knowledge/media-generation/narrative-craft/data-video-virality/data-video-virality.md`; `data-video-art-direction` → `knowledge/media-generation/visual-generation/data-video-art-direction/data-video-art-direction.md` (via `index.json`). | `C:\Users\mkdol\dolla\ai-registry` | Resolve through `index.json` and never build paths by hand (`.claude/rules/ai-registry-access.md`). |
| ART-DIRECTION.md says event-card transitions **vary by card type** (flash, page-flip, wipe, slide, stamp). The owner's new rule: **side reveal only, alternating left/right.** | `image-triage/ART-DIRECTION.md` §6 | The owner's rule wins. Record the deviation in ADR 010, and update ART-DIRECTION.md and the registry technique `event-card-stack` (a registry contribution, owner-gated). |

---

## Decisions (2026-10-03)

On 2026-10-03 the owner answered the open questions Q1–Q7 from the first draft. This revision applies those answers throughout the spec and the ADR drafts.

| # | Decision | Where it lands |
|---|---|---|
| Q1 | **Yes.** The video palette (`videoTheme`, the M1 `EraAdjustedSlope`) moves to Photo Finish. Reference and snapshot images (golden hashes, board/e2e screenshots) will change and must be **regenerated deliberately**. | A.4, task **T2b**, ADR 009 |
| Q2 | A topic is a **broad domain**: a type of sport (Formula 1, football, boxing…) or a geo-economic discipline (energy, markets, demographics…). A **controlled topic list** (table `topics`, seeded from the existing domains and sports) is the only allowed value set. `case_ideas.topic` references `topics.key` (an FK, validated in the service). The free-label idea is dropped. | C.3, C.4, C.7, T5, ADR 011 |
| Q3 | **Yes.** The Styles tab also hides rejected styles, with undo. | D.1, T4 |
| Q4 | **Yes.** Accepting one visual variant auto-archives its two siblings, in the same transaction. Undo restores them. | D.2, D.9, T10 |
| Q5 | Generation sessions **may use WebSearch/WebFetch** to find assets (e.g. transparent logos on Wikimedia Commons). They **download only through a constrained StatReel MCP tool** (`fetch_asset`) into the job's work folder, still with **no Bash**. Each asset's source and licence go to `out/assets.json`. The session runs in print mode and exits by itself when done. Uncertain mechanics are listed as open items **O1–O4**. | D.5, D.6, D.8 rule 3, D.12, T8, ADR 010 |
| Q6 | **No.** The co-pilot never waits. Generation runs in a **dedicated, separate worker process** (`pnpm worker`), isolated from co-pilot traffic. The queue still runs one job at a time. | D.4, T7, ADR 010 |
| Q7 | **No budget or timeout limits for now.** The config fields stay optional and **unset by default**: `--max-budget-usd` and the wall-clock timeout apply only when configured. Provider budgets get a placeholder section. | D.5, D.14 "Provider budgets (needs user input)" |

---

## A. Remove the "On Air" theme (build on Photo Finish)

### A.1 Every reference (inventory)

**Tokens and theme runtime**
- `packages/design-tokens/src/theme-onair.css`: delete.
- `packages/design-tokens/src/tokens.css`: drop `@import "./theme-onair.css"` and fix the header comment.
- `packages/design-tokens/src/theme-photofinish.css`: change the selector to `:root, [data-theme="photofinish"]` (and in its reduced-motion block too).
- `packages/design-tokens/src/shared.css`: header comment.
- `packages/design-tokens/src/index.ts`:
  - `themes = ["onair","photofinish"]`, `ThemeName`, `themeScheme`: reduce to `["photofinish"] as const`, or delete them together with their callers;
  - `statusGlyphs`, `licenceColors` and `identColors` carry On Air hex values. Check their usage (composition/video only, if any).
  - Keep `videoTheme` (A.4).
- `apps/studio/src/theme.ts` and `theme.test.ts`: `THEME_LABEL`, `THEME_SCHEME_WORD`, `resolveTheme`, `otherTheme`, `ThemeProvider`, `useTheme`, and the meta theme-color `#05070c`.
- `apps/studio/index.html`: `data-theme="onair"`, `<meta name="theme-color" content="#05070c">`, `color-scheme: dark light`, the inline theme script, and the **favicon** (the On Air volt plate, see B).
- `apps/studio/src/main.tsx`: `import "./styles/onair.css"` and `ThemeProvider`.
- `apps/studio/src/components/Nav.tsx`: `ThemeSwitch` (data-testids `theme-onair` / `theme-photofinish`).

**Theme branches in TSX** (`useTheme()` / `theme === "photofinish"`)
- `router.tsx` `FrontRoute` (On Air → `routes/Front.tsx`, PF → `routes/FrontPhotoFinish.tsx`).
- `routes/Heatmap.tsx`: the On Air rights grid from about line 297, and `pf` swapping rows and columns.
- `routes/HeatmapCell.tsx`: line 34/48 clip path, line 215 label, line 295, and the On Air rights-sheet rows from about line 465.
- `routes/Projects.tsx:113`: the On Air six-column board.
- `components/finish.tsx:36` (ModeSwitch).
- `components/Wordmark.tsx`: On Air `oa-mark` plus `Mark`.
- `components/glyphs.tsx:59`: the On Air disc/half-disc glyph set, and `Mark` at line 158.
- `studio/StudioLayout.tsx`: the slanted stepper (check its CSS in studio.css).

**On Air-only files**
- `routes/Front.tsx` (1054 lines). **Caveat:** `FrontPhotoFinish.tsx:61` imports `useProgramme` from it. Move `useProgramme` to `components/useProgramme.ts` first.
- `components/Ticker.tsx` (only Front.tsx uses it).
- `components/idents.tsx`: the `Ident` component (Front only) goes. **Keep** `identVar`, which 9 modules use.
- `styles/onair.css` (88 lines).
- `styles/front.css` (1536 lines): mostly the On Air front, but some selectors may be shared (`.monitor*` from `Programme`/`Monitor`, `.chain`, `.verdict`, `.strip`…). Audit it before deleting (A.3).

**On Air-scoped CSS blocks**
- `styles/heatmap.css`: `.hm--onair …` (lines 128–150) and `.hl--onair …` (949–1012, 1240, 1292).
- `styles/calendar.css`: `[data-theme="onair"] …` (from line 539).
- `board/board.css`: the `[data-theme="onair"] …` block (1361 to about 1445, plus 1586 and 1607).
- `styles/base.css`: `.theme-switch*`, including `.theme-switch__dot--onair` (line 308), and the comments at lines 4, 143 and 430.
- `styles/studio.css`: comment line 2 and "hidden in On Air" (line 135). Review the unscoped stepper rules that only On Air's slanted stepper uses.
- `styles/front-pf.css` and `pages.css`: comments only.

**Helpers named after On Air**
- `apps/studio/src/onair.ts` and `onair.test.ts` are generic display helpers imported by 17 modules. **Rename** them to `apps/studio/src/display.ts` and `display.test.ts`.
- Delete what becomes dead: `rankSteps` and `tickerFacts` (only Front and Ticker use them). Also delete `STATUS_RANK`, the `KIND_LONG` export, `modeDiff`, `composeDescription` and `parseTags` if they're still unused after the sweep (grep finds no importer outside onair.ts today).
- The `STATUS_AIR` copy ("Cleared to air", "Blackout") is broadcast wording. Keep it for now and flag it for an owner copy pass.
- `heatmap.ts:9` imports `bestCells` from `./onair`.

**Compositions and video**
- `packages/design-tokens/src/index.ts` `videoTheme` is the On Air night palette. `EraAdjustedSlope`, `captions/burned.test.tsx` and `compositions.test.tsx` (golden hashes) use it. It moves to Photo Finish (A.4, decided Q1).

**Tests**
- `apps/studio/src/theme.test.ts` (On Air cases) and `onair.test.ts` (rename). `e2e/m1.spec.ts` has no theme reference.

**Docs**
- `docs/decisions/005-on-air-brand-baseline.md`: change the status line to "superseded by 009" and leave the rest of the ADR alone.
- `docs/decisions/006-two-themes-studio-modules.md`: "superseded in part by 009".
- `DESIGN.md`: rows D14/D15 in §2 (add a D18 row), the §6.1 intro, and the §10 status line "UI baseline: On Air".
- Header comments in `router.tsx`, `Heatmap.tsx`, `HeatmapCell.tsx`, `Projects.tsx`, `Wordmark.tsx`, `glyphs.tsx`, `finish.tsx`, `idents.tsx` and `StudioLayout.tsx`.

### A.2 Migration
- **Stored preference:** on boot (in the inline script in `index.html` and in `main.tsx`), if `localStorage["statreel.theme"]` exists and isn't `"photofinish"`, remove it, guarded by try/catch as today. Every browser lands on Photo Finish, and a stored `"onair"` is dropped silently.
- **Attribute:** `index.html` ships `<html data-theme="photofinish">`. `theme.ts` shrinks to a constant (`export const THEME = "photofinish"`) or is deleted. The inline script keeps only the storage cleanup. `meta theme-color` becomes `#eceff2` and `color-scheme` becomes `light`.
- **Deep links:** none carry the theme, so no redirect is needed.
- **Server:** nothing to do. `settings` holds no theme (verified).

### A.3 Safe-deletion procedure for shared CSS (front.css, the studio.css stepper)
1. Before any change, take Playwright screenshots in Photo Finish at 1440×900 and 390×844 of:
   - `/`, `/heatmap` and `/heatmap/era-adjusted-rankings/F1`;
   - `/projects` and `/studio/<e2e project>`;
   - `/calendar`, `/board` (all three tabs), `/metrics` and `/sources`.

   Save them to `test-results/theme-baseline/`.
2. With a throwaway script (not committed), list for each route which `front.css` selectors match at least one element. Move only those to `styles/base.css` or the owning module file, and delete the rest.
3. Take the screenshots again and diff them with pixelmatch (threshold 0.1 %, the repo's visual norm, DESIGN §8). Photo Finish must be **pixel-identical** apart from the nav, where the theme switch is gone.

### A.4 Video theme: moves to Photo Finish (decided, Q1)
`videoTheme` (the dark night palette used by `EraAdjustedSlope` and the burned captions) is replaced by a **Photo Finish video palette**, built from the same token values as the studio.
- **Palette:**
  - sheet background `#eceff2` or a slightly darker video variant;
  - graphite text `#12161a`;
  - one clay-red signal `#e4432a`, brand `#b8321a`;
  - the Photo Finish lane colours for series.

  Define it as `videoTheme` (same export name, so callers don't change) in `packages/design-tokens/src/index.ts`, with a comment linking ADR 009.
- **Contrast:** at least 4.5:1 for all text on the video background, checked by a unit test. The caption box keeps the safe area (y 150–1580). Burned captions move to graphite on a translucent sheet plate.
- **Reference images change.** Regenerate them deliberately in one commit labelled `test(compositions): regenerate goldens for Photo Finish video palette`:
  - `packages/compositions` golden hashes (`compositions.test.tsx`), `captions/burned.test.tsx` snapshots, any stored stills;
  - e2e screenshots/expectations that capture a rendered frame or thumbnail.

  Review the before and after stills side by side, and attach them to the PR.
- **New generated videos** (D5 `DataRace`) start from the same Photo Finish video palette. A per-case leader-adaptive accent is allowed only within the one-signal rule (ART-DIRECTION).
- Task **T2b**.

---

## B. Frame Stat icon in the app title (keep the wordmark typography)

### B.1 Where the title lives
- `apps/studio/src/components/Wordmark.tsx` is rendered in two places:
  - `components/Nav.tsx:85–88`, inside `<Link className="logo" aria-label="StatReel, front page">`;
  - `routes/FrontPhotoFinish.tsx:122` (the front header).

  The front footer styles it via `.pf-foot__mark .pf-mark` (`front-pf.css:1578`).
- Photo Finish markup: `span.pf-mark > span.pf-mark__a "STAT" + span.pf-mark__l (a 2 px clay-red finish line, 34 px tall) + span.pf-mark__b "REEL"`.
- Styles (`styles/photofinish.css:27–47`): Barlow Condensed at 26 px, STAT at `--weight-display-light` (500), REEL at `--weight-display-heavy` (800), colour graphite `--color-text`.
- **None of that typography changes.** The icon goes in as a sibling **before** `STAT`, and the finish line stays between STAT and REEL.

### B.2 The icon (concept C, Frame Stat)
Geometry from `reference/C-frame-stat-master.svg` and `frameStat` in `reference/statreel-logo.mjs.txt`, on a 100×100 grid:
- frame: `rect x6 y14 w88 h72 rx9`;
- 12 sprocket holes, `w7 h6 rx1.6`, at x = 12 + 14i (i = 0…5) and y = 19 / 75;
- window: `rect x12 y30 w76 h40 rx3`;
- 4 bars, `w12 rx2`, at x = 17 + 18i, heights 12/20/28/36, baseline y = 67.

Implementation:
1. **Shared geometry:** new `packages/design-tokens/src/logo.ts` (plain TS, no React).
   - `frameStatRects(t = 1)` returns `{ role: "frame"|"hole"|"window"|"bar", i, x, y, w, h, rx }[]`. `t` is the 0→1 build-in: bars grow with `ease = 1-(1-t)^3`, staggered `t*1.6 - i*0.18`, exactly as in the prototype.
   - `FRAME_STAT_VIEWBOX = "6 14 88 72"` crops to the frame bounds, so the icon sits on the type's optical box.
   - This is the **single source** for the studio icon, the favicon and the video end card (D5). The geometry is never redrawn (ART-DIRECTION, "StatReel logo").
2. **Component:** new `apps/studio/src/components/FrameStatMark.tsx`, an inline SVG.
   - Roles map to classes: `.fsm__frame`, `.fsm__hole`, `.fsm__window`, `.fsm__bar`, `.fsm__bar--lead`.
   - `aria-hidden="true"` and `focusable="false"` (the Link already carries the accessible name).
3. **Wordmark:** `Wordmark.tsx` becomes theme-free:
   `<span className="pf-mark"><FrameStatMark className="pf-mark__icon"/><span className="pf-mark__a">STAT</span><span className="pf-mark__l"/><span className="pf-mark__b">REEL</span></span>`
4. **Sizing:** `.pf-mark__icon { height: 0.92em; width: auto; margin-right: 0.28em; flex: none; }`.
   - At the nav's 26 px this is about 24 × 29 px, matching Barlow Condensed's cap height plus ascender.
   - It scales automatically in the footer (`calc(var(--r)*1.5)`).
   - `--nav-height: 52px` doesn't change. Below 760 px the icon and wordmark stay as they are.
5. **Colours (Photo Finish tokens):**
   - frame → `var(--color-text)` (#12161a, graphite);
   - holes and window → `var(--color-bg)` (#eceff2, the sheet), so they read as cut-outs on the nav;
   - bars 1–3 → `var(--color-text)`;
   - bar 4 (the tallest) → `var(--color-signal)` (#e4432a).

   Photo Finish's one signal colour is the clay-red finish line, so the leading bar repeats the line that splits STAT | REEL. Lane colours are **not** used, because they would break the one-signal rule.
   - On Link hover/focus, bar 4 becomes `var(--color-brand)` (#b8321a), with no motion.
   - Optional: the bars rise once on first paint over `--motion-base`, skipped under `prefers-reduced-motion`.
6. **Favicon:** replace the On Air data URI in `index.html` with the Frame Stat mark (frame #12161a, holes and window #eceff2, bars #12161a with the last bar #e4432a, viewBox `6 14 88 72`).
   - Generate it once from `frameStatRects()` with a small script.
   - Add it as `apps/studio/public/favicon.svg` and link it with `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`.
7. Remove the On Air `Mark` from `glyphs.tsx` (part of A).

### B.3 Acceptance
- The nav and the front header show the icon to the left of STAT. The STAT/REEL font, weights, sizes and the red line are unchanged; the screenshot diff is limited to the icon box and its offset.
- `packages/design-tokens/src/logo.test.ts`:
  - `frameStatRects(1)` returns 1 frame, 12 holes, 1 window and 4 bars with the prototype heights;
  - `frameStatRects(0)` returns 0 bars;
  - output is deterministic.
- A studio test renders `<Wordmark/>` with `renderToStaticMarkup`. The output must contain an `svg[aria-hidden="true"]`, 4 `.fsm__bar` elements, and the text `STAT` and `REEL`.
- The logo link's accessible name stays "StatReel, front page".

---

## C. `/heatmap` redesign: topic × video ordinal, filled by recency

### C.1 What exists today
- **Routes** (`apps/studio/src/router.tsx:84–101`): `/heatmap` (layer 1, `routes/Heatmap.tsx`) and its child `/heatmap/$usecase/$sport` (layer 2, `routes/HeatmapCell.tsx`).
- **Data:** `GET /api/heatmap` returns `{cells, usecases, trend}` from `HeatmapService` (`apps/server/src/heatmap-service.ts`).
  - `computeHeatmap` (`heatmap.ts`) combines the registry (`data/registry/usecases/*.yaml`), DuckDB `meta.capabilities` and the implemented compositions.
  - Snapshots go to `app.sqlite.heatmap_snapshots(run_id, at, cells_json)`; `POST /api/heatmap/recompute` refreshes them.
- **Layout:** the Photo Finish view has **one use case per row and one sport per column**. Pure helpers are in `apps/studio/src/heatmap.ts`, with tests in `heatmap.test.ts` (studio) and `heatmap.test.ts` (server).
- **The feasibility grid carries a real flow:**
  - tests 1–2 of `e2e/m1.spec.ts` open `cell-era-adjusted-rankings-F1` and **Create project** from the cell layer;
  - `Front*.tsx`, `Projects.tsx`, `PropsPanel.tsx`, `StudioIndex.tsx` and `board/shared.tsx` link to `/heatmap` and to `/heatmap/$usecase/$sport`.

### C.2 Decision
`/heatmap` gets two views on the same route, selected by a search param:
- **`view=topics`** (the new default): one topic per row, and column n is the n-th video created for that topic.
- **`view=feasibility`**: today's grid unchanged, including layer 2.

The child route `/heatmap/$usecase/$sport` keeps working. While it's open, the parent renders the feasibility view underneath (the view is forced while a cell param is present). Every existing link and the e2e create-project flow stay valid; the only e2e change is to open `/heatmap?view=feasibility` before clicking a cell. This is cheaper and safer than moving routes.

### C.3 What is a "video" and what is a "topic"

**Video** = one finished, rendered MP4 produced by the app. A new table, **`videos`**, is the single ledger; the heatmap never scans the file system.
```sql
create table if not exists videos (
  id text primary key,                 -- vd-<uuid8>
  topic_key text not null references topics(key),  -- controlled list (C.3), e.g. "energy"
  topic_label text not null,           -- denormalised display label, e.g. "Energy"
  topic_source text not null,          -- 'case.topic' | 'case.domain' | 'project.topic' | 'project.sport' | 'unassigned'
  case_id text,                        -- case_ideas.id when generated from a case
  project_id text,                     -- projects.id when produced by the M1 pipeline
  render_id text,                      -- renders.id (pipeline) when applicable
  generation_job_id text,              -- generation_jobs.id when applicable
  title text not null,
  format text not null,                -- vertical | landscape
  duration_s real,
  path text not null,                  -- relative to data/
  created_at text not null             -- ISO UTC; = render finished time
);
create index if not exists videos_topic_created on videos(topic_key, created_at);
create unique index if not exists videos_render on videos(render_id) where render_id is not null;
create unique index if not exists videos_gen on videos(generation_job_id) where generation_job_id is not null;
```
Rows are written in two places:
1. `Pipeline`, when a render succeeds (hook it next to the `renders` insert in `apps/server/src/pipeline.ts`);
2. the `generate_video` finalize step (D7).

A one-off backfill in `openDb` inserts a row for every `renders` row that lacks one (`insert … select … where not exists`, so it's idempotent). `created_at` comes from `renders.created_at`.

**Topic** is a **broad domain** chosen from a **controlled list** (decided, Q2): a type of sport, or a geo-economic discipline. The free-label idea is dropped.
```sql
create table if not exists topics (
  key text primary key,            -- slug: 'formula-1', 'football', 'energy', ...
  label text not null,             -- 'Formula 1', 'Football', 'Energy'
  family text not null check (family in ('sport','geoeconomy','culture','science','games','music','other')),
  sort integer not null default 0,
  active integer not null default 1,   -- retire instead of delete (history keeps the key)
  created_at text not null
);
-- additive FK columns (SQLite allows ADD COLUMN ... REFERENCES when the default is NULL)
alter table case_ideas add column topic text references topics(key);
alter table projects   add column topic text references topics(key);
```
- **Seed** (idempotent `insert or ignore`, defined in `packages/schemas/src/topics.ts` as `TOPIC_SEED`, so tests, server and the case brief share it):
  - **sport:** `formula-1` (Formula 1), `football`, `basketball`, `ice-hockey`, `tennis`, `cycling`, `motorsport-endurance` (Le Mans/WEC), `motorcycle-racing`, `athletics`, `baseball`, `american-football`, `boxing`, `golf`, `cricket`, `rugby`;
  - **geoeconomy:** `energy`, `trade`, `markets`, `demographics`, `labour`, `growth-income`, `prices-housing`, `debt-finance`, `agriculture-food`, `migration`;
  - **broad families for the remaining domains:** `culture`, `science`, `games`, `music`, `other`.

  This list is a proposal from the 114 existing ideas (domains: sports 25, geoeconomy 21, games 18, music 18, f1 10, science 9, culture 8, other 5) and the registry sports (F1, NBA, NHL, Soccer). The owner can edit the seed in T5 before merging.
- **Mapping used to backfill and resolve** (`DOMAIN_TOPIC` and `SPORT_TOPIC` in `topics.ts`):
  - `f1` → `formula-1`; `culture` → `culture`; `science` → `science`; `games` → `games`; `music` → `music`; `other` → `other`;
  - `sports` and `geoeconomy` have **no automatic default**: their ideas need a specific topic;
  - project sports: `F1` → `formula-1`, `NBA` → `basketball`, `NHL` → `ice-hockey`, `Soccer` → `football`.
- **Backfill** (in `openDb`, idempotent): set `case_ideas.topic` from `DOMAIN_TOPIC` where it's null and the mapping is unambiguous.
  - The 46 `sports`/`geoeconomy` ideas stay null.
  - The Use cases tab shows a "Pick topic" select on those rows; accepting one with no topic prompts for it.
  - The case-loop brief (`.claude/skills/board/references/case-brief.md`) must emit `topic` as one of the seed keys. `CaseIdeas.create` rejects unknown keys (400).
- **`resolveTopic()`** (`apps/server/src/topics.ts`, pure, unit-tested), first match wins:
  1. `case_ideas.topic`;
  2. `DOMAIN_TOPIC[domain]`;
  3. `projects.topic`;
  4. `SPORT_TOPIC[projects.sport]`;
  5. the reserved key `unassigned` (seeded, family `other`, label "Unassigned").
- **`videos.topic_key`** references `topics(key)`. `topic_label` is denormalised at insert, so history keeps its label if a topic is renamed. `topic_source` becomes `'case.topic'|'case.domain'|'project.topic'|'project.sport'|'unassigned'`.
- **API:**
  - `GET /api/topics` lists the active topics;
  - `PATCH /api/cases/:id {topic}` accepts only an active key;
  - adding or renaming topics is a small admin form under `/sources` or the heatmap header (owner action; out of scope beyond `POST`/`PATCH /api/topics`).

### C.4 Endpoint
`GET /api/heatmap/topics?include_empty=1` (empty topics are included by default):
```ts
type TopicHeatmap = {
  generated_at: string;                 // server now (ISO)
  buckets: RecencyBucket[];             // the scale used (shared constant, C.5)
  max_videos: number;                   // widest row = column count
  topics: {
    key: string; label: string; family: string; source: "case.topic"|"case.domain"|"project.topic"|"project.sport"|"unassigned";
    videos: { n: number; id: string; title: string; created_at: string; age_days: number; bucket: BucketId;
              case_id: string|null; project_id: string|null; url: string /* /files/... */ }[];
    pending: { queued: number; running: boolean };   // generate_video jobs for this topic's cases (D)
    accepted_cases: number;                           // accepted case ideas resolving to this topic
    last_at: string | null;
  }[];
};
```
SQL core (better-sqlite3; window functions need SQLite ≥ 3.25):
```sql
select v.*, row_number() over (partition by v.topic_key order by v.created_at, v.id) as n
from videos v order by v.topic_key, n;
```
- **Empty topics** come from accepted `case_ideas`, grouped by `resolveTopic`. With `include_empty=all`, every active topic in the controlled list is returned, so the owner can see the untouched domains.
- **`pending`** comes from `generation_jobs` (type `generate_video`, status queued or running) joined to `case_ideas`.
- **Row order:** `last_at` descending (nulls last), then `label` ascending.
- **Columns:** `max(1, max_videos)`. Above 24 the UI shows the newest 24 plus a leading "+N earlier" cell; the API still returns everything.

### C.5 Colour scale: recency buckets
`RECENCY_BUCKETS` is a shared constant in `packages/schemas/src/topics.ts`: the server uses it to tag `bucket`, and the client uses it to draw the legend.
- `age_days = floor((now − created_at) / 86 400 000 ms)`.
- Each bucket includes its upper day.

| Bucket | Age | Fill (Photo Finish tokens) | Cell text |
|---|---|---|---|
| `fresh` | 0–7 d | `var(--color-brand)` (#b8321a), text `--color-brand-ink` (white, AA 5.6:1) | "3d" |
| `recent` | 8–30 d | `color-mix(in srgb, var(--color-signal) 55%, var(--color-surface))` | "2w" |
| `cooling` | 31–90 d | `color-mix(in srgb, var(--color-signal) 22%, var(--color-surface))` | "6w" |
| `cold` | > 90 d | `var(--color-surface-2)` + 1 px `--color-line-strong` | "4mo" / "1y" |
| empty | no video | transparent + 1 px dashed `--color-line-faint` | none |
| pending | next ordinal while a job is queued or running | hatched `--color-brand-wash` + outline `--color-signal` | "rendering" / "queued" |

- The single signal hue (clay red) is the only colour, which fits Photo Finish.
- **Status is never colour-only:** every filled cell prints its age label (mono, tabular figures), and its `aria-label` reads "Energy, video 2 of 3, created 3 Oct 2026, 3 days ago".
- The legend lists every bucket with its day range.

### C.6 UI (splitting `routes/Heatmap.tsx`)
- **`routes/Heatmap.tsx`** becomes a thin shell: the header, the view switch (`Topics | Feasibility`, `aria-pressed`, data-testids `heatmap-view-topics` / `heatmap-view-feasibility`) and the `<Outlet/>` for layer 2.
- **`routes/HeatmapFeasibility.tsx`**: today's grid, moved as it is (the Photo Finish branch only, after A).
- **`routes/HeatmapTopics.tsx`** (new):
  - sticky row header with the topic label, video count and age of the last video;
  - column headers `1 … N` in mono;
  - each cell is an `<a>` to the video (`/files/...`), or to the Board case for case-based videos;
  - roving focus with the arrow keys (reuse `gridMove` from `heatmap.ts`);
  - data-testids `topic-row-<key>` and `topic-cell-<key>-<n>`.
- **Pure helpers** in `apps/studio/src/topicHeatmap.ts`: `bucketOf(ageDays)`, `ageLabel(ageDays)`, `visibleColumns(max, cap=24)` and `sortTopics()`.
- **Empty states** (honest and labelled, per ADR 005):
  1. No videos and no accepted cases: "No videos yet. A row appears for a topic once a case in it is accepted on the Board; cells fill as videos finish." A "Show all topics" toggle lists the whole controlled list with empty rows. Link to `/board?tab=cases` and to `?view=feasibility`.
  2. Topics but no videos: rows of dashed cells with "no video yet" under the label. Pending ghost cells show while jobs exist.
  3. Loading and error: the existing `Loading` and `Failure` components.
- **Search params:** `HeatmapSearch` gains `view?: "topics"|"feasibility"`. The existing `mode` and `focus` keep applying to the feasibility view.
- The nav label stays "Heatmap". Links labelled "rights grid" in `StudioIndex` and `Projects` get `search={{ view: "feasibility" }}`.

### C.7 Tests
- **Server, `apps/server/src/topics.test.ts`** (in-memory DB):
  - ordinals per topic follow `created_at`, with ties broken by id;
  - topic precedence: case.topic, then the domain mapping, then project.topic, then project.sport, then `unassigned`;
  - the seed is idempotent; an unknown topic key is rejected by `PATCH /api/cases/:id` and `CaseIdeas.create` (400); the backfill maps only unambiguous domains (`sports` and `geoeconomy` stay null);
  - bucket boundaries at 7/8, 30/31 and 90/91 days, with `now` injected;
  - empty topics come from accepted cases;
  - `pending` counts come from `generation_jobs`;
  - the backfill is idempotent (calling `openDb` twice creates no duplicates).
- **Studio, `topicHeatmap.test.ts`:**
  - `bucketOf`;
  - `ageLabel`: 0 → "today", 1 → "1d", 14 → "2w", 120 → "4mo", 400 → "1y";
  - the column cap and the sort order.
- **e2e, `m1.spec.ts`:**
  - tests 1–2 change to `goto("/heatmap?view=feasibility")`;
  - a new test, "heatmap: topics view shows the produced video": after the produce/render test, `/heatmap` shows `topic-row-formula-1` with `topic-cell-formula-1-1` labelled "today".

---

## D. `/board`: hide rejected items, plus a background generation queue

### D.1 Board filter change (hide rejected proposals)
- **Designs tab** (`board/BoardPage.tsx`, `board/board.ts`):
  - add a pure helper `visibleItems(all) = all.filter(i => itemState(i) !== "rejected")`, and compute `items = filterItems(visibleItems(all), filter)`;
  - remove `"rejected"` from `STATUS_FILTERS`. The segmented control keeps All / Pending / Accepted, where All means all non-rejected items;
  - the counts strip keeps the **Rejected number** as feedback (counts are still computed from `all`), but no rejected tile is ever rendered;
  - `MatrixVariant` (the style × case ledger) keeps its tallies from `all` and draws only visible shots;
  - after a reject, the tile leaves the grid with a 6 s toast: "Rejected · style. Undo".
- **Use cases tab** (`board/CasesView.tsx`, `board/library.ts`): drop the `Rejected` `CaseList` (`CasesView.tsx:119`). Filter rejected ideas and rejected derived cases out of the `caseRows()` output for display, but keep them in the data: the loops read them from `/api/cases/feedback`.
- **Styles tab (decided, Q3):** hide rejected styles too.
  - `StylesView.tsx` gets a pure `visibleStyles(styles) = styles.filter(s => s.status !== "rejected")`, and the "Rejected" group is no longer rendered. The intro sentence keeps the rejected count (`n("rejected")`) as feedback.
  - Undo: rejecting a style via `PATCH /api/styles/:id {status: "rejected"}` shows the same 6 s undo toast, which PATCHes back to the previous status (the client remembers it). No new endpoint is needed.
  - Loops still read rejected styles from `/api/styles`, because the server is unchanged.
- **Server:** no API change. `GET /api/board` and `GET /api/cases` still return everything except archived items, because the skill's feedback and the style tallies need the rejected ones.
- **Undo:** new endpoints `DELETE /api/board/:id/decision` and `DELETE /api/cases/:id/decision` set the item back to `pending` and clear decision, note and decided_at.
  - Return 409 if a generation job for that item or case is `running`.
  - Cancel a `queued` job first.
- **Tests:**
  - studio `board.test.ts`: `visibleItems`; a StylesView test for `visibleStyles` and the undo PATCH;
  - `library.test.ts`: rejected rows are hidden;
  - server `board.test.ts` and `library.test.ts`: undo, and the 409 while a job is running;
  - e2e board test in `m1.spec.ts`: after `reject-style`, `board-item-<id>` is **hidden** and the API returns `decision === "reject_style"`. This replaces `toContainText(/rejected/i)`.

### D.2 State machine (mapped onto the existing statuses)
`case_ideas.status/decision` and `board_items.status/decision` stay authoritative, and neither table gets a new status column. A case's pipeline **stage** is **derived** by a pure function, `caseStage(idea, items, jobs)`, in `packages/schemas/src/pipeline.ts`. The server (API) and the studio (badges) both use it, so the two can't drift.

```
case_ideas.status:  pending ──accept──▶ accepted ──(undo)──▶ pending
                       │                   │
                    reject              enqueue visual_options (gj: queued→running→done|failed|cancelled)
                       ▼                   │ done → 3 board_items (pending, case_idea_id = case)
                    rejected (hidden)      ▼
board_items.status: pending ──accept──▶ accepted ──▶ enqueue generate_video (if case accepted AND data gate passes)
                       │                               │ done → videos row (+ heatmap)
                    reject_* (hidden)                  ▼
                                                 stage = video_ready
```

| Derived stage | Condition |
|---|---|
| `proposed` | idea is `pending` |
| `rejected` | idea is `rejected` (hidden) |
| `visuals_queued` / `visuals_running` | latest `visual_options` job is queued / running |
| `visuals_failed` | latest `visual_options` job failed or was cancelled, and no variant is pending |
| `visuals_ready` | ≥ 1 board item with `case_idea_id = idea.id` is pending, and none is accepted (accepting one archives the rest) |
| `data_blocked` | an accepted variant exists, but the data gate fails (D.6) |
| `video_queued` / `video_running` / `video_failed` | state of the latest `generate_video` job for the case |
| `video_ready` | ≥ 1 `videos` row exists for the case |

**Transitions and side effects** (server; each runs in one SQLite transaction):
1. `POST /api/cases/:id/decision {accept}`: set the idea to accepted, then `generation.enqueue({type:"visual_options", case_id})` (idempotent).
2. Any `reject_*` on an accepted idea: cancel its `visual_options` job. A queued job is cancelled; a running one is aborted and set to `cancelled`.
3. `POST /api/board/:id/decision {accept}` on an item that has a `case_idea_id` whose idea is `accepted`: run the data gate, then `enqueue({type:"generate_video", case_id, board_item_id})`. If the gate fails, no job is created: the response carries `gate: {ok:false, reason}` and the badge shows `data_blocked`.
4. Accepting a legacy item (no `case_idea_id`, a registry use case) never auto-enqueues. The UI offers a "Generate video" button (`POST /api/generation/jobs`), which runs the same gate.
5. **Accepting one variant auto-archives its siblings** (decided, Q4). In the same transaction as the accept:
   - every other `board_items` row with the same `source.job_id` that is still `pending` is set to `status='archived'`, `decision='superseded'`, `note='superseded by <accepted id>'`;
   - the response lists `archived_ids`;
   - **undo** of that accept (`DELETE /api/board/:id/decision`) restores exactly those siblings to `pending`, matched by the note;
   - the archived siblings disappear from the board, which already hides archived items.

**Schema changes:**
- `board_items` gets an additive column `case_idea_id text` (nullable), via the existing `addColumn` migration in `db.ts`. `NewBoardItem.case_idea_id` is validated in `BoardService.create` (the idea must exist).
- `case_ideas` gets an additive column `topic text` (C.3).

### D.3 `generation_jobs` table
```sql
create table if not exists generation_jobs (
  id text primary key,                         -- gj-<uuid8>
  type text not null check (type in ('visual_options','generate_video')),
  case_id text not null,                       -- case_ideas.id
  board_item_id text,                          -- generate_video: the accepted visual
  dedupe_key text not null,                    -- type|case_id|board_item_id-or-'-'
  status text not null check (status in ('queued','running','done','failed','cancelled')),
  attempts integer not null default 0,         -- incremented when a run starts
  max_attempts integer not null default 2,     -- auto-retry only for 'interrupted' (restart) failures
  params_json text not null default '{}',      -- resolved config snapshot: cli bin, model, timeouts, budget
  result_json text,                            -- {outputs[], cost_usd, session_id, turns, board_item_ids[]|video_id}
  error text,                                  -- last error (short); full detail in the log
  error_kind text,                             -- timeout|cli_exit|validation|data_gate|interrupted|cancelled|budget
  log_path text,                               -- relative to data/: generation/<id>/run.log
  output_dir text,                             -- relative to data/: generation/<id>/
  pid integer,                                 -- OS pid of the CLI while running
  heartbeat_at text,
  created_at text not null, started_at text, finished_at text, updated_at text not null
);
create unique index if not exists generation_jobs_active
  on generation_jobs(dedupe_key) where status in ('queued','running');
create index if not exists generation_jobs_status on generation_jobs(status, created_at);
create index if not exists generation_jobs_case on generation_jobs(case_id, created_at);
```
- This covers the owner's list: id, type, case_id, status (queued/running/done/failed), attempts, log path and timestamps.
- Two additions: the status `cancelled` (for the cancel endpoint) and `error_kind` (for the UI copy).
- Add the Drizzle table object next to the others in `db.ts`, plus the DDL string. The partial indexes live in the raw DDL.

### D.4 Worker design: a dedicated generation worker process (chosen, Q6)
**Decision:** generation runs in its **own Node process**, `apps/server/src/generation/worker-main.ts`, started with `pnpm worker`.
- It is separate from the Hono server, and therefore from the co-pilot, which stays a `JobRunner` `llm` job inside the server.
- **The co-pilot never waits for generation, and generation never waits for the co-pilot.** There is no shared LLM slot (the earlier `holdSlot("llm")` idea is dropped).
- The queue itself still runs **one job at a time**, FIFO.

**Why a separate process rather than a second in-process loop:**
1. **Isolation, which Q6 asks for.** A long CLI session plus its stream parsing, file staging and validation stays off the server's event loop, so co-pilot streaming and the studio API stay responsive. A crash in the worker can't take the server down, and the reverse holds too.
2. **It survives server restarts.** `tsx watch` restarts of the server during development no longer kill a running generation, which removes the former main risk (R2). The worker runs with plain `tsx` (no watch).
3. **The cost is acceptable:**
   - **Second SQLite writer:** the DB already runs in WAL mode (`db.ts:248`). Add `busy_timeout = 5000` in `openDb` for both processes. Writes are small single-row updates.
   - **The worker needs the server for MCP and renders:** it checks `GET /api/health` before claiming a job and backs off (5 s → 60 s) while the server is down. The job stays `queued`, so nothing is lost.
   - **No direct EventBus:** solved with a table poller (below).

A worker *thread* (`worker_threads`) inside the server was rejected. It shares the process and its fate (restarts and crashes), and better-sqlite3 handles would have to be opened per thread anyway, so it buys little over a process.

**Process model**
- **Starting:**
  - `pnpm dev` runs server, studio and worker. Add `@statreel/server` script `"worker": "tsx src/generation/worker-main.ts"` and include it in the root `dev` (`--parallel`).
  - `pnpm start` starts server and worker; a root script `"start": "pnpm --parallel --filter @statreel/server start worker"` or the equivalent.
  - `STATREEL_GEN_WORKER=off` keeps the worker from claiming jobs (it idles and logs).
- **Single instance:** at startup the worker takes a lease row, `worker_lease(id='generation', pid, host, heartbeat_at)`, with `insert … on conflict do update … where heartbeat_at < now-60s`. A second worker exits with "already running (pid N)". This guarantees **one job at a time** across processes.
- **Claiming a job** is one transaction: `update generation_jobs set status='running', attempts=attempts+1, started_at=?, pid=? where id=(select id from generation_jobs where status='queued' order by created_at, id limit 1) returning *`.
- **Startup recovery** (`recover()`, run by the worker after it gets the lease): every `running` row is stale, because only the lease holder runs jobs. For each one:
  1. try to kill the recorded CLI `pid` tree: Windows `execFile("taskkill", ["/PID", String(pid), "/T", "/F"])`, POSIX `process.kill(-pid)` for detached children; ignore ESRCH;
  2. if `attempts < max_attempts`: re-queue with `error_kind='interrupted'`;
  3. otherwise: `failed/interrupted`.

  `queued` rows resume in FIFO order.
- **Heartbeat** every 15 s on both the lease and the running job (`heartbeat_at`). If the worker dies, the server marks the lease stale after 60 s and shows "Generation worker offline" in the queue strip. It never runs jobs itself.
- **Retry policy:** automatic retry only for `interrupted`. Everything else waits for a manual retry.
- **Events to the studio:**
  - the worker writes `phase`, `progress_note`, `last_tool` and `updated_at` on its row, plus an append-only `generation_job_events(job_id, at, type, data_json)` row for each transition;
  - the server runs a 1 s poller (`GenerationEventsRelay`: `select … where rowid > last`) that re-emits `gen.queued|started|progress|done|failed|cancelled` on the existing EventBus/SSE;
  - there is no new network channel between the processes.
- **Enqueue, cancel and retry** stay HTTP endpoints on the **server** (D.9), which writes the table.
  - Enqueue: the worker sees the new row on its next poll (1 s; `generation_jobs` is tiny).
  - Cancel of a running job: the server sets `cancel_requested_at`. The worker checks it every second, kills the tree and finalizes the job as `cancelled`.
- **Renders** stay in the server, so "one render at a time" still holds with the existing render worker (ADR 004).
  - The worker calls `POST /api/generation/jobs/:id/render {kind: "stills"|"video", props_path, frames?}`. The server enqueues a `JobRunner` job of kind `gen_render` on the shared `render` lane (`register(kind, handler, {lane})`, with `pump()` keying `active` by lane) and returns its `jobs.id`.
  - The worker polls `GET /api/jobs/:id` until it's terminal.
  - Renders don't use the LLM slot, so the co-pilot is unaffected.

**Lifecycle of one run** (inside the worker)
1. **`prepare`:**
   - create `data/generation/<id>/{refs,work,work/assets,out}`;
   - write `case.json`;
   - stage the reference docs;
   - render `prompt.md`;
   - snapshot the effective config into `params_json`.
2. **`run`:** the CLI child process, see D.5.
3. **`finalize`:**
   - validate the outputs and the asset ledger (D.7);
   - request renders from the server;
   - create the board items or the `videos` row through server endpoints (`POST /api/generation/jobs/:id/finalize` with the validated result), so all domain writes keep going through the server's services;
   - set `done`. Any exception sets `failed` with an `error_kind`.

**Additional columns** on `generation_jobs` (D.3): `phase text`, `progress_note text`, `last_tool text`, `cancel_requested_at text`. New tables `worker_lease` and `generation_job_events` (DDL in T7).

### D.5 Invoking the Claude Code CLI

#### Configuration
Non-secret settings resolve in this order: code defaults in `apps/server/src/generation/config.ts`, then `.statreel/config.json` → `"generation": {…}` (gitignored, machine-local), then environment variables. The worker and the server both load it.
```jsonc
"generation": {
  "enabled": true,                       // STATREEL_GEN_ENABLED
  "worker": "on",                        // STATREEL_GEN_WORKER=on|off
  "mode": "live",                        // GEN_MODE=live|fake (fake = fixture outputs, no CLI; tests/e2e)
  "cli": { "kind": "claude", "bin": null, "extraArgs": [] },   // STATREEL_GEN_BIN (falls back to CLAUDE_BIN, then resolveClaudeBin())
  "model": "claude-sonnet-5-5",          // STATREEL_GEN_MODEL. "Sonnet 5.5": VERIFY the exact id (task T8 step 1)
  "fallbackModel": null,
  "effort": null,                        // low|medium|high|xhigh|max (flag exists in 2.1.288)
  "permissionMode": "dontAsk",           // never bypassPermissions (validated at load)
  "web": {
    "search": true,                      // allow WebSearch
    "fetch": true,                       // allow WebFetch (read pages; cannot save binaries)
    "fetchDomains": null,                // null = any domain; or e.g. ["commons.wikimedia.org","en.wikipedia.org"] (see O2)
    "download": {                        // the fetch_asset MCP tool (the ONLY way to save a file from the web)
      "hosts": ["upload.wikimedia.org", "commons.wikimedia.org"],
      "mime": ["image/png", "image/svg+xml", "image/webp"],
      "maxBytes": 5000000,
      "maxPerJob": 40,
      "licences": ["PD", "CC0", "CC-BY", "CC-BY-SA"]
    }
  },
  "timeoutMin": null,                    // Q7: no limit by default; { "visual_options": n, "generate_video": n } when wanted
  "budgetUsd": null,                     // Q7: no cap by default; per-type numbers when wanted (→ --max-budget-usd)
  "maxAttempts": 2                       // auto-retry only after an interrupted run (not a budget)
}
```
- `GET /api/generation/config` returns the effective values and where each came from (default, file or env).
- `timeoutMin` and `budgetUsd` are **optional and unset** (Q7). When unset, no `--max-budget-usd` flag is passed and no wall-clock timer runs. Setting either one turns that limit on without a code change.
- `cli.kind` selects an adapter: `interface GenerationCli { args(ctx): string[]; parseLine(l): LlmEvent[] }`. Only `claude` is implemented for now. Codex or Grok can be added later without touching the queue.

#### Model id
- The owner says "Sonnet 5.5". ADR 005 names the contest seat `claude-sonnet-5.5`.
- `claude --model` accepts either an alias (`sonnet` = the latest Sonnet) or a full model name.
- **Verify before shipping T8:** run `claude -p --model <candidate> --output-format json "Reply OK"` for each of `claude-sonnet-5-5`, `claude-sonnet-5.5` and `sonnet`, and read the model key of `modelUsage` in the JSON result.
- Pin the full id that works. Don't make the floating `sonnet` alias the default.

#### Spawning the process (no shell, no injection)
```ts
spawn(bin, args, { cwd: <data>/generation/<id>/work, shell: false, windowsHide: true,
                   stdio: ["pipe","pipe","pipe"], env: { ...process.env, STATREEL_GEN_JOB: id } })
child.stdin.end(promptText, "utf8")      // the prompt never goes on the command line; stdin closed => nothing can wait for input
```
- `args` is an **array**, and only server-generated values go into it:
  - the model from config, validated against `/^[a-z0-9.\-_:]+$/i`;
  - absolute paths the worker created itself;
  - numbers;
  - domain names from config, validated against `/^[a-z0-9.-]+$/`.
- **No case text, title or user note ever reaches argv.** Case content travels only in files (`case.json`) and the stdin prompt.
- Before any path is built:
  - `case_id` must match `/^ci-[0-9a-f]{8}$/` and `board_item_id` must match `/^bd-[0-9a-f]{8}$/`;
  - paths are built with `path.join` and must pass `startsWith(<data>/generation/)` (the same pattern as `BoardService.inside`).

#### Arguments (Q5: web search/fetch allowed; downloads only through `fetch_asset`)
```
-p --output-format stream-json --verbose
--model <model> [--fallback-model <m>] [--effort <e>]
--permission-mode dontAsk --permission-prompts none
--tools Read,Write,Edit,Glob,Grep,WebSearch,WebFetch
--allowedTools Read Write Edit Glob Grep WebSearch WebFetch mcp__statreel__*
      # or, when web.fetchDomains is set: "WebFetch(domain:<d>)" per domain instead of WebFetch   (O2)
--disallowedTools Bash PowerShell
--mcp-config <repo>/.statreel/mcp.json --strict-mcp-config
[--max-budget-usd <n>]                         # only when budgetUsd[type] is configured (Q7)
--no-session-persistence
--append-system-prompt "You are a StatReel generation job. Write only inside the working directory. Data values only through mcp__statreel__ tools; the web is for finding assets only. Save files from the web only with mcp__statreel__fetch_asset. When validate_generation_output returns no errors, stop."
...extraArgs
```
- **Downloads go only through `mcp__statreel__fetch_asset`** (the safest workable option). Options compared:

  | Option | Verdict |
  |---|---|
  | A. Allow Bash with an allowlisted `curl`/`Invoke-WebRequest` | **Rejected.** Shell allowlists in permission rules are prefix matches and easy to escape (pipes, `;`, `&&`, PowerShell parsing); it reopens arbitrary command execution. |
  | B. WebFetch then Write | **Not workable.** WebFetch returns processed text/markdown, not binary bytes, so PNG/SVG files can't be saved faithfully. |
  | C. **Server-side MCP tool `fetch_asset`** (chosen) | The server downloads on the session's behalf, with fixed rules: https only, a host allowlist, MIME sniffing and an allowlist, size and count caps, redirects re-checked against the allowlist, SVG sanitised, a fixed destination, and licence verification. The session never gets a general download primitive. |

- **`fetch_asset({job_id, url, kind: "logo"|"flag"|"emblem"|"icon", entity, source_page, licence?, author?})`**, implemented in `apps/server/src/generation/assets.ts` and exposed in `mcp.ts`:
  1. Validate `job_id` and that the job is `running`. `url` must be https and its host in `web.download.hosts`.
  2. For Wikimedia hosts, resolve the file page and read the licence through the Commons API (`action=query&prop=imageinfo&iiprop=url|extmetadata`). Take `LicenseShortName`, `Artist`, `Credit`, `UsageTerms` and `Restrictions` (trademark) from the API, not from the model.
     - A licence outside `web.download.licences` → reject with the reason.
     - Trademarked logos are allowed (nominative use, per ART-DIRECTION) and flagged `trademark: true`.
  3. Download with a byte cap and sniff the MIME type. SVGs pass a sanitiser that strips `script`, `foreignObject`, event attributes and external `href`s. Rasters are kept as downloaded after the MIME check and a decode check. `sharp` is **not** a dependency today (verified); adding it to re-encode would be an optional new dependency.
  4. Write `work/assets/<kind>s/<slug(entity)>.<ext>`; the server chooses the name. Append a row to `work/out/assets.json`: `{entity, kind, file, sha256, bytes, url, source_page, licence, licence_url, author, credit, trademark, fetched_at, verified_by: "commons-api"|"model-declared"}`.
  5. Return `{file, licence, trademark}` or a structured error. At most `maxPerJob` calls are allowed; further calls are rejected.

  Non-Wikimedia hosts are off by default. Adding one to `web.download.hosts` means `verified_by: "model-declared"`, and finalize then flags those assets for owner review.
- **Permission mode:**
  - `dontAsk` with `--permission-prompts none` means nothing can prompt, so anything not pre-allowed is denied;
  - **`--restricted` is no longer passed.** In the first draft it also blocked WebFetch, which Q5 now needs (open item **O1**). Confinement comes from the `--tools` allowlist (no Bash or PowerShell), `dontAsk`, and file-path permission rules (O3);
  - config validation rejects `bypassPermissions`, `--dangerously-skip-permissions` and any `extraArgs` that add `Bash`/`PowerShell`.
- **No `--add-dir`:** reference material is copied into the working directory.
- **Working directory:** `data/generation/<id>/work` (the cwd). The worker stages `work/refs/…` and `work/case.json`; the model writes `work/out/`; `fetch_asset` writes `work/assets/`.
- **The session ends by itself:** print mode (`-p`) exits after the agent's final message. The prompt requires stopping once `validate_generation_output` is clean.
  - **Exit assurance (not a time limit):** if the process hasn't exited within 30 s of the stream's `result` event, the worker kills the tree and treats the job by its `result` (open item **O4**).
  - **No wall-clock timeout by default (Q7).** If `timeoutMin[type]` is set, an `AbortController` kills the whole process tree (`taskkill /T /F /PID` on Windows) → `failed/timeout`.
  - The UI shows "no activity for N min" from `heartbeat`/`last_tool` as information only.
  - Cancel uses the tree-kill path → `cancelled`.
- **Output capture:**
  - raw stdout lines → `run.jsonl`;
  - the lines are parsed with the existing `parseStreamLine` from `@statreel/llm` into a readable `run.log` (one line per text, tool call or tool result, each truncated to 2 KB);
  - stderr → `stderr.log`;
  - each `tool_call` updates `last_tool` (WebSearch, WebFetch and `fetch_asset` calls are logged with their URL or query, so asset provenance is auditable);
  - the final `result` event supplies `cost_usd`, `turns` and `session_id` for `result_json`;
  - `result.refusal` → `failed`, `error_kind='cli_exit'`, note "refused";
  - a budget overrun (only possible when a cap is configured) → `error_kind='budget'`.
- **Fake mode** (`GEN_MODE=fake`): no CLI runs. The worker copies `e2e/fixtures/generation/<type>/{out,assets}/**` into `work/` and continues with finalize. Vitest and `pnpm e2e` use it: add `GEN_MODE=fake` to the `e2e` script, and leave `e2e:live` live. Playwright's `webServer` gains a third entry for the worker.

#### Reference staging (`work/refs/`): resolved, never hard-coded
- **Registry root:** `.ai/manifest.yaml` → `registry.local` (`../ai-registry`), relative to the repo.
- **Subjects:** resolve each through `<registry>/knowledge/media-generation/index.json` → `subjects[slug].file`, and copy its `techniques/` and `applications/` siblings:
  - `data-video-virality` (narrative-craft);
  - `data-video-art-direction` (visual-generation);
  - the golden paths of `short-form-narrative-structure`, `evidence-bound-visuals` and `visual-style-locking` (already among the manifest domains).
- **`image-triage/ART-DIRECTION.md`:** repo-relative; on the PC that's `C:\Users\mkdol\dolla\StatReel\image-triage\ART-DIRECTION.md`.
- **Brand and schema:** `packages/design-tokens/src/logo.ts` (geometry), `fonts/fonts.manifest.json`, and the `DataRaceProps` JSON Schema (generated from Zod).
- **Failure:** if the registry or a subject is missing, the job **fails in prepare** with `error_kind='validation'` and the missing path. It never runs without its rules.
- **Provenance:** each staged file is listed with its sha256 in `work/refs/MANIFEST.json`.

#### Prompt templates
- **Location:** `packages/llm/prompts/generation/visual-options.md` and `generate-video.md`, next to the existing `era-adjusted-rankings.md`.
- **Placeholders:** `{{VAR}}`, filled by `templateIn()` (already in `@statreel/llm`). The variables are `CASE_PATH`, `OUT_DIR`, `REFS_DIR`, `JOB_ID`, `DATA_PROVENANCE`, `VARIANTS=3`, `FORMAT` and `FPS=30`.
- **Audit copy:** the rendered prompt is kept as `data/generation/<id>/prompt.md`.
- **Both templates:**
  1. state the format (ADR 007: 30–90 s viz-led time evolution, no narration);
  2. require reading `refs/MANIFEST.json` and the listed golden paths first;
  3. include the Generation rules of D.8 verbatim;
  4. define the exact output contract (D.7);
  5. for every top-10 entity, find a transparent logo (WebSearch/WebFetch, preferring Wikimedia Commons) and save it **only** with `mcp__statreel__fetch_asset`; never type or estimate data values from the web; if no acceptable logo exists, use `logo: {kind: "wordmark"}` and list the entity in `missing_logos[]`;
  6. tell the model to call `mcp__statreel__validate_generation_output` until it returns no errors, then **stop and end the session**.
- **`visual-options.md` adds:** produce 3 distinct looks (palette, chart form, background treatment) of the **mid-video frame at 45 % of the timeline**, as 3 `DataRaceProps` variants. Vary the look, not the data.
- **`generate-video.md` adds:** start from the accepted variant's props (`case.json.visual`), compute the timing plan first, then write the full props.

#### Where outputs go
- `data/generation/<id>/`: `prompt.md`, `run.jsonl`, `run.log`, `stderr.log` and `work/` (with `work/out/` written by the model, including `out/assets.json`, the asset source and licence ledger, and `work/assets/` written by `fetch_asset`).
- On finalize, the accepted assets are copied to `data/assets/logos/<slug>.<ext>`, and their ledger rows merge into `data/assets/logos/LEDGER.json` (dedupe by sha256), so later jobs can reuse them.
- Visual stills are copied to `data/board/items/gen/<case_id>/<job_id>-v{1..3}.png`, because `BoardService` requires images inside `data/board`.
- Videos go to `data/renders/gen/<case_id>/<job_id>/{video.mp4,manifest.json,timing-plan.json,TIMING.md,thumb.png}`.
- Add `data/generation/` to `.gitignore` (`data/board/` and `data/renders/` are already ignored).

### D.6 Data gate (the ethics layer, CLAUDE.md)
- **`visual_options`** is always allowed. The data it uses depends on the case:
  - `data_status` is `staged` or `registry`, and the data is reachable through the MCP `query` tool (`llm.*` views) or server-staged extracts: props must use real rows with fact refs (`data_provenance: "real"`).
  - `new-source` or `guess`: props must set `data_provenance: "sample"`. The composition then burns a fixed **"SAMPLE DATA · DESIGN PREVIEW"** badge, and the board item carries the same label. ADR 006 treats board items as labelled design outputs, and ART-DIRECTION already uses a "SAMPLE DATA" label.
- **`generate_video`** is enqueued only when all three hold:
  - the case's `data_status` is `staged` or `registry`;
  - every source it relies on is in `data/registry/sources.yaml` with a verdict other than `avoid`;
  - the accepted visual's props have `data_provenance: "real"`.

  Otherwise the response is `gate:{ok:false, reason}`, no job is created and the stage is `data_blocked`. Example reason: "Who pumps the oil: source 'U.S. EIA' is not in the registry; approve it and ingest it through statreel_ingest first."
- **Today all 6 accepted cases are `new-source`.** Visual options will run (on sample data), but every video stays gated until the owner approves its sources. That is intended (CLAUDE.md: ask the owner before adding a data source).
- **The web is for assets only (Q5).** Sessions may use WebSearch and WebFetch to find logos and similar assets, and save them only through `fetch_asset` (D.5). Web figures never count as data: every on-screen number needs a fact ref to MCP or staged data, and the validator enforces it. Photos of people are not in the `fetch_asset` kinds.

### D.7 Output contract and validation (finalize)
**`visual_options`**
- Outputs:
  - `work/out/variants/v1..v3.props.json` (`DataRaceProps`);
  - `work/out/variants/v{n}.md` (style name and rationale, ≤ 80 words);
  - `work/out/timing-plan.json`;
  - `work/out/assets.json` (the ledger of every asset used).
- Finalize validates each variant with `DataRacePropsSchema` plus `checkGenerationRules` (D.8).
- It renders one still per variant at `frame = round(0.45 * timeline frames)`: mid-video, never the finale, the same 45 % point as the board harness.
- It creates 3 board items: `{image, width:1080, height:1920, title: idea.title, summary: v{n}.md, proposed_case: {name: idea.title, pitch: idea.pitch}, case_idea_id, style: {id: "gen-<jobid>-v<n>", name: <style name>}, source: {skill: "generation", job_id, model, variant: n, data_provenance, cost_usd}}`.

**`generate_video`**
- Outputs: `work/out/props.json`, and `work/out/timing-plan.json` written by the MCP tool. The props reference the plan through `timing_plan_sha256`.
- Finalize:
  - validates the outputs;
  - renders through `gen_render` (composition `DataRace-vertical`);
  - runs the existing ffprobe checks (resolution, fps, duration 30–90 s, codecs) and writes the manifest;
  - inserts the `videos` row (topic resolved per C.3) and emits `gen.done`.
- Publishing remains a separate owner action through the Calendar and the OPA gate (unchanged).

**New MCP tools** in `apps/server/src/mcp.ts` (the LLM still never writes code):
- `get_generation_context(job_id)`: the case, the accepted visual, the schema and the rules.
- `compute_timing_plan(job_id, {periods, entities, values, events, opts})`: runs `computeTimingPlan` server-side (the ported timing module), writes `work/out/timing-plan.json` and `TIMING.md`, and returns the sha256.
- `validate_generation_output(job_id)`: runs exactly the finalize validation, without rendering, and returns the errors verbatim.
- `fetch_asset(job_id, url, kind, entity, source_page, …)`: the constrained download (D.5).

The worker calls these two server routes: `POST /api/generation/jobs/:id/render` (enqueue `gen_render`) and `POST /api/generation/jobs/:id/finalize` (create the board items or the `videos` row). Both accept only a `running` job.

### D.8 Generation rules (binding; enforced in code, not only in prompts)
Three layers carry these rules:
- the prompt templates, verbatim;
- the **`DataRace` composition**, which makes the rules structural wherever possible;
- **`checkGenerationRules(props, plan)`** in `packages/schemas/src/generation-rules.ts`, which finalize and `validate_generation_output` run and which rejects any violation.

The reference implementations are in `proto/` (staged under `reference/`).

1. **Event transitions are side reveals that alternate left and right.** Each event card enters by sliding in from the screen edge with a clip/mask reveal.
   - The composition derives the side from the card's index: `side = index % 2 === 0 ? "left" : "right"`.
   - Props have **no** transition field. Any `transition`, `enter` or `exit` key is a validation error.
   - This **overrides** ART-DIRECTION's "transitions vary by type" (recorded in ADR 010; T13 updates ART-DIRECTION).
   - Reference: `reference/eventstack.tsx.txt`.
2. **Timing plan first.**
   - The props must include `timing_plan_sha256` that matches `work/out/timing-plan.json`, as produced by `compute_timing_plan` (the port of `reference/timing.mjs.txt`).
   - Every event card's `start_frame` comes from the plan.
   - The plan's period→frame knots must be monotone.
   - There is no free-form timing. The plan is rendered to `TIMING.md` for review (the format of `reference/TIMING-search-box-wars-v2.md`).
3. **Top-10 entities with logos.**
   - The race shows `min(10, available)` entities; with fewer than 10 the props must say so (`entity_count_reason`).
   - Every visible entity has `logo`: either an asset file the session saved with `fetch_asset` (under `work/assets/`, or reused from `data/assets/logos/`), with a matching row in `out/assets.json` (`url`, `source_page`, `licence`, `author`, `trademark`, `sha256`), or `logo: {kind: "wordmark"}`, a styled text fallback. No other fallback exists.
   - The session finds logos on the web itself (Q5), preferring transparent PNG/SVG on Wikimedia Commons. Entities without an acceptable logo are listed in `missing_logos[]`. A logo file without a ledger row is a validation error.
   - Every entity gets a unique colour.
4. **Titles are non-revealing one-liners.**
   - `title` is a single line of ≤ 42 characters, with no newline. `hook` ends with "?".
   - Neither may contain the name of the final #1 entity, case-insensitive and including aliases.
   - Neither may contain the reveal denylist: "wins", "won", "dominates", "takes over", "overtakes", "beats", "champion", "record", "#1", "number one", "first place".
   - Event card titles (`EventCard.title`, ≤ 42 characters, one line) may name entities but never the final ranking.
5. **Ending sequence, fixed and in order:**
   1. **winner spotlight**: the final #1 enlarged, with its logo and 1–2 fact-ref'd stats (60 frames);
   2. **like & subscribe** card (60 frames);
   3. **"Powered by StatReel"** with the **Frame Stat** logo (90 frames; reference `reference/poweredby3.tsx.txt`, geometry from `logo.ts`).

   The composition renders the ending. Props only provide `spotlight.facts[]`, which are required. A props file that tries to override or reorder the ending is invalid.
6. **Event cards stack, each with a ~4 s lifespan.**
   - `life_frames` defaults to 120 at 30 fps; the validator allows 105–135.
   - A new card pushes older cards back: per depth, x +24 px, y −62 px, scale −6 %, brightness −12 %, with max depth 3. Cards fade out at the end of their life.
   - Each card has `date_label` plus 1–2 short facts with refs.
   - Reference: `reference/eventstack.tsx.txt`.

**Rules inherited from earlier decisions** (already validated by `ScriptSchema` and `RenderManifestSchema`; restated in the prompts):
- ADR 007 format (30–90 s, viz-led, no narration);
- every on-screen number has a fact ref;
- attribution card / source line;
- safe box y 150–1580 (ART-DIRECTION);
- text ≥ 26 px (labels) / 28 px (captions), with `tnum` digits;
- OFL fonts from the manifest only;
- ≤ 2 motion cues at once;
- no generated likenesses of real people;
- rank ordering uses a moving average plus hysteresis (`reference/make-plan-v3.mjs.txt`).

### D.9 API endpoints
| Method and path | Purpose | Response |
|---|---|---|
| `POST /api/cases/:id/decision` (existing) | accept/reject; on accept, also enqueue `visual_options` | `{idea, job?: GenerationJob, gate?}` |
| `POST /api/board/:id/decision` (existing) | on accept with an accepted `case_idea_id`: archive the siblings, gate, then enqueue `generate_video` | `{item, archived_ids?, job?, gate?}` |
| `DELETE /api/cases/:id/decision`, `DELETE /api/board/:id/decision` | undo (D.1) | `{idea}` / `{item}`; 409 while a job is running |
| `PATCH /api/cases/:id` `{topic}` | owner sets the topic (C.3) | `{idea}` |
| `GET /api/generation/jobs?status=&case_id=&limit=` | list jobs, newest first | `{jobs: (GenerationJob & {queue_position?})[]}` |
| `GET /api/generation/jobs/:id` | detail | `{job, stage, log_tail: string[]}` (last 200 lines of `run.log`) |
| `GET /api/generation/jobs/:id/log?offset=` | incremental log | `text/plain`, header `X-Next-Offset` |
| `POST /api/generation/jobs` `{type, case_id, board_item_id?, force?}` | manual enqueue (the "Generate video" button) | 200 `{job, existing: true}` when an active job matches the dedupe key; 201 `{job}` when created; 409 `{gate}` on gate failure; 409 when a done job exists and `force` is false |
| `POST /api/generation/jobs/:id/retry` | `failed`/`cancelled` → new attempt (same row: `queued`, `attempts` kept, error cleared) | 409 if `queued`, `running` or `done` (use `force` enqueue) |
| `POST /api/generation/jobs/:id/cancel` | queued → `cancelled`; running → abort the tree → `cancelled` | `{job}` |
| `GET /api/generation/config` | effective configuration (D.5) | `{config, sources}` |
| `GET /api/generation/worker` | worker lease status | `{online, pid, heartbeat_at}` |
| `POST /api/generation/jobs/:id/render`, `POST /api/generation/jobs/:id/finalize` | worker callbacks (D.4); the job must be `running` | `{render_job_id}` / `{board_item_ids|video_id}` |
| `GET /api/topics`, `POST /api/topics`, `PATCH /api/topics/:key` | controlled topic list (C.3) | `{topics}` / `{topic}` |

- The Zod schemas `GenerationJobSchema`, `EnqueueGenerationSchema` and `GenerationConfigSchema` live in `packages/schemas/src/generation.ts`.
- The routes go in `apps/server/src/app.ts`, following the existing route-file pattern.

### D.10 Idempotency
- **Database:** the partial unique index on `dedupe_key` while `status ∈ {queued, running}` makes a second enqueue impossible, even with two racing requests. `enqueue()` uses `insert … on conflict do nothing`, then selects the active row and returns it with `existing: true`.
- **Done jobs:** a done job for the same key returns 409 unless `force:true`. The owner must ask explicitly for a second set of visuals or a second video.
- **Decisions:** the decision write and the enqueue run in one transaction, so a crash between them can't leave an accepted case without a job, nor a job for a non-accepted case. Re-posting the same accept is a no-op for the job.
- **Finalize:** finalize is idempotent. Board item creation checks `source.job_id` + `variant` before inserting, and the `videos` row is unique on `job_id`. A finalize retried after a crash creates no duplicates.

### D.11 UI feedback
**`JobBadge`** in `apps/studio/src/board/JobBadge.tsx`. Each state has a shape plus a label; colour is never the only signal (front.css conventions):

| State | Badge |
|---|---|
| queued | `Queued · #2` |
| running | `Running · 03:12 · Write` (current tool, elapsed time) with an indeterminate bar |
| visuals done | `3 visuals ready` (links to the filtered Designs tab) |
| video done | `Video ready` (links to the render/Library) |
| failed | `Failed · timeout` with **Retry** and **View log** (a drawer with `log_tail`, live via `/log?offset`) |
| data blocked | `Data blocked` with the gate reason and a link to Sources |
| cancelled | `Cancelled` with Retry |
| worker offline | queue strip shows `Generation worker offline`; queued badges add "waiting for worker" |

- **Placement:**
  - every case row in `CasesView`;
  - every Designs tile with `case_idea_id`, plus generated items (source `generation`, labelled "Generated · v2 · SAMPLE DATA" where that applies);
  - a compact **queue strip** in the Board header: "Generating: <case> · 2 queued", with a link to the jobs list.
- **Updates:** SSE `gen.*` events invalidate the queries. As a fallback, `useQuery({refetchInterval: 10_000})` runs while any job is queued or running.
- **Copy:** UI copy follows the existing tone (DESIGN §7). Errors show `error_kind` in plain words.

### D.12 Security summary
- **No shell anywhere:**
  - `spawn(bin, argsArray, {shell:false})`, with the prompt on stdin;
  - IDs regex-validated and paths confined to `data/generation/`;
  - the model name and domain names pattern-checked;
  - `extraArgs` come only from the owner's config file. Validate each one: it must start with `--`, must not be `--dangerously-skip-permissions` or `--permission-mode bypassPermissions`, and must not add Bash or PowerShell.
- **Least privilege for the CLI:**
  - permission mode `dontAsk` with `--permission-prompts none`;
  - tools limited to Read, Write, Edit, Glob, Grep, WebSearch and WebFetch plus the StatReel MCP;
  - **no Bash or PowerShell**, no `--add-dir`;
  - `--strict-mcp-config`, so the user's global MCP servers aren't loaded;
  - `--no-session-persistence`;
  - budget and timeout caps **optional** (unset by default, Q7). Cancel is always available and kills the process tree.
- **The web is used for assets, not data.**
  - WebSearch and WebFetch let the session find assets.
  - **Saving a file is possible only through `fetch_asset`**: host and MIME allowlists, size and count caps, SVG sanitising, a server-chosen file name, and the licence read from the Commons API.
  - Data values must come from `mcp__statreel__query` / staged extracts with fact refs. The validator rejects numbers without refs, so web-scraped figures can't reach a video.
- **Prompt-injection exposure from web pages** is new with Q5. A malicious page could steer the session. Blast radius:
  - writes only inside its own work folder;
  - read-only SQL;
  - `fetch_asset`, limited to allowlisted hosts;
  - no shell;
  - outputs pass Zod plus the rule checker, and an owner accept is needed before a video is published.

  WebFetch can still send a GET request to any domain (a possible exfiltration channel for the staged case/refs, which are low-sensitivity). Setting `web.fetchDomains` closes that (O2).
- **The LLM never writes code** (ADR 002). It writes props JSON and markdown only.
- **The StatReel MCP stays read-only for data**: `query` is guarded by `guardSql`. The new tools write only inside `data/generation/<job>/`.
- **Local only:** the server binds `127.0.0.1`. The worker exposes no port. The lease and job tables coordinate the two processes.
- **Logs** may contain case text and fetched URLs. They stay under the gitignored `data/`.

### D.13 Tests
| File | What it proves |
|---|---|
| `apps/server/src/generation/queue.test.ts` | FIFO claim; one job at a time; the lease (a second worker exits; a stale lease is taken over); dedupe (two `enqueue` calls, or a racing double insert, yield one row); `recover()` turns `running` back into `queued` with attempts below max and `failed/interrupted` at max; heartbeat; cancel while queued and via `cancel_requested_at` while running (fake child); with `timeoutMin` unset no timer is armed; with it set, a timeout leads to `failed/timeout`. |
| `apps/server/src/generation/relay.test.ts` | `GenerationEventsRelay` turns `generation_job_events` rows into `gen.*` bus events exactly once and in order. |
| `apps/server/src/generation/claude-args.test.ts` | exact args for each type; prompt not in argv; no `--max-budget-usd` when `budgetUsd` is unset, present when set; WebSearch and WebFetch present when enabled and absent when disabled; `WebFetch(domain:…)` form when `fetchDomains` is set; Bash and PowerShell always disallowed; `bypassPermissions`, `--dangerously-skip-permissions` and Bash in `extraArgs` refused; model regex; config precedence (default < file < env). |
| `apps/server/src/generation/assets.test.ts` | `fetch_asset` with a mocked fetch: rejects http, non-allowlisted hosts, wrong MIME, oversize, redirects to a foreign host, and a licence outside the allowlist; sanitises a malicious SVG; writes under `work/assets/` with the server-chosen name; appends a correct `assets.json` row; honours `maxPerJob`; refuses jobs that aren't running. |
| `apps/server/src/generation/refs.test.ts` | registry resolution through `index.json` (fixture registry); a missing subject fails prepare; manifest sha256s. |
| `apps/server/src/generation/finalize.test.ts` | the visual fixture creates 3 board items with `case_idea_id` and source `generation`; finalize twice gives no duplicates; invalid props → `failed/validation`; a logo without an `assets.json` row → validation error. |
| `packages/schemas/src/generation-rules.test.ts` | one positive and one negative case per rule 1–6 (a transition key, a sha mismatch, 11 entities or a logo lacking a ledger row, a title with the winner or "dominates" or a 2-line title, a reordered ending, `life_frames` 200). |
| `packages/schemas/src/pipeline.test.ts` | `caseStage` for every row of the D.2 table, including archived siblings. |
| `apps/server/src/app.generation.test.ts` | accepting a case returns the job and posting again returns the same job; accepting a variant archives its 2 siblings and undo restores them; accepting a board item while data is gated returns `gate.ok=false` and no job; retry/cancel status codes; undo returns 409 while running; the render and finalize callbacks reject unknown or non-running jobs. |
| `apps/studio/src/board/board.test.ts`, `StylesView` test, `JobBadge.test.tsx` | `visibleItems` and `visibleStyles`; badge label per state, including "worker offline". |
| `e2e/m1.spec.ts` (`GEN_MODE=fake`, worker in `webServer`) | accept a case idea, see "Queued"/"Running", then "3 visuals ready"; 3 tiles show with the SAMPLE DATA label; accepting one hides the other two (archived); rejecting a tile hides it. |
| Manual live probes (T8) | `GEN_MODE=live` on the PC with one real case: the job completes and **exits by itself**; `run.jsonl` holds the `result` event; logos appear under `work/assets/logos/` with Commons licences in `assets.json`; an attempted write outside the cwd is denied; an attempted Bash call is denied. |

### D.14 Provider budgets (needs user input)
Q7 says there are no limits for now. This section reserves the place where provider budgets will live once the owner sets them. **Nothing below is implemented or enforced until the owner fills it in.**

| Provider slot | Used for | Budget | Fallback provider | Fallback budget | Notes |
|---|---|---|---|---|---|
| LLM generation (Claude Code CLI) | `visual_options`, `generate_video` | _unset (Q7)_ | _n/a_ | _n/a_ | maps to `generation.budgetUsd[type]` → `--max-budget-usd` |
| Audio provider (TBD) | music/SFX beds for generated videos | **needs user input** | **needs user input** | **needs user input** | the existing `AUDIO_MODE` path; per-video and monthly caps? |
| Image-generation provider (TBD) | backgrounds/textures (never likenesses) | **needs user input** | **needs user input** | **needs user input** | none is wired today; would need an ADR and the ethics review |

- **Proposed config shape** (reserved key, not read yet): `"budgets": { "<provider>": { "perJobUsd": null, "monthlyUsd": null, "fallback": { "provider": null, "perJobUsd": null } } }`.
- **Questions for the owner:**
  - which providers;
  - per-job vs monthly caps;
  - what happens at the cap (fail the job, switch to the fallback, or pause the queue);
  - whether the costs should show in the queue strip.

---

## E. Ordered tasks (each one shippable on its own and sized for one Claude Code session)

**Applies to every task:**
- Read `CLAUDE.md`, `DESIGN.md` and the section of this spec the task names.
- Work in small conventional commits (`feat(board): …`, `refactor(studio): …`).
- Run `pnpm lint && pnpm typecheck && pnpm test`, plus `pnpm e2e` when a task touches routes or the board.
- Update `DESIGN.md` and move the matching ADR draft into `docs/decisions/` within the same task.
- Don't add data sources and don't change `data/registry/` (CLAUDE.md).

### T1 (A1): Photo Finish is the only theme (runtime and tokens)
- **Files:**
  - `packages/design-tokens/src/{tokens.css,theme-photofinish.css,theme-onair.css (delete),index.ts,shared.css}`;
  - `apps/studio/index.html`, `src/theme.ts` (and its test), `src/main.tsx`, `src/components/Nav.tsx`, `src/styles/base.css` (`.theme-switch*`);
  - `DESIGN.md` §2/§6.1/§10, ADR 005 and 006 status lines, `docs/decisions/009-photo-finish-single-theme.md` (from the draft).
- **Steps:**
  1. A.2 migration: `data-theme="photofinish"` is static, and the stored value is removed.
  2. The tokens resolve on `:root`.
  3. Remove the theme switch.
  4. `router.tsx` `FrontRoute` always renders `FrontPhotoFinish`.
  5. Remove the `useTheme()` branches in `Heatmap.tsx`, `HeatmapCell.tsx`, `Projects.tsx` and `finish.tsx`, keeping the Photo Finish branch only.
- **Acceptance:**
  - no `onair` or `On Air` string remains in `packages/design-tokens/src` or in the `apps/studio/src` runtime code. Leftover dead CSS is allowed until T2;
  - the app boots on Photo Finish with `localStorage.statreel.theme = "onair"` set beforehand, and the key is removed afterwards;
  - `pnpm e2e` passes.
- **Test:** `pnpm --filter @statreel/studio test`, `pnpm --filter @statreel/design-tokens test`, `pnpm e2e`, `rg -n -i "onair|on air" packages/design-tokens/src apps/studio/src/theme.ts apps/studio/index.html`. The `rg` must print nothing.

### T2 (A2): Delete the On Air set pieces and rename the helpers
- **Files:**
  - delete `routes/Front.tsx` (after moving `useProgramme` to `components/useProgramme.ts`), `components/Ticker.tsx`, `Ident` in `components/idents.tsx` (keep `identVar`), and `styles/onair.css`;
  - remove the On Air blocks in `heatmap.css`, `calendar.css`, `board.css`, `studio.css`, the `glyphs.tsx` On Air set and `Mark`, and `Wordmark.tsx` `oa-mark`;
  - rename `onair.ts` to `display.ts` (and the test), and update its 17 importers;
  - audit `front.css` (A.3);
  - update the header comments.
- **Acceptance:**
  - `rg -n -i "onair|on air|oa-" apps/studio/src packages` finds nothing (`videoTheme` is rewritten in T2b);
  - the A.3 screenshot diff is ≤ 0.1 % on every listed route, apart from the nav switch area;
  - the bundle shrinks (note it in the PR).
- **Test:** `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`, plus the screenshot script.

### T2b (A4, decided Q1): video palette moves to Photo Finish
- **Files:**
  - `packages/design-tokens/src/index.ts` (`videoTheme` values with Photo Finish colours, plus a contrast test in `index.test.ts` or `video-theme.test.ts`);
  - `packages/compositions/src/EraAdjustedSlope.tsx` and `packages/captions` (the burned captions). Verified consumers of `videoTheme`: `EraAdjustedSlope.tsx`, `compositions.test.tsx`, `captions/src/burned.test.tsx` (plus a mention in ADR 005);
  - the golden and snapshot files in `packages/compositions` (`compositions.test.tsx` hashes, `packages/captions/src/burned.test.tsx` snapshots);
  - any e2e expectations that check a rendered frame or thumbnail;
  - `DESIGN.md` and ADR 009 (the video palette paragraph).
- **Acceptance:**
  - A.4 holds;
  - all text on video backgrounds has ≥ 4.5:1 contrast (unit test);
  - the **regenerated reference images are committed in a dedicated commit**, with before/after stills attached to the PR for owner review;
  - no other golden changes.
- **Test:** `pnpm --filter @statreel/design-tokens test`, `pnpm --filter @statreel/compositions test -- -u` (regenerate once), then the same without `-u` (must pass), then `pnpm e2e`.

### T3 (B): Frame Stat icon in the wordmark, and the favicon
- **Files:**
  - new `packages/design-tokens/src/logo.ts` and `logo.test.ts`, exported from `index.ts`;
  - new `apps/studio/src/components/FrameStatMark.tsx`;
  - `components/Wordmark.tsx`, `styles/photofinish.css` (`.pf-mark__icon`, `.fsm__*`);
  - new `apps/studio/public/favicon.svg`, and `index.html`.
- **Acceptance:** B.3. The geometry matches `reference/C-frame-stat-master.svg` (compare the rect list).
- **Test:** `pnpm --filter @statreel/design-tokens test`, `pnpm --filter @statreel/studio test`, and visual checks of the nav and the front header.

### T4 (D1): Board hides rejected items and styles, plus undo
- **Files:**
  - `apps/studio/src/board/{board.ts,board.test.ts,BoardPage.tsx,CasesView.tsx,StylesView.tsx,library.ts,library.test.ts}`;
  - `apps/server/src/{board.ts,library.ts,app.ts}` (the DELETE decision routes) and their tests;
  - `e2e/m1.spec.ts` (the board test).
- **Acceptance:** D.1, including the Styles tab (Q3). The rejected counts are still shown; the undo toast restores the item, idea or style.
- **Test:** `pnpm --filter @statreel/studio test`, `pnpm --filter @statreel/server test`, `pnpm e2e -g board`.

### T5 (C1): `videos` ledger, topic resolution and the topics endpoint
- **Files:**
  - `apps/server/src/db.ts`: the `topics` table plus seed, `videos` (FK `topic_key`), `case_ideas.topic` and `projects.topic` (FK to `topics.key`), and the backfill;
  - new `apps/server/src/topics.ts` and `topics.test.ts`;
  - `pipeline.ts` (insert a `videos` row on render success) and `heatmap-service.ts` (or a new `topic-heatmap.ts`);
  - `app.ts`: `GET /api/heatmap/topics`, `GET`/`POST`/`PATCH /api/topics`, `PATCH /api/cases/:id`;
  - `library.ts` (`CaseIdeas.create` and `update` validate topic keys);
  - new `packages/schemas/src/topics.ts` (`TOPIC_SEED`, `DOMAIN_TOPIC`, `SPORT_TOPIC`, `RECENCY_BUCKETS`, `TopicHeatmapSchema`, `slug`);
  - the case brief in `.claude/skills/board/references/case-brief.md`, which must emit `topic` as one of the seed keys;
  - the Use cases tab "Pick topic" select (`CasesView.tsx`); this can also ship in T6;
  - `docs/decisions/011-topic-activity-heatmap.md`.
- **Acceptance:** C.3–C.5 and the server tests in C.7. The owner reviews the seed list in the PR. Opening the DB twice creates no duplicate seed or backfill rows. Unknown topic keys return 400.
- **Test:** `pnpm --filter @statreel/server test`, `pnpm --filter @statreel/schemas test`.

### T6 (C2): Topics view in the UI, with Feasibility kept as a view
- **Files:**
  - `apps/studio/src/router.tsx` (`view` search param), `routes/Heatmap.tsx` (shell);
  - new `routes/HeatmapFeasibility.tsx`, `routes/HeatmapTopics.tsx`, `topicHeatmap.ts` and `topicHeatmap.test.ts`;
  - `api.ts` (`heatmapTopics`, `qk.heatmapTopics`), `styles/heatmap.css`;
  - the links in `StudioIndex.tsx` and `Projects.tsx`;
  - `e2e/m1.spec.ts`.
- **Acceptance:** C.6. Each empty state renders with its copy; the cells' aria-labels include the date and age; keyboard navigation works.
- **Test:** `pnpm --filter @statreel/studio test`, `pnpm e2e`.

### T7 (D2): Queue core in fake mode (ADR 010, table, API)
- **Files:**
  - new `docs/decisions/010-generation-job-queue.md`;
  - `apps/server/src/db.ts` (`generation_jobs`, `board_items.case_idea_id`);
  - `db.ts` also gets `worker_lease`, `generation_job_events`, the extra columns (`phase`, `progress_note`, `last_tool`, `cancel_requested_at`) and `busy_timeout = 5000`;
  - new `apps/server/src/generation/{worker-main.ts,queue.ts,lease.ts,relay.ts,config.ts,fake.ts,paths.ts}` and tests;
  - `jobs.ts` (the `lane` option, so `gen_render` shares the render lane; **no** shared LLM slot);
  - `main.ts` (starts `GenerationEventsRelay`; the server never runs jobs), `app.ts` (the `/api/generation/*` routes, including the worker callbacks and `/worker`), `events` (the `gen.*` names);
  - `apps/server/package.json` (`"worker"` script), root `package.json` (`dev`/`start` also start the worker), `playwright.config.ts` (a third `webServer` entry for the worker with `GEN_MODE=fake`);
  - new `packages/schemas/src/generation.ts` and `pipeline.ts` (`caseStage`);
  - `e2e/fixtures/generation/visual_options/out/**` (3 valid props, notes and a timing plan);
  - `.gitignore` (`data/generation/`);
  - `package.json` (`GEN_MODE=fake` in the `e2e` script).
- **Acceptance:**
  - D.3, D.4, D.9 and D.10 hold;
  - with `GEN_MODE=fake`, `POST /api/generation/jobs {type: "visual_options", case_id}` takes a job through queued, running and done, and writes `data/generation/<id>/` (finalize is a stub that only records outputs);
  - killing and restarting **the worker** brings a `running` job back as `queued` (attempts below max) or `failed/interrupted`; restarting **the server** doesn't interrupt a running job;
  - a second worker exits because of the lease;
  - a co-pilot message sent while a generation runs starts immediately (Q6);
  - posting twice gives one row.
- **Test:** `pnpm --filter @statreel/server test`, `pnpm --filter @statreel/schemas test`.

### T8 (D3): Claude runner, prompts, reference staging, and flag/model verification
- **Step 1, on the PC, recorded in the PR:**
  - run `claude --version` and `claude --help`, and confirm the flags in D.5;
  - run the model probe (D.5 "Model id") and pin the id that works as the default in `config.ts`;
  - resolve open items **O1–O4** with probe runs and record the results in the PR, then adjust the args:
    - O1: `--restricted` vs WebSearch/WebFetch;
    - O2: `WebFetch(domain:…)` rules;
    - O3: a write to `..\escape.txt` must be denied, a Bash call must be denied, and `mcp__statreel__*` must be accepted;
    - O4: the process exits after `result`;
  - check O5 against two real Commons logo files;
  - confirm that `--system-prompt-file` still works for the co-pilot (R7). If it doesn't, switch the co-pilot to `--append-system-prompt` in a separate commit.
- **Files:**
  - new `apps/server/src/generation/{claude.ts,claude-args.test.ts,refs.ts,refs.test.ts,prompt.ts,assets.ts,assets.test.ts}`;
  - the `fetch_asset` tool in `apps/server/src/mcp.ts`; `data/assets/logos/LEDGER.json` handling;
  - new `packages/llm/prompts/generation/{visual-options.md,generate-video.md}`;
  - reuse `resolveClaudeBin` and `parseStreamLine` (export them from `@statreel/llm` if they aren't exported yet);
  - the tree-kill helper (`apps/server/src/proc.ts`).
- **Acceptance:**
  - D.5 and D.12 hold;
  - one live `visual_options` run on a real accepted case produces `run.jsonl` with a `result` event and the files under `work/out/`. Validation may still fail at this point, because the composition arrives in T9;
  - the session **exits by itself** at the end; Cancel, or a timeout **when configured**, kills the whole process tree (check that no `claude.exe` is left running);
  - with the default config there's no `--max-budget-usd` and no timer (Q7);
  - logos fetched in the live run are under `work/assets/logos/`, each with a Commons-verified licence row in `out/assets.json`;
  - the prompt text never shows up in the process command line (Process Explorer or `wmic` check).
- **Test:** `pnpm --filter @statreel/server test`, and the manual live probe.

### T9 (D5): DataRace composition and generation rules (can run in parallel with T7/T8)
- **Files:**
  - new `packages/compositions/src/DataRace/` (port `reference/eventstack.tsx.txt` with the side reveal derived from the card index, the ending sequence and `PoweredBy` with `logo.ts`);
  - new `packages/compositions/src/timing/` (port `reference/timing.mjs.txt` and `make-plan-v3.mjs.txt` ordering to TS);
  - register `DataRace-vertical` in the Remotion root;
  - new `packages/schemas/src/{data-race.ts,generation-rules.ts}` and tests (JSON Schema export for refs);
  - MCP tools `get_generation_context`, `compute_timing_plan` and `validate_generation_output` in `apps/server/src/mcp.ts`;
  - a golden still at 45 % and one at the ending.
- **Acceptance:**
  - D.8 rules 1–6 are enforced: each negative test fails validation;
  - the composition renders a fixture case at 1080×1920, 30 fps, in 30–90 s;
  - cards alternate left and right; the stack holds at most 3 cards, each living 120 frames;
  - the ending order is spotlight, then like & subscribe, then Powered by with Frame Stat;
  - the golden hashes are committed.
- **Test:** `pnpm --filter @statreel/compositions test`, `pnpm --filter @statreel/schemas test`, `pnpm --filter @statreel/server test`.

### T10 (D4): Accepting a case enqueues visual options; badges; end to end
- **Files:**
  - `apps/server/src/library.ts`, `app.ts` (the decision transaction plus enqueue, and the `job` in the response);
  - `generation/finalize.ts` (still rendering at 45 % through `gen_render`, and creating the 3 board items);
  - `apps/studio/src/board/{JobBadge.tsx,QueueStrip.tsx,CasesView.tsx,BoardPage.tsx,shared.tsx}`, `api.ts`, `events.ts`, `board.css`;
  - `e2e/m1.spec.ts`, plus the fixture still images.
- **Acceptance:**
  - D.2 transitions 1–2 and 5 (accepting one variant archives its siblings, and undo restores them; Q4), D.7 visual and D.11 hold;
  - the fake-mode e2e passes: accept a case, a badge appears, then 3 tiles labelled SAMPLE DATA where that applies;
  - one live run on the PC produces 3 real stills on the Designs tab.
- **Test:** `pnpm test && pnpm e2e`, and one manual live run.

### T11 (D6): Accepting a visual generates the video (behind the data gate)
- **Files:**
  - `generation/gate.ts` and its test (`sources.yaml` verdicts, `data_status`, provenance);
  - `app.ts` (the board decision with gate plus enqueue, and the manual "Generate video" route);
  - `finalize.ts` (video render, ffprobe checks, the `videos` row through T5's helper);
  - the "Generate video" button and the `data_blocked` badge in the UI;
  - an e2e fake fixture for `generate_video`.
- **Acceptance:**
  - D.6 holds; a gated case returns `gate.ok=false` and no job is created;
  - a passing case in fake mode ends with a `videos` row and the topic heatmap showing cell 1 as "today";
  - the ffprobe checks are recorded in the manifest.
- **Test:** `pnpm test && pnpm e2e`.

### Optional follow-ups
- **T12:** flatten the `[data-theme="photofinish"]` selectors to plain selectors and drop the attribute (pure refactor, pixel-identical).
- **T13:** update `image-triage/ART-DIRECTION.md` (side reveal rule, ending, Frame Stat). Propose the matching changes to the registry technique `event-card-stack` and the `data-video-art-direction` subject through the registry's contribution flow (owner-gated).
- **T14:** provider budgets: implement the `budgets` config and enforcement once the owner fills in D.14.

### Order and dependencies
```
T1 → T2 → T2b      (theme; T2b = video palette + golden regeneration)
T3                 (after T1 recommended, since Wordmark is touched by both)
T4                 (independent)
T5 → T6            (heatmap)
T7 → T8 → T10 → T11 (queue), T9 ∥ T7/T8 and required before real stills in T10; T5 required before T11
```
Suggested sequence: T1, T2, T2b, T3, T4, T5, T6, T7, T9, T8, T10, T11.

---

## F. Decisions, open items and risks

**Owner decisions:** Q1–Q7 are answered. See "Decisions (2026-10-03)" at the top.

**Open items: implementation mechanics to verify in T8 (don't guess)**
- **O1, `--restricted` vs the web tools:** does `--restricted` block WebFetch/WebSearch in 2.1.288, and does it confine file tools in a way we'd lose by dropping it? The spec drops `--restricted` because Q5 needs the web. If a probe shows `--restricted` keeps WebSearch/WebFetch available, or that they can be re-enabled with `--tools`, prefer keeping it.
- **O2, domain-scoped WebFetch:** do permission rules of the form `WebFetch(domain:commons.wikimedia.org)` work through `--allowedTools` in print mode with `dontAsk`? If yes, the owner can set `web.fetchDomains` to close the exfiltration channel. If not, the only choices are WebFetch on or off.
- **O3, file confinement without `--restricted`:** check that with `dontAsk`, Write/Edit outside the cwd are denied (they aren't pre-allowed). If not, add explicit rules such as `--allowedTools "Write(./**)" "Edit(./**)"` plus deny rules, and re-probe. Also check that the MCP wildcard `mcp__statreel__*` is accepted in `--allowedTools`; otherwise list each tool.
- **O4, self-termination:** confirm that `claude -p` exits promptly after the `result` event while an HTTP MCP server is configured. The spec adds a 30 s post-result kill as a safety net only.
- **O5, licence data:** confirm that the Commons API `extmetadata` fields (`LicenseShortName`, `Artist`, `UsageTerms`, `Restrictions`) are present for the typical logo files, and decide how to treat "logo, trademarked, PD-textlogo". The spec allows it with `trademark: true`. The owner's Q5 answer names Wikimedia as the asset source. Record it in the asset ledger and ART-DIRECTION, not in `data/registry/sources.yaml`, which lists data sources. Confirm this split.
- **O6, the model id:** "Sonnet 5.5" (`claude-sonnet-5-5` vs `claude-sonnet-5.5`). It's configurable, and T8 probes it.

**Risks**
- **R1:** all 6 accepted cases are `new-source`. Videos stay **gated** until the owner approves the sources and the data is ingested. Visual options still run, labelled SAMPLE DATA.
- **R2 (reduced):** a separate worker process means server `tsx watch` restarts no longer kill jobs. New cost: a second process to run (`pnpm dev`/`start` and Playwright must start it) and two SQLite writers (WAL plus `busy_timeout`). If the worker isn't running, jobs wait silently; the queue strip shows "worker offline" from the lease heartbeat.
- **R3 (new, Q7): unbounded spend and runtime.** With no budget or timeout, a looping session can run and bill indefinitely. Mitigations: the visible running time and last tool, "no activity" info, Cancel, and the config fields ready to set (D.14).
- **R4 (new, Q5): web exposure.** Prompt injection from fetched pages, possible GET-based exfiltration while `fetchDomains` is unset, and licence mistakes. Mitigations: D.12, `fetch_asset` rules, the Commons-verified licences, and the owner reviewing the `model-declared` assets.
- **R5:** the owner's side-reveal rule conflicts with ART-DIRECTION.md §6 and the registry technique. Recorded in ADR 010; T13 updates the documents.
- **R6:** the DataRace composition (T9) is the long pole.
- **R7:** the co-pilot's `--system-prompt-file` isn't in the 2.1.288 `--help` output. Verify in T8.
- **R8:** e2e changes:
  - the heatmap tests need `?view=feasibility`;
  - the board and styles tests now expect rejected items hidden;
  - accepting a variant archives its siblings;
  - the generation flow needs fake mode plus the worker in `webServer`;
  - **Q1 regenerates the composition goldens and any frame/thumbnail expectations.**
- **R9:** the `front.css` audit may find styles shared with Photo Finish. The screenshot diff is the safety net.
- **R10 (new, Q2):** the 46 `sports`/`geoeconomy` ideas have no automatic topic. Until someone picks one they show up under "Unassigned" on the heatmap, so accepting a case should require choosing one.

---

## G. What was not verified
- **No code was run.** No tests, builds or dev server. Line numbers come from the box copy of the repo (synced 2026-10-03 around 02:21 CEST) and may drift by a few lines from the PC HEAD `3328902`.
- **The DB counts** come from a copy of `data/app.sqlite` in its 2026-10-01 22:34 CEST state.
- **Claude Code:** the `dontAsk` behaviour, the MCP wildcard allow-listing, the exact "Sonnet 5.5" model id and `--system-prompt-file` were not probed. Only `--help` was read.
- **Registry subjects** were located through `index.json`, but their technique and application files weren't read in full. The prompts reference them by resolution, not by content.
- **The proposed front.css split** (A.3) is a procedure, not a completed audit.
- **Revision 2 additions, not verified:**
  - the web-tool and permission mechanics (O1–O4);
  - the Commons licence metadata coverage (O5);
  - the proposed topic seed list is a proposal from the domain counts and idea titles, not an owner-approved taxonomy.

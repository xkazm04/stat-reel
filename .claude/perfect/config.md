---
product: "StatReel"
stack: "pnpm TS monorepo - Vite/React 19 studio (TanStack Router + Query), Hono + better-sqlite3 server with a single-slot job runner and a generation worker, Remotion compositions, zod schemas; Python ingest (uv) + dbt over DuckDB; OPA publish policy"
vault: ["C:/Users/mkdol/Documents/Obsidian/statreel", "C:/Users/kazda/Documents/Obsidian/statreel"]  # Fox, Wolf - first existing wins; per-device, not synced
vault_subdir: Perfect
base_branch: main
wave_size: 3
lot_caps: {}
pool_target: 10
round_shape: round             # single owner: propose 1-3 contexts, gate, build the same session
cooldown_rounds: 2
commit_format: "feat(<scope>): <title>"   # repo history uses conventional scopes: studio, server, heatmap, generation, compositions, ...
context_map: context-map.json  # hand-scanned by /perfect init 2026-10-03 (Personas bridge offline on Fox)
active_runs_ledger: ""
locale_count: 1
---

# /perfect overlay for StatReel

Written by `/perfect init` on 2026-10-03, derived from THIS repo (CLAUDE.md, DESIGN.md, package.json,
.gitignore, docs/decisions) and the owner's auto-memory.

**Gate mode: auto.** The owner instructed on 2026-10-03: "automatically approve all findings and dispatch
sonnet subagent to implement". The Director still challenges every direction before it is accepted; the
AskUserQuestion gate is skipped. The CLAUDE.md "ask the owner before" list is NOT covered by this
auto-approval - a direction that needs any of those is parked, not built.

## Gates

- always: `pnpm -s typecheck` (tsc -b) · `pnpm -s test` (vitest, 609 green at 1f7574c)
- when pipeline/** touched: `uv run --project pipeline pytest`
- when policy/** touched: `opa test policy`
- when pipeline/dbt/** touched: dbt parse/build via `just transform` if the warehouse exists, else say not run
- slow: `pnpm e2e` (Playwright replay, LLM/AUDIO replay, GEN_MODE=fake) - run in background at wave end
- builder: `pnpm -s typecheck` · targeted `npx vitest run <files>` · `npx biome lint <touched files>` (no --write; HEAD is not Biome-clean) · the conditional gates above for files they touched

## Class B

- `packages/*/src/index.ts` barrel exports
- `apps/studio/src/router.tsx` route table (anchored insert only)
- `apps/studio/src/api.ts` (append new typed client calls; do not reshape existing ones)
- `docs/decisions/` (new ADR files only; never edit another ADR)

## Class C

- the git index, `context-map.json`, `.ai/registry-map.json`
- `pnpm-lock.yaml`, `pipeline/uv.lock` (dependency changes are reported, Director installs)
- `DESIGN.md` (doc-sync is the Director's, at wave end)
- regenerated golden fixtures (`packages/compositions/fixtures/*`, `e2e/fixtures/**`) - report the regeneration command
- Thin list otherwise: no locale codegen, no bindings.

## Repo law

Read `CLAUDE.md` and `DESIGN.md` (source of truth) first.
- Real data only: no synthetic or sample data in the product, ever; missing data gets a labelled empty state.
- Ethics layer: all data HTTP goes through `pipeline/statreel_ingest` clients; `verdict: avoid` sources unreachable. No new data source outside `data/registry/sources.yaml`.
- LLM at runtime produces validated props, read-only SQL on `llm.*` views and narration - never composition code.
- Fonts: OFL only from `fonts/`; numeric layers use tabular figures; no external font CDN.
- Video text: every readable text >= 28 px in the 1080x1920 artboard.
- Format: 30-90 s viz-led stats-over-time videos (data time -> video time); no narration, no headline/punchline framing.
- Studio theme: Photo Finish only (ADR 009); colours from `packages/design-tokens`, never hard-coded.
- Publishing private/draft only. No ElevenLabs spend, no platform developer apps, nothing public.
- Never commit secrets, `data/raw`, `*.duckdb`, renders or audio.
- Never run `biome check --write` / `format --write` over directories; hand-format new code to surrounding style.
- Pure helpers stay pure (no React/DOM in `*.ts` logic modules that say so) and are unit-tested beside the file.
- Out-of-scope walls: `data/raw/`, `data/renders/`, `.env*`, the OS keychain.

## Context sources

`context-map.json` is the queue AND the name source (hand-scanned; no Personas DB on Fox).
Docs per context: DESIGN.md sections; ADRs in `docs/decisions/` (006 modules, 007 format, 008 board
libraries, 009 single theme, 010 generation queue, 011 topics heatmap, 012 page-loading discipline);
`docs/specs/2026-10-03-app-refresh/SPEC.md`.

## Smoke

`pnpm dev` -> studio on Vite (proxy to server 127.0.0.1:8787). Read-only DB: `sqlite3 "file:data/app.sqlite?mode=ro"`.
Not driven by builders; the Director only.

## Opportunity arcs

- DESIGN §10 milestones M2 onward; the app-refresh SPEC (2026-10-03) T1-T8.
- Generation queue (ADR 010) is under active construction by a sibling session.

## Vetoes

- Headline/poster/punchline video designs (owner 2026-09-30).
- Narration-first formats; a second studio theme (ADR 009 retired On Air as studio theme).
- Live YouTube upload / Google app setup (owner-gated).

## User taste

- Outcome-value over cosmetic churn; engine depth over chrome.
- Real data, honest empty states, measured numbers over claims.

## Skill improvement log
- 2026-10-04 (pass 1, auto gate): reserve a live sibling's whole unmerged BRANCH file list (`git diff --name-only main...<branch>`), not just its dirty files - only the dirty list was reserved at first, and 5 files collided before it was caught.
- 2026-10-04: builders editing server files restart the owner's `pnpm dev` (tsx watch) - any in-flight render/LLM job dies; check `netstat` for 8787 before a wave and say so; e2e must run on E2E_API_PORT/E2E_STUDIO_PORT next to it.
- 2026-10-04: one builder still ran `git stash` despite the forbidden list - keep the list, and re-verify `git status` after any builder reports a stash.
- 2026-10-04: auto gate + rolling lots (start the next lot as soon as one finishes, <=5 concurrent, disjoint write sets) kept 22 contexts moving in one session; scouts on `sonnet` were accurate enough, with every load-bearing claim spot-checked before dispatch.
- 2026-10-04 (pass 2): never probe a registry/fleet script with `--help`. build-registry-map.mjs ignores unknown flags and rebuilt the map in all 12 fleet repos (11 foreign files reverted). Read the usage header in the source, then run with explicit `--path . --project statreel`.
- 2026-10-04: a builder's "no e2e asserts my text" claim was wrong once (an aria-label regex in m1.spec). Briefs that change user-visible strings must say "GREP e2e/*.spec.ts for every string/aria-label you change and report matches", and the Director runs e2e at every quiescence, not only at the pass end.
- 2026-10-04: running the delta scouts for the NEXT cluster while the current lots build kept 5 builders busy with no idle gaps. Disjoint grouping by file (not context) let 23 contexts ship 40 directions in one session with zero cross-lot collisions.
- 2026-10-04: never `git add -N .` in a shared tree to make untracked files visible to a lint loop. It registers foreign untracked files in the index. Use `git ls-files --others --exclude-standard` read-only instead.

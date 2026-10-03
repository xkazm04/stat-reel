# CLAUDE.md — StatReel

Read `DESIGN.md` first; it is the source of truth. Update it (and add an ADR in `docs/decisions/`) when a decision changes.

## Working rules
- **End-to-end first:** finish Milestone M1 (full flow, live e2e green) before widening any lane.
- **Test-first:** write each milestone's e2e test before implementing it. Done = its DoD passes (`pnpm e2e` replay + `pnpm e2e:live`).
- **Trunk-based, small commits**, conventional commit messages. Never commit secrets, `data/raw`, `*.duckdb`, renders or audio.
- **Verify CLI flags** (`claude`, `codex`, `opa`, `dbt`, `ffmpeg`) with `--help` before relying on those in DESIGN.md.
- **Ethics layer is mandatory:** all HTTP for data goes through `pipeline/statreel_ingest` clients (registry verdict, robots.txt, rate limit ≤ 50 % of published, cache, UA with contact). `verdict: avoid` sources must be unreachable.
- **LLM at runtime** produces validated props, read-only SQL on `llm.*` views, and narration — never composition code.
- **Fonts:** OFL only from `fonts/`; numeric layers must use tabular figures; no external font CDN at render time.
- **Publishing:** private/draft only unless the owner explicitly approves public.

## Ask the owner before
- creating or configuring platform developer apps,
- spending ElevenLabs credits beyond the test budget (DESIGN.md §6.4),
- adding a data source not in `data/registry/sources.yaml`,
- anything that becomes publicly visible.

## Key commands
`just setup` · `pnpm dev` · `pnpm test` · `pnpm e2e` · `pnpm e2e:live` · `just ingest <source>` · `just transform` · `just heatmap` · `opa test policy`
`just check` (or `pnpm check`, `--only typecheck,opa` narrows) = every offline gate (tsc, vitest, scripts, pytest, opa, dbt parse, Biome ratchet) with a PASS/FAIL table · `pnpm lint:ratchet` (`--update` after a Biome cleanup) · next to a running `pnpm dev`, run e2e as `E2E_API_PORT=8797 E2E_STUDIO_PORT=5183 pnpm e2e`

# 010: Background generation queue (dedicated worker process, Claude Code CLI)

- **Status:** accepted, implementing (T7 queue core, T8 Claude runner; draft rev. 2, 2026-10-03, owner answered Q4–Q7)
- **Date:** 2026-10-03
- **Affects:**
  - `apps/server`: `db.ts` (`generation_jobs`, `generation_job_events`, `worker_lease`, `board_items.case_idea_id`, `busy_timeout`); `generation/*` (including `worker-main.ts`, `assets.ts`); `jobs.ts` (render lanes); `mcp.ts` tools; `/api/generation/*`;
  - `apps/studio/src/board/*`;
  - `packages/schemas` (`generation`, `pipeline`, `data-race`, `generation-rules`), `packages/compositions` (`DataRace`), `packages/llm/prompts/generation/*`;
  - root and server `package.json` scripts, `playwright.config.ts`, `DESIGN.md` §3/§5.
- **Relates to:** ADR 002 (no LLM-written code), 004 (render worker), 006 (board), 007 (format) and 009 (palette).

## Context
- Accepting items on the Board should start the next production step automatically:
  - accepting a use case → 3 visual options;
  - accepting a visual → the full video.
- These are long LLM sessions plus renders. They must run in the background, one at a time, survive restarts, and never slow down the interactive co-pilot.
- The existing `jobs`/`JobRunner` runs one job per kind inside the server, with no dedupe and no attempt tracking.

## Decision
1. **A `generation_jobs` table** (type, case_id, board_item_id, dedupe_key, status `queued|running|done|failed|cancelled`, attempts, error_kind, log_path, output_dir, pid, heartbeat, progress fields, `cancel_requested_at`, timestamps).
   - A partial unique index on `dedupe_key` while queued or running makes enqueue idempotent.
   - Enqueue happens in the same transaction as the accept decision.
2. **A dedicated worker process** (`pnpm worker`, `generation/worker-main.ts`), separate from the server and the co-pilot (owner decision Q6).
   - **One job at a time**, FIFO, guaranteed by a `worker_lease` row with a heartbeat.
   - The co-pilot and generation never wait for each other.
   - **Startup recovery:** stale `running` rows have their process tree killed, then are re-queued, or marked `failed/interrupted` once attempts run out.
   - **Events:** the worker writes `generation_job_events`, and a server relay re-emits them as SSE.
   - **Renders and domain writes** go through server callbacks, so renders keep one-at-a-time on the existing render lane and all board/video writes stay in the server's services.
   - SQLite runs in WAL mode with a `busy_timeout`.
3. **The Claude Code CLI is the default executor**, behind an adapter. It's configurable (`.statreel/config.json` → `generation`, and the env vars `STATREEL_GEN_BIN`, `STATREEL_GEN_MODEL`, `GEN_MODE`, `STATREEL_GEN_WORKER`). The default model is "Sonnet 5.5", pinned by full id once probed.
   - **Invocation:** `spawn(bin, args[], {shell:false, cwd: data/generation/<id>/work})`, prompt on stdin, print mode with `--output-format stream-json`, `--permission-mode dontAsk --permission-prompts none`.
   - **Tools:** `Read, Write, Edit, Glob, Grep, WebSearch, WebFetch` plus `mcp__statreel__*`, with **Bash and PowerShell disallowed**; `--strict-mcp-config` and `--no-session-persistence`.
   - The session **ends by itself** when validation is clean; a post-result kill is the safety net.
4. **Assets from the web (Q5).** Sessions may search and fetch pages to find assets such as transparent logos. **Files are saved only through the server-side MCP tool `fetch_asset`**, which enforces:
   - https only, a host allowlist (Wikimedia by default), MIME and size caps, a per-job count cap;
   - SVG sanitising and a server-chosen file name inside the job folder;
   - licence metadata read from the Commons API.

   Each asset is logged in `out/assets.json` and then merged into `data/assets/logos/LEDGER.json`. Shell-based downloads were rejected (allowlists are escapable), and WebFetch can't save binaries.
5. **No budget or timeout caps by default (Q7).** `budgetUsd` and `timeoutMin` are optional config fields. When set, they map to `--max-budget-usd` and a tree-killing timer. Provider budgets (audio, image generation and their fallbacks) are reserved in the spec (D.14) pending owner input.
6. **The LLM writes data and props, never code** (ADR 002). The server validates them with Zod plus `checkGenerationRules`, then renders. Web content never counts as data: every on-screen number needs a fact ref to MCP or staged data.
7. **Data gate:** visual options may use labelled SAMPLE DATA. `generate_video` requires staged or registry data whose sources are all approved in `sources.yaml`.
8. **Board effects:** accepting one visual variant archives its sibling variants (Q4; undo restores them). Rejected items are hidden.
9. **Binding generation rules**, enforced by the `DataRace` composition and the validator:
   1. side-reveal event transitions only, alternating left/right by card index;
   2. a timing plan first, linked by sha256;
   3. the top 10 entities, each with a ledgered logo or a wordmark fallback;
   4. one-line, non-revealing titles;
   5. a fixed ending: winner spotlight → like & subscribe → "Powered by StatReel" with the Frame Stat logo;
   6. stacked event cards with a ~4 s (120-frame) lifespan.

**Deviation recorded:** ART-DIRECTION.md §6 ("card transitions vary by type") is overridden by rule 9.1 at the owner's request. ART-DIRECTION and the registry technique are to be updated (spec T13).

## Alternatives considered
- **A. A loop inside the Hono server (first draft):** rejected after Q6. It shares the event loop and fate with the co-pilot and the API, and `tsx watch` restarts kill jobs.
- **B. A worker thread in the server:** rejected. Same process fate, and better-sqlite3 needs a handle per thread anyway.
- **C. Reuse `jobs`/`JobRunner`:** rejected. No dedupe or attempts, and it would risk the render, publish and co-pilot paths.
- **D. Downloads via allowlisted Bash (`curl`/`Invoke-WebRequest`):** rejected. Prefix allowlists are escapable, and it reopens arbitrary commands.
- **E. Direct Anthropic API:** rejected for now. The owner standardised on the Claude Code CLI.

## Consequences
- Accepting a case produces visuals automatically. Videos need approved data.
- A second process must be running (`pnpm dev`/`start` and Playwright start it), and the UI shows when the worker is offline.
- **New exposure from the web:** prompt injection and GET-based exfiltration. Mitigated by the absence of a shell, writes confined to the job folder, a read-only data MCP, `fetch_asset` rules, an optional `fetchDomains` allowlist, and output validation.
- **Unbounded cost and runtime** until caps are configured. Cancel is always available.
- **Open (verify in T8):**
  - the model id;
  - whether `--restricted` blocks the web tools (it's dropped for now);
  - domain-scoped `WebFetch(domain:…)` rules;
  - file confinement under `dontAsk` without `--restricted`;
  - prompt exit after `result` with an MCP server configured;
  - Commons licence metadata coverage;
  - `--system-prompt-file` for the co-pilot.

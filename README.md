# StatReel

Local-first studio that turns licensed sports data into 1–3 min data-visualisation videos. The design
is in [DESIGN.md](DESIGN.md) and the decisions in [docs/decisions/](docs/decisions/). Everything runs
on `127.0.0.1`.

## Setup (once)

```sh
just setup                    # uv (pipeline), pnpm (apps), .tools/ (OPA; x64 Node on Windows-ARM, ADR 004)
just secrets-set elevenlabs   # ElevenLabs key -> OS keychain (service "statreel")
```

The owner contact for the ingest User-Agent goes in `.statreel/config.json` (`{"contact": "..."}`).

## Run

```sh
just ingest f1db && just transform   # licensed data -> warehouse.duckdb (+ lineage, capabilities)
pnpm dev                             # server :8787 (api, /events, /mcp) + studio :5173
```

The flow: heatmap → create project on a Go cell → **Draft with Claude** (MCP tools only) → **Produce**
(voice, music, render, master, checks, manifest, gate) → **Publish** (private).

## Test

| Command | What it proves |
|---|---|
| `pnpm test` | unit tests for every package (Vitest) |
| `just policy-test` | publish gate, every deny rule both ways (OPA) |
| `just test-pipeline` | data lane unit + replay e2e (pytest) |
| `pnpm e2e` | M1 end to end through the UI; LLM and audio replayed, publish dry |
| `pnpm e2e:live` | same with live Claude and ElevenLabs (budget ≤ 75 s TTS + 75 s music per run, cached); records the replay fixtures |

Audio fixtures (`e2e/fixtures/audio/`) are never committed (CLAUDE.md), so a fresh checkout runs
`pnpm e2e:live` once before `pnpm e2e`.

## Owner-gated (not done by the agent)

- **YouTube live upload:** create the Google Cloud app and follow [packages/publish/SETUP.md](packages/publish/SETUP.md).
  Until then publishing runs in `PUBLISH_MODE=dry` and writes the exact request plan next to the render.
- **Public visibility:** v1 publishes private or draft only. The gate denies anything else.
- **New data sources:** add them to `data/registry/sources.yaml` only with the owner's approval.

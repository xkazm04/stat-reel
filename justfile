# StatReel task runner. Node side via pnpm; data lane (Python) via uv in pipeline/.
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

uv := "uv run --project pipeline"

default:
    @just --list

# install everything: Python data lane, Node workspace, machine-local tools (.tools/: OPA, x64 Node on Windows-ARM)
setup:
    uv sync --project pipeline
    pnpm install
    node scripts/setup-tools.mjs

# store a secret in the OS keychain (e.g. `just secrets-set elevenlabs`)
secrets-set name:
    node scripts/secrets-set.mjs {{name}}

# fetch one registry source through the ethics layer into data/raw/<source>/<snapshot>/
ingest source:
    {{uv}} python -m statreel_ingest ingest {{source}}

# dbt build (staging -> core -> marts -> llm views) + licence lineage + capability tests
transform:
    {{uv}} python -m statreel_ingest transform

# re-evaluate meta.capabilities without rebuilding
capabilities:
    {{uv}} python -m statreel_ingest capabilities

# recompute the feasibility heatmap (server must be running; honours STATREEL_PORT like the server)
heatmap:
    node -e "const port=process.env.STATREEL_PORT||'8787';fetch('http://127.0.0.1:'+port+'/api/heatmap/recompute',{method:'POST'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(j=>{const t={};j.cells.forEach(c=>t[c.mode+':'+c.status]=(t[c.mode+':'+c.status]||0)+1);console.log(t)}).catch(e=>{console.error('heatmap: no recompute from 127.0.0.1:'+port+' ('+(e.cause?.code||e.message)+') - start the server with pnpm dev, or set STATREEL_PORT to the port it runs on');process.exit(1)})"

# publish-gate policy tests
policy-test:
    .tools/opa test policy -v

# Lane 1 unit + replay e2e tests
test-pipeline:
    {{uv}} pytest pipeline/tests

# Lane 1 live e2e: real f1db through the ethics layer (network, ~6 min on a cold cache)
e2e-pipeline-live:
    {{uv}} pytest pipeline/tests -m live

# the one offline gate: typecheck, vitest, script tests, board harness, pytest, OPA, dbt parse, Biome ratchet - runs ALL steps, prints PASS/FAIL, `just check --only opa,dbt-parse`
check *args:
    node scripts/check.mjs {{args}}

# `test-all` used to run 3 of those steps and stop at the first red one; it is `check` now
alias test-all := check

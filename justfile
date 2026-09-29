# StatReel task runner. Lane 1 (data) recipes run inside the uv-managed pipeline project.
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

uv := "uv run --project pipeline"

default:
    @just --list

# install the Python toolchain for the data lane (Node side lands with the studio)
setup:
    uv sync --project pipeline

# fetch one registry source through the ethics layer into data/raw/<source>/<snapshot>/
ingest source:
    {{uv}} python -m statreel_ingest ingest {{source}}

# dbt build (staging -> core -> marts -> llm views) + licence lineage + capability tests
transform:
    {{uv}} python -m statreel_ingest transform

# re-evaluate meta.capabilities without rebuilding
capabilities:
    {{uv}} python -m statreel_ingest capabilities

# Lane 1 unit + replay e2e tests
test-pipeline:
    {{uv}} pytest pipeline/tests

# Lane 1 live e2e: real f1db through the ethics layer (network, ~6 min on a cold cache)
e2e-pipeline-live:
    {{uv}} pytest pipeline/tests -m live

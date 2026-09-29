# 004 - Windows on ARM: the app runs native arm64, the render worker runs under x64 Node

- Status: accepted
- Date: 2026-09-29
- Affects: DESIGN.md §3 (job runner), §4 (toolchain), §6.3 (render pipeline)

## Context

The owner's dev box (Fox) is Windows 11 on **arm64**. Every native dependency ships a
win32-arm64 binary (better-sqlite3, @duckdb/node-bindings, @napi-rs/keyring, esbuild) **except
Remotion's compositor**. `@remotion/renderer@4.0.530` lists compositors for darwin/linux arm64
and x64, but only `win32-x64-msvc` on Windows.

## Decision

- The app (Hono server, job runner, MCP, studio dev server) runs on the native arm64 Node.
- The render job runs as a **child process under an x64 Node** (`.tools/node-x64/`, Node 22 LTS,
  gitignored, fetched by `just setup`), emulated by Windows. Rendering is already a child process
  in the job runner (single slot, cancellable), so this adds no architecture, only a different
  executable.
- `pnpm-workspace.yaml` sets `supportedArchitectures.cpu: [current, x64]`, so both
  architectures' optional binaries (compositor, esbuild) are installed side by side.
- OPA is `opa_windows_amd64.exe` in `.tools/`, also emulated.
- Spike, 2026-09-29: a 30-frame 1080×1920 composition was bundled and rendered to h264 under the
  x64 Node on arm64 Windows. The first run downloaded Chrome Headless Shell (113 MB).

## Consequences

- On x64 or macOS machines the worker simply uses the default Node (`RENDER_NODE` unset).
- Render speed carries an emulation cost. Measure it at M6 against the owner's time budget.
- Revisit if Remotion ships a win32-arm64 compositor.

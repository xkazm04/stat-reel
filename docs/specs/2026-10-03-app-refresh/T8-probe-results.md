# T8 probe results (2026-10-03, Claude Code 2.1.288 on the owner's PC)

Every probe was tiny (a trivial prompt on stdin, no case content, a temp working directory), run with
`spawn(claude.exe, args, {shell:false})`; the prompt always went on stdin. Binary:
`%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe` (found like `resolveClaudeBin()`).
Probe scripts lived in the session scratchpad (not committed); the repeatable parts are
`apps/server/src/generation/claude.live.test.ts` (skipped unless `GEN_LIVE_PROBE=1`) and the unit tests.

No full `visual_options` / `generate_video` job was run (left to the owner as the acceptance step).

## Step 1: version and flags
`claude --version` -> `2.1.288 (Claude Code)`. `claude --help` confirms every flag used by the runner:
`-p`, `--output-format stream-json`, `--verbose`, `--model`, `--fallback-model`, `--effort`,
`--permission-mode` (choices include `dontAsk`), `--permission-prompts {host,none}`, `--tools`,
`--allowedTools`, `--disallowedTools`, `--restricted`, `--mcp-config`, `--strict-mcp-config`,
`--max-budget-usd`, `--no-session-persistence`, `--append-system-prompt`. There is no `--max-turns`.
`--system-prompt-file` is not listed in `--help` (see R7 below). `--restricted` is documented as: removes
Bash/PowerShell/REPL and WebFetch **unless `--tools` names them**, ignores user/project/local settings,
confines the file tools to the working directories, refuses bypassPermissions.

## O6 model id
Command (3 runs, prompt "Reply OK" on stdin):
`claude -p --model <id> --output-format json --no-session-persistence --tools ""`

| `--model` | exit | result | `modelUsage` key |
|---|---|---|---|
| `claude-sonnet-5-5` | 0 | OK | `claude-sonnet-5-5` |
| `claude-sonnet-5.5` | 1 | "There's an issue with the selected model (claude-sonnet-5.5). It may not exist or you may not have access to it." | none |
| `sonnet` (alias) | 0 | OK | `claude-sonnet-5-5` |

Probed default: `claude-sonnet-5-5`; **owner decision 2026-10-04: the shipped default is the `sonnet` alias** (`packages/schemas/src/generation.ts`), which resolves to it today. The ADR-005 spelling
`claude-sonnet-5.5` does not work. Side effect seen: without `--strict-mcp-config` the session also loaded
the account's claude.ai connectors (Gmail, Calendar, Drive, monday.com); the runner always passes
`--strict-mcp-config`.

## O3 file confinement, Bash, MCP wildcard (spec assumption was WRONG)
Command (cwd `<tmp>/o3-plain/work`, MCP server named `statreel` with one tool `ping` on 127.0.0.1):
`claude -p --output-format stream-json --verbose --model claude-sonnet-5-5 --permission-mode dontAsk --permission-prompts none --tools Read,Write,Edit,Glob,Grep,WebSearch,WebFetch --allowedTools Read Write Edit Glob Grep WebSearch WebFetch mcp__statreel__* --disallowedTools Bash PowerShell --mcp-config <mcp.json> --strict-mcp-config --no-session-persistence`
Prompt: write `../escape.txt`, write an absolute path outside the cwd, read an absolute path outside the cwd,
write `./ok.txt`, run Bash `echo hi`, call `mcp__statreel__ping`.

Result **without `--restricted`**: `../escape.txt` WAS created, the absolute-path write WAS created, and the
file outside the cwd WAS readable (`TOP-SECRET-VALUE-42`). `dontAsk` does not confine files when `Read`/`Write`
are allowed without a path scope: the spec's assumption ("not pre-allowed, so denied") does not hold.
Bash was not offered (`NO-BASH`); `mcp__statreel__*` was accepted and `ping` ran (1 call); the process exited
563 ms after the `result` event.

Result **with `--restricted`** (same command plus `--restricted`): `../escape.txt`, the absolute write and the
outside read were all denied ("... is outside <cwd>; --restricted confines the file tools to the working
directory"), `./ok.txt` was written, `ping` ran, exit 559 ms after `result`.

## O1 `--restricted` vs the web tools (resolved: KEEP `--restricted`)
`init.tools` under `--restricted --tools Read,Write,Edit,Glob,Grep,WebSearch,WebFetch` lists WebFetch and
WebSearch. Functional check (`--allowedTools WebFetch WebSearch`, prompt: fetch https://example.com, search
"Wikimedia Commons Ferrari logo svg"): both worked (heading "Example Domain"; first result a Commons file
page); exit 606 ms after `result`. So the spec's reason for dropping `--restricted` does not apply, and
keeping it is the only tested way to confine the file tools (O3).

Extra finding: with a cwd inside the repo (`data/generation/<id>/work`) a run **without** `--restricted`
loaded the repo's `CLAUDE.md` (answered "YES - # CLAUDE.md - StatReel", 74 slash commands and the repo's
skills); **with** `--restricted` it answered `NONE` (user/project settings and CLAUDE.md ignored).

## O2 domain-scoped WebFetch (works)
`--restricted ... --allowedTools "WebFetch(domain:example.com)"`, prompt: WebFetch example.com and example.org.
example.com fetched ("Example Domain"); example.org was denied: "Permission to use WebFetch has been denied
because Claude Code is running in don't ask mode". So `web.fetchDomains` works as designed.

## O4 self-termination (works)
With an HTTP MCP server configured the CLI exited 559-623 ms after the `result` event in every run. The 30 s
post-result kill stays as a safety net only. In `claude.live.test.ts` the trivial job exited by itself (pid not
alive afterwards, `killing the tree` never logged).

## Tree kill, argv, budget (live test, `GEN_LIVE_PROBE=1`)
- Abort mid-run (`AbortController` after 2.5 s, essay prompt): the engine rejected `aborted` and the `claude.exe`
  pid was gone within the wait (`taskkill /PID <pid> /T /F`).
- Process command line read with `Get-CimInstance Win32_Process` during a run: contains `--restricted`, does NOT
  contain the prompt marker and does NOT contain `--max-budget-usd` (default config).
- `budgetUsd: 0.0001` -> `--max-budget-usd 0.0001` is passed and the run ends with `error_kind: budget`
  (the result `subtype` contains "budget"). That run took about 50 s before the cap tripped.

## O5 Commons licence metadata
Commons API (`action=query&prop=imageinfo&iiprop=url|mime|size|extmetadata`), serial requests with
`User-Agent: StatReel/0.1.0 (+<owner contact>)`, 1.2 s apart. Eight candidate titles; two exist:

| File | LicenseShortName | Restrictions | Artist | Credit |
|---|---|---|---|---|
| `Google_2015_logo.svg` | Public domain | trademarked | Google LLC | gstatic URL |
| `Mercedes_AMG_Petronas_F1_Logo.svg` | Public domain | trademarked | "Unknown author" (doubled) | vectorize.net |

The other six guessed titles (Ferrari, McLaren, Red Bull, Nike, Manchester United, Barcelona crests) do not exist
under those names, so coverage of real motorsport/club logos is not proven by this sample (n = 2 files). The
session finds the real file names itself. Rules implemented: "Public domain"/`PD-*` -> `PD`, `CC0`, `CC BY` ->
`CC-BY`, `CC BY-SA` -> `CC-BY-SA`; NonCommercial/NoDerivs are never mapped; `Restrictions: trademarked` ->
`trademark: true` (allowed, nominative use). `upload.wikimedia.org` served `image/svg+xml`. A real end-to-end
`fetch_asset` run for both files produced `assets/logos/google.svg` and `assets/logos/mercedes-amg-petronas.svg`
with `verified_by: commons-api`, byte sizes identical to the originals (nothing stripped from clean SVGs).
Split confirmed in code: asset provenance lives in the job ledger / `data/assets/logos/LEDGER.json`; nothing was
added to `data/registry/sources.yaml`.

## R7 `--system-prompt-file` for the co-pilot (still works)
`claude -p --output-format stream-json --verbose --mcp-config <cfg> --strict-mcp-config --tools "" --allowedTools mcp__statreel__* --system-prompt-file <sys.md> --model claude-sonnet-5-5`,
system file "reply PINEAPPLE", prompt "What is two plus two?" -> result `PINEAPPLE`. No change to the co-pilot needed.

## Deviations from the spec caused by the probes
1. `--restricted` is KEPT (spec D.5 dropped it). Reason: O3 failed without it; O1 shows the web tools survive.
2. Pinned model id is `claude-sonnet-5-5` (not `claude-sonnet-5.5`).
3. `out/assets.json` is maintained by `fetch_asset` (the session must not write it); the authoritative copy is
   `data/generation/<id>/fetched-assets.json`, outside the session's reach.
4. The per-job MCP config is written to `data/generation/<id>/mcp.json` with the running server's port, not the
   shared `.statreel/mcp.json` (that file is overwritten by the co-pilot with whatever port the last server used).

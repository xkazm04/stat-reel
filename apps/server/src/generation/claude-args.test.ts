import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GenerationConfigSchema, type GenerationConfig } from "@statreel/schemas";
import { APPEND_SYSTEM_PROMPT, buildClaudeArgs, logLineFor, writeJobMcpConfig } from "./claude";
import { jobPaths } from "./paths";
import { dataProvenance, renderPrompt } from "./prompt";

const cfg = (o: object = {}): GenerationConfig => GenerationConfigSchema.parse(o);
const build = (o: object = {}, type: "visual_options" | "generate_video" = "visual_options") => buildClaudeArgs({ config: cfg(o), type, mcpConfigPath: "/x/mcp.json" });
const after = (args: string[], flag: string, n = 1) => args.slice(args.indexOf(flag) + 1, args.indexOf(flag) + 1 + n);

describe("buildClaudeArgs (flags verified against claude 2.1.288)", () => {
  it("default args for each type", () => {
    for (const type of ["visual_options", "generate_video"] as const) {
      expect(build({}, type)).toEqual([
        "-p", "--restricted", "--output-format", "stream-json", "--verbose", "--model", "sonnet",
        "--permission-mode", "dontAsk", "--permission-prompts", "none",
        "--tools", "Read,Write,Edit,Glob,Grep,WebSearch,WebFetch",
        "--allowedTools", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "mcp__statreel__*",
        "--disallowedTools", "Bash", "PowerShell",
        "--mcp-config", "/x/mcp.json", "--strict-mcp-config",
        "--no-session-persistence", "--append-system-prompt", APPEND_SYSTEM_PROMPT,
      ]);
    }
  });

  it("no --max-budget-usd unless budgetUsd is configured, and then per type", () => {
    expect(build()).not.toContain("--max-budget-usd");
    expect(build({ budgetUsd: 3 })).toEqual(expect.arrayContaining(["--max-budget-usd", "3"]));
    expect(build({ budgetUsd: { generate_video: 7 } }, "visual_options")).not.toContain("--max-budget-usd");
    expect(after(build({ budgetUsd: { generate_video: 7 } }, "generate_video"), "--max-budget-usd")).toEqual(["7"]);
  });

  it("the prompt and case text are never on argv (only fixed server text)", () => {
    const args = build({ cli: { extraArgs: ["--effort", "high"] } });
    const prompt = renderPrompt({ id: "gj-0123abcd", type: "visual_options" } as never, { data_status: "staged", title: "SECRET-CASE-TITLE" });
    expect(prompt).toContain("gj-0123abcd");
    for (const a of args) {
      expect(a.includes("SECRET-CASE-TITLE")).toBe(false);
      expect(a.length).toBeLessThan(600);
    }
    expect(args).not.toContain(prompt);
    expect(args.filter((a) => !a.startsWith("-"))).not.toContain("case.json");
  });

  it("WebSearch and WebFetch follow the config", () => {
    const off = build({ web: { search: false, fetch: false } });
    expect(after(off, "--tools")[0]).toBe("Read,Write,Edit,Glob,Grep");
    expect(off).not.toContain("WebSearch");
    expect(off).not.toContain("WebFetch");
    const searchOnly = build({ web: { fetch: false } });
    expect(after(searchOnly, "--tools")[0]).toBe("Read,Write,Edit,Glob,Grep,WebSearch");
  });

  it("fetchDomains turns WebFetch into per-domain rules (verified: WebFetch(domain:...) works under dontAsk)", () => {
    const a = build({ web: { fetchDomains: ["commons.wikimedia.org", "en.wikipedia.org"] } });
    expect(a).toContain("WebFetch(domain:commons.wikimedia.org)");
    expect(a).toContain("WebFetch(domain:en.wikipedia.org)");
    expect(a.slice(a.indexOf("--allowedTools"), a.indexOf("--disallowedTools"))).not.toContain("WebFetch");
    expect(after(a, "--tools")[0]).toContain("WebFetch"); // the tool itself stays available
    expect(() => cfg({ web: { fetchDomains: ["a b"] } })).toThrow();
  });

  it("Bash and PowerShell are never available and always disallowed", () => {
    for (const o of [{}, { web: { search: false, fetch: false } }, { cli: { extraArgs: ["--effort", "low"] } }]) {
      const a = build(o);
      expect(after(a, "--disallowedTools", 2)).toEqual(["Bash", "PowerShell"]);
      expect(after(a, "--tools")[0]).not.toMatch(/Bash|PowerShell/);
      expect(a.slice(a.indexOf("--allowedTools"), a.indexOf("--disallowedTools")).join(" ")).not.toMatch(/Bash|PowerShell/);
    }
  });

  it("always restricted, dontAsk and no prompts; never bypassPermissions", () => {
    const a = build();
    expect(a).toContain("--restricted");
    expect(after(a, "--permission-mode")).toEqual(["dontAsk"]);
    expect(after(a, "--permission-prompts")).toEqual(["none"]);
    expect(a).not.toContain("--dangerously-skip-permissions");
    expect(a).not.toContain("--add-dir");
    expect(a).toContain("--strict-mcp-config");
  });

  it("refuses bypassPermissions, --dangerously-skip-permissions and Bash in extraArgs", () => {
    expect(() => cfg({ permissionMode: "bypassPermissions" })).toThrow();
    expect(() => cfg({ cli: { extraArgs: ["--dangerously-skip-permissions"] } })).toThrow();
    expect(() => cfg({ cli: { extraArgs: ["--permission-mode", "bypassPermissions"] } })).toThrow();
    expect(() => cfg({ cli: { extraArgs: ["--allowedTools", "Bash(git:*)"] } })).toThrow();
    expect(() => cfg({ cli: { extraArgs: ["--tools", "Read,PowerShell"] } })).toThrow();
    // a config object that skipped schema validation still cannot reach argv
    const sneaky = { ...cfg(), permissionMode: "bypassPermissions" } as unknown as GenerationConfig;
    expect(() => buildClaudeArgs({ config: sneaky, type: "visual_options", mcpConfigPath: "/x" })).toThrow(/bypass/);
    const sneaky2 = { ...cfg(), cli: { ...cfg().cli, extraArgs: ["--allowedTools", "Bash"] } } as GenerationConfig;
    expect(() => buildClaudeArgs({ config: sneaky2, type: "visual_options", mcpConfigPath: "/x" })).toThrow();
  });

  it("model id is pattern checked, fallback and effort only when set", () => {
    expect(() => build({ model: "x; rm -rf /" })).toThrow();
    expect(build()).not.toContain("--fallback-model");
    expect(build()).not.toContain("--effort");
    const a = build({ fallbackModel: "claude-opus-4-1", effort: "high", model: "claude-sonnet-5-5" });
    expect(after(a, "--fallback-model")).toEqual(["claude-opus-4-1"]);
    expect(after(a, "--effort")).toEqual(["high"]);
  });

  it("extraArgs go last", () => {
    const a = build({ cli: { extraArgs: ["--effort", "high"] } });
    expect(a.slice(-2)).toEqual(["--effort", "high"]);
  });
});

describe("prompt rendering and logs", () => {
  it("fills every placeholder and embeds the rules", () => {
    for (const type of ["visual_options", "generate_video"] as const) {
      const t = renderPrompt({ id: "gj-0123abcd", type } as never, { data_status: "new-source" });
      expect(t).not.toMatch(/\{\{[A-Z_]+\}\}/);
      expect(t).toContain("side reveals that alternate left and right");
      expect(t).toContain("refs/MANIFEST.json");
      expect(t).toContain("mcp__statreel__fetch_asset");
      expect(t).toContain("mcp__statreel__validate_generation_output");
      expect(t).toMatch(/stop and end the session/);
    }
    expect(renderPrompt({ id: "gj-0123abcd", type: "visual_options" } as never, { data_status: "new-source" })).toContain("**sample**");
    expect(renderPrompt({ id: "gj-0123abcd", type: "visual_options" } as never, { data_status: "staged" })).toContain("**real**");
    expect(dataProvenance("generate_video", "new-source")).toBe("real");
  });

  it("MCP config points at the running server", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "statreel-mcpcfg-"));
    try {
      const p = jobPaths("gj-0123abcd", dir);
      require_mkdir(p.dir);
      writeJobMcpConfig(p, "http://127.0.0.1:8794");
      expect(JSON.parse(readFileSync(p.mcpJson, "utf8")).mcpServers.statreel.url).toBe("http://127.0.0.1:8794/mcp");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("run.log lines carry tool inputs (URLs, queries) and truncate long text", () => {
    const l = logLineFor({ type: "tool_call", id: "1", tool: "WebFetch", input: { url: "https://commons.wikimedia.org/wiki/File:X.svg" } });
    expect(l?.tool).toBe("WebFetch");
    expect(l?.line).toContain("commons.wikimedia.org");
    expect(logLineFor({ type: "text", text: "x".repeat(5000) })?.line.length).toBeLessThan(2100);
  });
});

import { mkdirSync } from "node:fs";
function require_mkdir(d: string) {
  mkdirSync(d, { recursive: true });
}

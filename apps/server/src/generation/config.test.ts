import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGenerationConfig } from "./config";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-genconf-"));
  file = path.join(dir, "config.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (generation: unknown, extra: object = {}) => writeFileSync(file, JSON.stringify({ contact: "x", ...extra, generation }));

describe("generation config precedence: default < file < env", () => {
  it("defaults when there is no file", () => {
    const { config, sources } = loadGenerationConfig({ file, env: {} });
    expect(config.model).toBe("sonnet");
    expect(config.budgetUsd).toBeNull();
    expect(config.timeoutMin).toBeNull();
    expect(sources.model).toBe("default");
    expect(sources["web.download.maxBytes"]).toBe("default");
  });

  it("the file overrides defaults and env overrides the file, and sources say which", () => {
    write({ model: "claude-opus-4-1", mode: "fake", web: { download: { maxPerJob: 5 } } });
    const a = loadGenerationConfig({ file, env: {} });
    expect(a.config).toMatchObject({ model: "claude-opus-4-1", mode: "fake" });
    expect(a.config.web.download.maxPerJob).toBe(5);
    expect(a.config.web.download.maxBytes).toBe(5_000_000); // sibling default survives the deep merge
    expect(a.sources).toMatchObject({ model: "file", mode: "file", "web.download.maxPerJob": "file", "web.download.maxBytes": "default" });
    const b = loadGenerationConfig({ file, env: { STATREEL_GEN_MODEL: "claude-sonnet-5-5", GEN_MODE: "live", STATREEL_GEN_BIN: "C:/x/claude.exe", STATREEL_GEN_WORKER: "off", STATREEL_GEN_ENABLED: "0" } });
    expect(b.config).toMatchObject({ model: "claude-sonnet-5-5", mode: "live", worker: "off", enabled: false });
    expect(b.config.cli.bin).toBe("C:/x/claude.exe");
    expect(b.sources).toMatchObject({ model: "env", mode: "env", "cli.bin": "env", worker: "env", enabled: "env" });
  });

  it("budget and timeout are optional and only set when configured (Q7)", () => {
    write({ budgetUsd: { visual_options: 3 }, timeoutMin: 45 });
    const { config } = loadGenerationConfig({ file, env: {} });
    expect(config.budgetUsd).toEqual({ visual_options: 3 });
    expect(config.timeoutMin).toBe(45);
  });

  it("refuses bypassPermissions, a bad model id and dangerous extraArgs at load", () => {
    write({ permissionMode: "bypassPermissions" });
    expect(() => loadGenerationConfig({ file, env: {} })).toThrow();
    write({ cli: { extraArgs: ["--dangerously-skip-permissions"] } });
    expect(() => loadGenerationConfig({ file, env: {} })).toThrow(/refused|dangerous/);
    write({ cli: { extraArgs: ["--allowedTools", "Bash"] } });
    expect(() => loadGenerationConfig({ file, env: {} })).toThrow();
    write({});
    expect(() => loadGenerationConfig({ file, env: { STATREEL_GEN_MODEL: "a b; c" } })).toThrow();
  });

  it("ignores the rest of config.json (contact etc.)", () => {
    write(undefined, { other: 1 });
    expect(() => loadGenerationConfig({ file, env: {} })).not.toThrow();
  });
});

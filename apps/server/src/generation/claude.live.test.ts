/**
 * LIVE probes of the Claude runner (spends a few cents of the owner's Claude usage). Skipped unless
 * `GEN_LIVE_PROBE=1`. Never runs a full visual_options / generate_video job.
 *   GEN_LIVE_PROBE=1 npx vitest run apps/server/src/generation/claude.live.test.ts
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GenerationConfigSchema, type GenerationJob } from "@statreel/schemas";
import { isAlive } from "../proc";
import { createLiveEngine } from "./claude";
import type { RunContext } from "./engine";
import { jobPaths } from "./paths";
import { until } from "./testing";

const live = process.env.GEN_LIVE_PROBE === "1";
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function setup(prompt: string, configPatch: object = {}) {
  const dataRoot = mkdtempSync(path.join(tmpdir(), "statreel-live-"));
  dirs.push(dataRoot);
  const job = { id: "gj-0123abcd", type: "visual_options", case_id: "ci-aaaaaaa1", attempts: 1 } as GenerationJob;
  const p = jobPaths(job.id, dataRoot);
  mkdirSync(p.work, { recursive: true });
  writeFileSync(p.prompt, prompt);
  writeFileSync(p.mcpJson, JSON.stringify({ mcpServers: {} }));
  const config = GenerationConfigSchema.parse({ mode: "live", ...configPatch });
  const pids: number[] = [];
  const log: string[] = [];
  const ac = new AbortController();
  const ctx: RunContext = { job, paths: p, config, signal: ac.signal, setPid: (x) => { if (x) pids.push(x); }, note: () => {}, log: (l) => log.push(l) };
  return { engine: createLiveEngine({ config, dataRoot, apiBase: "http://127.0.0.1:1" }), ctx, p, pids, log, ac };
}

const commandLine = (pid: number) =>
  new Promise<string>((resolve) =>
    execFile("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { windowsHide: true }, (_e, out) => resolve(String(out))),
  );

describe.skipIf(!live)("claude runner (live)", () => {
  it("runs a trivial job: result event in run.jsonl, session exits by itself, no budget flag, prompt not in the process command line", async () => {
    const marker = "PROMPT-MARKER-7f3a9c";
    const { engine, ctx, p, pids, log } = setup(`${marker}. Reply with the single word OK.`);
    const run = engine.run(ctx);
    await until(() => pids.length > 0, 20_000, 20);
    const cmd = await commandLine(pids[0] as number);
    const res = await run;
    expect(res.result).toMatchObject({ model: "claude-sonnet-5-5" });
    expect(readFileSync(p.runJsonl, "utf8")).toContain('"type":"result"');
    expect(isAlive(pids[0] as number)).toBe(false); // exited by itself
    expect(log.join("\n")).not.toContain("killing the tree");
    if (cmd.trim()) {
      expect(cmd).not.toContain(marker);
      expect(cmd).not.toContain("--max-budget-usd");
      expect(cmd).toContain("--restricted");
    }
    console.log("LIVE argv probe: command line captured =", Boolean(cmd.trim()), "| result:", JSON.stringify(res.result));
  }, 120_000);

  it("abort kills the whole process tree", async () => {
    const { engine, ctx, pids, ac } = setup("Write a 4000 word essay about rivers, slowly, in many paragraphs.");
    const run = engine.run(ctx);
    const outcome = run.then(() => "done", (e: Error) => e.message);
    await until(() => pids.length > 0, 20_000, 20);
    const pid = pids[0] as number;
    await new Promise((r) => setTimeout(r, 2500));
    ac.abort();
    expect(await outcome).toBe("aborted");
    await until(() => !isAlive(pid), 15_000, 100);
    expect(isAlive(pid)).toBe(false);
  }, 120_000);

  it("a budget cap that is configured maps to error_kind budget", async () => {
    const { engine, ctx } = setup("Write a 2000 word essay about the sea.", { budgetUsd: 0.0001 });
    await expect(engine.run(ctx)).rejects.toMatchObject({ kind: "budget" });
  }, 120_000);
});

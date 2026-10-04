/**
 * The live runner's stream handling without a real `claude`: `spawn` is replaced by a fake child whose
 * stdout/stderr are fed byte chunks by the test. No CLI, no network, nothing paid.
 */
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationConfigSchema, type GenerationJob } from "@statreel/schemas";

const spawned: FakeChild[] = [];
type FakeChild = EventEmitter & { pid: number; stdin: PassThrough; stdout: PassThrough; stderr: PassThrough };
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: () => {
    const c = Object.assign(new EventEmitter(), { pid: 4242, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    spawned.push(c);
    return c;
  },
}));

const { createLiveEngine } = await import("./claude");
const { jobPaths } = await import("./paths");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-cstream-"));
  spawned.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const JOB = { id: "gj-0123abcd", type: "visual_options", case_id: "ci-aaaaaaa1", board_item_id: null } as unknown as GenerationJob;

function start() {
  const p = jobPaths(JOB.id, dir);
  mkdirSync(p.work, { recursive: true });
  writeFileSync(p.prompt, "x");
  const lines: string[] = [];
  const config = GenerationConfigSchema.parse({});
  const engine = createLiveEngine({ config, dataRoot: dir, apiBase: "http://127.0.0.1:1", bin: "claude" });
  const run = engine.run({ job: JOB, paths: p, config, signal: new AbortController().signal, setPid: () => {}, note: () => {}, log: (l) => lines.push(l) });
  const child = spawned[0] as FakeChild;
  return { p, lines, run, child };
}

const resultLine = (text: string) => `${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, session_id: "s", total_cost_usd: 0.5, num_turns: 3 })}\n`;
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("live runner stream", () => {
  it("a multibyte character split across two stdout chunks reaches run.jsonl and run.log intact", async () => {
    const { p, lines, run, child } = start();
    const bytes = Buffer.from(resultLine("Kimi Räikkönen leads"), "utf8");
    const cut = bytes.indexOf(0xa4); // the second byte of the first "ä"
    child.stdout.write(bytes.subarray(0, cut));
    await tick();
    child.stdout.write(bytes.subarray(cut));
    child.stderr.write(Buffer.from([0xc3]));
    await tick();
    child.stderr.write(Buffer.from([0xa4, 0x0a]));
    await tick();
    child.emit("close", 0);
    await expect(run).resolves.toMatchObject({ result: { cost_usd: 0.5, turns: 3 } });
    expect(readFileSync(p.runJsonl, "utf8")).toContain("Kimi Räikkönen leads");
    expect(lines.join("\n")).toContain("Kimi Räikkönen leads");
    expect(readFileSync(p.runJsonl, "utf8")).not.toContain("�");
    expect(readFileSync(p.stderrLog, "utf8")).toBe("ä\n");
  });
});

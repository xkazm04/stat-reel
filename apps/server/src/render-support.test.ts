import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkerLine, renderTimeoutMs, runWorker, STDERR_CAP, sweepJobFiles, sweepPartialRuns, TailBuffer } from "./render-support";

const node = (script: string, o: Partial<Parameters<typeof runWorker>[0]> = {}) =>
  runWorker({ cmd: process.execPath, args: ["-e", script], timeoutMs: 10_000, ...o });
const tmp = () => mkdtempSync(path.join(tmpdir(), "statreel-sweep-"));

describe("parseWorkerLine", () => {
  it("skips chatter, parses messages, and reports (never throws on) malformed JSON lines", () => {
    expect(parseWorkerLine("remotion warning")).toEqual({ kind: "skip" });
    expect(parseWorkerLine('{"type":"progress","progress":0.5}')).toMatchObject({ kind: "msg" });
    expect(parseWorkerLine('{"type":"progress",')).toMatchObject({ kind: "bad", note: expect.stringContaining("malformed") });
    expect(parseWorkerLine('{"no":"type"}')).toMatchObject({ kind: "bad" });
  });
});

describe("TailBuffer", () => {
  it("caps at the tail", () => {
    const b = new TailBuffer(10);
    b.push("0123456789");
    b.push("abcde");
    expect(b.toString()).toBe("56789abcde");
  });
});

describe("runWorker", () => {
  it("records a malformed line as a note and still resolves with the done message", async () => {
    const notes: string[] = [];
    const done = await node(`console.log('{"type":"progress",'); console.log(JSON.stringify({type:"done",output:"x"}))`, { onNote: (n) => notes.push(n) });
    expect(done).toMatchObject({ type: "done", output: "x" });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("malformed worker line");
  });

  it("caps stderr: a flood of stderr does not grow the error beyond the tail", async () => {
    const err = await node(`process.stderr.write("x".repeat(${STDERR_CAP * 4})+"THE-END"); process.exit(3)`).catch((e: Error) => e);
    expect((err as Error).message).toContain("exited 3");
    expect((err as Error).message).toContain("THE-END");
    expect((err as Error).message.length).toBeLessThan(2000);
  });

  it("an abort kills the child and rejects as cancelled", async () => {
    const c = new AbortController();
    const p = node("setInterval(()=>{},1000)", { signal: c.signal });
    setTimeout(() => c.abort(), 150);
    await expect(p).rejects.toThrow("render cancelled");
  });

  it("an already-aborted signal never spawns", async () => {
    const c = new AbortController();
    c.abort();
    await expect(node("process.exit(0)", { signal: c.signal })).rejects.toThrow("render cancelled");
  });

  it("times out and kills a stuck worker", async () => {
    await expect(node("setInterval(()=>{},1000)", { timeoutMs: 200 })).rejects.toThrow("timed out");
  });

  it("reads the timeout from STATREEL_RENDER_TIMEOUT_MS with a 30 min default", () => {
    expect(renderTimeoutMs({})).toBe(30 * 60_000);
    expect(renderTimeoutMs({ STATREEL_RENDER_TIMEOUT_MS: "5000" })).toBe(5000);
    expect(renderTimeoutMs({ STATREEL_RENDER_TIMEOUT_MS: "nope" })).toBe(30 * 60_000);
  });
});

describe("startup sweeps", () => {
  it("sweepPartialRuns removes only run dirs without a manifest", () => {
    const root = tmp();
    const partial = path.join(root, "p1", "2026-03-01T10-00-00-000Z");
    const ok = path.join(root, "p1", "2026-03-01T11-00-00-000Z");
    const stills = path.join(root, "p1", "stills-1700000000000");
    for (const d of [partial, ok, stills]) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(partial, "raw.mp4"), "x");
    writeFileSync(path.join(ok, "manifest.json"), "{}");
    writeFileSync(path.join(ok, "video.mp4"), "v");
    expect(sweepPartialRuns(root)).toEqual([partial]);
    expect(existsSync(partial)).toBe(false);
    expect(existsSync(path.join(ok, "video.mp4"))).toBe(true);
    expect(existsSync(stills)).toBe(true);
    expect(sweepPartialRuns(path.join(root, "missing"))).toEqual([]);
  });

  it("sweepJobFiles removes job files older than the cut-off only", () => {
    const dir = tmp();
    const old = path.join(dir, "old.json");
    const fresh = path.join(dir, "fresh.json");
    writeFileSync(old, "{}");
    writeFileSync(fresh, "{}");
    const past = new Date(Date.now() - 120_000);
    utimesSync(old, past, past);
    expect(sweepJobFiles(dir, Date.now() - 60_000)).toEqual([old]);
    expect(existsSync(fresh)).toBe(true);
  });
});

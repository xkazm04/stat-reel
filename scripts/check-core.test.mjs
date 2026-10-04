// node --test scripts/  (vitest.config.ts only globs apps/ and packages/, so script tests use node:test)
import assert from "node:assert/strict";
import { test } from "node:test";
import { exitCode, formatTable, parseOnly, requirePopulation, runSteps } from "./check-core.mjs";

const steps = ["a", "b", "c"].map((name) => ({ name }));

test("every step runs even after a failure; a throwing runner is a failure", async () => {
  const ran = [];
  const results = await runSteps(steps, (s) => {
    ran.push(s.name);
    if (s.name === "a") return { ok: false, detail: "exit 1" };
    if (s.name === "b") throw new Error("boom");
    return { ok: true };
  });
  assert.deepEqual(ran, ["a", "b", "c"]);
  assert.deepEqual(results.map((r) => r.ok), [false, false, true]);
  assert.equal(results[1].detail, "boom");
  assert.equal(exitCode(results), 1);
});

test("exit code is 0 only when all pass, and never 0 for an empty run", async () => {
  assert.equal(exitCode(await runSteps(steps, () => ({ ok: true }))), 0);
  assert.equal(exitCode([]), 1);
});

test("durations come from the injected clock; table lists PASS/FAIL and the failed names", async () => {
  let t = 0;
  const results = await runSteps(steps, (s) => ({ ok: s.name !== "b", detail: s.name === "b" ? "exit 2" : undefined }), () => (t += 500));
  assert.deepEqual(results.map((r) => r.ms), [500, 500, 500]);
  const table = formatTable(results);
  assert.match(table, /^a +PASS +500ms$/m);
  assert.match(table, /^b +FAIL +500ms +exit 2$/m);
  assert.match(table, /FAILED: b$/);
  assert.match(formatTable(await runSteps(steps, () => ({ ok: true }))), /ALL PASS$/);
});

test("--only parsing: both spellings, null when absent, unknown names rejected", () => {
  const known = ["a", "b", "c"];
  assert.equal(parseOnly([], known), null);
  assert.deepEqual(parseOnly(["--only", "a,c"], known), ["a", "c"]);
  assert.deepEqual(parseOnly(["--only=b"], known), ["b"]);
  assert.throws(() => parseOnly(["--only", "zzz"], known), /unknown step/);
  assert.throws(() => parseOnly(["--only"], known), /needs a step list/);
});

test("check.mjs declares the board harness as a named, selectable step with unique names", async () => {
  const { STEPS } = await import("./check.mjs");
  const names = STEPS.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("board"), "board harness tests must be a step of just check");
  assert.deepEqual(parseOnly(["--only", "board"], names), ["board"]);
});

test("a step whose runner passes on zero inputs fails when its population is empty", () => {
  assert.equal(requirePopulation("x/*.test.mjs", ["x/a.test.mjs"]), null);
  const r = requirePopulation("x/*.test.mjs", []);
  assert.equal(r.ok, false);
  assert.match(r.detail, /no files match x\/\*\.test\.mjs/);
});

test("check.mjs node --test steps FAIL (not a vacuous PASS) when their test files are gone", async () => {
  const { nodeTestStep } = await import("./check.mjs");
  const r = nodeTestStep("scripts/no-such-dir", /\.test\.mjs$/);
  assert.equal(r.ok, false);
  assert.match(r.detail, /no files match scripts\/no-such-dir/);
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { draftPrompt } from "./draft-prompt";
import { checkFixtureDrift } from "./fixture-drift";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturesDir = path.join(root, "e2e", "fixtures", "llm");
const systemPrompt = readFileSync(path.join(root, "packages", "llm", "prompts", "era-adjusted-rankings.md"), "utf8");
// what the e2e drives: the F1 x era-adjusted cell, monetized (apps/studio createProject + e2e/m1.spec.ts)
const project = { id: "p-0a1b2c3d", title: "Era-adjusted rankings · F1", sport: "F1", use_case_id: "era-adjusted-rankings", format: "vertical", mode: "monetized" };
const input = (over: Partial<Parameters<typeof checkFixtureDrift>[0]> = {}) => ({ fixturesDir, prompt: draftPrompt(project), systemPrompt, vars: { PROJECT: project.id }, ...over });

describe("LLM replay fixture drift", () => {
  it("the committed fixture matches the standard first prompt and system prompt", () => {
    const r = checkFixtureDrift(input());
    expect(r.ok, r.message).toBe(true);
    // surfaced in the test output: which model recorded it and how long the run was
    console.info(`[llm fixture] ${r.key} model=${r.meta?.model} turns=${r.meta?.turns} cost_usd=${r.meta?.cost_usd}`);
    expect(r.meta?.model).toMatch(/^claude-/);
    expect(r.meta?.turns).toBeGreaterThan(0);
  });

  it("the key does not depend on the run-specific project id", () => {
    expect(checkFixtureDrift(input({ prompt: draftPrompt({ ...project, id: "p-ffffffff" }), vars: { PROJECT: "p-ffffffff" } })).key).toBe(checkFixtureDrift(input()).key);
  });

  it("an edited system prompt orphans the fixture and the message names the record command and the audio cost", () => {
    const r = checkFixtureDrift(input({ systemPrompt: `${systemPrompt}\nExtra rule.` }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("LLM_RECORD=1");
    expect(r.message).toContain("pnpm e2e:live");
    expect(r.message).toMatch(/AUDIO_MODE=live.*ElevenLabs/);
    expect(r.message).toContain(r.file);
  });

  it("an edited user prompt orphans it too", () => {
    expect(checkFixtureDrift(input({ prompt: `${draftPrompt(project)} Be brief.` })).ok).toBe(false);
  });
});

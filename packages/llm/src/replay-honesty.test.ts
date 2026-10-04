import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { draftPrompt } from "./draft-prompt";
import {
  fixtureKey,
  isFailedToolContent,
  isFailedToolResult,
  isRefusal,
  type LlmEvent,
  parseStreamLine,
  ReplayEngine,
  ReplayRegressionError,
  stderrTail,
  storedSuccessfully,
} from "./index";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const stream = (toolName: string, recordedContent: string, recordedError = false) => [
  { type: "system", subtype: "init", session_id: "s" },
  {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t1", name: `mcp__statreel__${toolName}`, input: { project: "p" } }] },
  },
  {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "t1", content: recordedContent, is_error: recordedError }],
    },
  },
  { type: "result", subtype: "success", result: "ok", session_id: "s" },
];
function engineFor(
  lines: object[],
  execute: (t: string, i: unknown) => Promise<unknown>,
  options?: { allowRegressions?: boolean },
) {
  const dir = mkdtempSync(path.join(tmpdir(), "llm-honest-"));
  writeFileSync(
    path.join(dir, `${fixtureKey("claude-code", "go", undefined)}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n"),
  );
  return new ReplayEngine("claude-code", dir, execute, options);
}
const run = (e: ReplayEngine, onEvent: (ev: LlmEvent) => void = () => {}) =>
  e.run({ prompt: "go", mcpConfigPath: "m", onEvent });

describe("isFailedToolResult (the mcp.ts isFailedResult rule)", () => {
  it("flags an error string or a non-empty errors array only", () => {
    expect(isFailedToolResult({ error: "boom" })).toBe(true);
    expect(isFailedToolResult({ version: null, errors: ["bad"] })).toBe(true);
    expect(isFailedToolResult({ version: 2, errors: [] })).toBe(false);
    expect(isFailedToolResult({ error: "" })).toBe(false);
    expect(isFailedToolResult([1, 2])).toBe(false);
    expect(isFailedToolResult(null)).toBe(false);
    expect(isFailedToolResult("error")).toBe(false);
  });
  it("applies the rule to JSON text and treats non-JSON as not failed", () => {
    expect(isFailedToolContent('{"errors":["x"]}')).toBe(true);
    expect(isFailedToolContent("not json")).toBe(false);
  });
});

describe("replay honesty (a handler regression is not masked by the recorded flag)", () => {
  it("throws a named error when a call that succeeded in the recording now errors", async () => {
    const e = engineFor(stream("set_props", '{"version":1}'), async () => ({ version: null, errors: ["bad props"] }));
    const err = await run(e).catch((x) => x);
    expect(err).toBeInstanceOf(ReplayRegressionError);
    expect(err.name).toBe("ReplayRegressionError");
    expect(err.message).toMatch(/set_props succeeded in the recording but now fails: .*bad props/);
  });

  it("with allowRegressions the live failure is reported as is_error instead", async () => {
    const e = engineFor(stream("set_props", '{"version":1}'), async () => ({ error: "nope" }), {
      allowRegressions: true,
    });
    const seen: LlmEvent[] = [];
    await run(e, (ev) => seen.push(ev));
    expect(seen.find((x) => x.type === "tool_result")).toMatchObject({ is_error: true, content: '{"error":"nope"}' });
  });

  it("recomputes is_error from the live result: a recorded error that now succeeds is not an error", async () => {
    const e = engineFor(stream("set_props", '{"errors":["old"]}', true), async () => ({ version: 3 }));
    const seen: LlmEvent[] = [];
    await run(e, (ev) => seen.push(ev));
    expect(seen.find((x) => x.type === "tool_result")).toMatchObject({ is_error: false });
  });

  it("a recorded failure that still fails replays as a failure without throwing", async () => {
    const e = engineFor(stream("set_props", '{"errors":["old"]}', true), async () => ({ errors: ["still"] }));
    const seen: LlmEvent[] = [];
    await run(e, (ev) => seen.push(ev));
    expect(seen.find((x) => x.type === "tool_result")).toMatchObject({ is_error: true });
  });
});

describe("the e2e fixture key is untouched by this lane", () => {
  it("still resolves the committed replay fixture for the standard first prompt", () => {
    const project = {
      id: "p-0a1b2c3d",
      title: "Era-adjusted rankings · F1",
      sport: "F1",
      use_case_id: "era-adjusted-rankings",
      format: "vertical",
      mode: "monetized",
    };
    const system = readFileSync(path.join(root, "packages", "llm", "prompts", "era-adjusted-rankings.md"), "utf8");
    const prompt = draftPrompt(project).split(project.id).join("{{PROJECT}}");
    expect(fixtureKey("claude-code", prompt, undefined, system)).toBe("cd4f7d4ade65d0bffd52472c");
  });
});

describe("refusal precision", () => {
  const call = (tool: string, id: string): LlmEvent => ({ type: "tool_call", id, tool, input: {} });
  const res = (content: string, id: string, is_error = false): LlmEvent => ({
    type: "tool_result",
    id,
    content,
    is_error,
  });
  const result = (text: string, extra: Record<string, unknown> = {}): LlmEvent[] =>
    parseStreamLine(JSON.stringify({ type: "result", subtype: "success", result: text, session_id: "s", ...extra }));

  it("a wrap-up that merely says I won't, after a successful set_props, is not a refusal", () => {
    const events = [
      call("set_props", "a"),
      res('{"version":1}', "a"),
      ...result("Props stored. I won't change the other scenes unless you ask."),
    ];
    expect(events.at(-1)).toMatchObject({ refusal: true }); // the wording alone still matches...
    expect(storedSuccessfully(events)).toBe(true);
    expect(isRefusal(events)).toBe(false); // ...but the stored props win
  });

  it("a successful write_script also counts as stored work", () => {
    expect(
      isRefusal([call("write_script", "a"), res('{"words":80}', "a"), ...result("I can't help with more than this.")]),
    ).toBe(false);
  });

  it("failed set_props calls do not protect a refusing wrap-up", () => {
    expect(
      isRefusal([call("set_props", "a"), res('{"errors":["bad"]}', "a", true), ...result("I won't continue.")]),
    ).toBe(true);
    expect(isRefusal([call("set_props", "a"), res('{"errors":["bad"]}', "a"), ...result("I won't continue.")])).toBe(
      true,
    ); // no is_error flag: the content decides
  });

  it("a non-storing tool success does not protect it", () => {
    expect(isRefusal([call("query", "a"), res("{}", "a"), ...result("I can't help with that request.")])).toBe(true);
  });

  it("a typographic apostrophe (U+2019) is the same wording", () => {
    for (const text of ["I can’t help with that request.", "I won’t do that.", "I can’t help with this."]) {
      expect(isRefusal(result(text))).toBe(true);
    }
  });

  it("ordinary text is not a refusal", () => {
    expect(isRefusal(result("All done."))).toBe(false);
  });

  it("an explicit CLI refusal signal always counts, even after stored work", () => {
    const events = [
      call("set_props", "a"),
      res('{"version":1}', "a"),
      ...result("Declined.", { stop_reason: "refusal" }),
    ];
    expect(events.at(-1)).toMatchObject({ refusal: true, refusal_explicit: true });
    expect(isRefusal(events)).toBe(true);
  });

  it("a run without a result event is not a refusal", () => {
    expect(isRefusal([call("set_props", "a")])).toBe(false);
  });
});

describe("stderr tail", () => {
  it("keeps the last 800 chars, trimmed", () => {
    expect(stderrTail("  \n")).toBe("");
    expect(stderrTail(`${"x".repeat(1000)}END\n`)).toHaveLength(800);
    expect(stderrTail(`${"x".repeat(1000)}END\n`).endsWith("END")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { EnqueueGenerationSchema, GenerationConfigSchema, extraArgsProblem, perTypeValue } from "./generation";
import { caseStage } from "./pipeline";

const job = (type: string, status: string, at = "2026-10-03T10:00:00Z") => ({ type, status, created_at: at });

describe("caseStage (SPEC D.2)", () => {
  const accepted = { status: "accepted" };
  it("proposed and rejected ideas", () => {
    expect(caseStage({ status: "pending" }, [], [])).toBe("proposed");
    expect(caseStage({ status: "rejected" }, [], [job("visual_options", "queued")])).toBe("rejected");
  });
  it("visual job states", () => {
    expect(caseStage(accepted, [], [job("visual_options", "queued")])).toBe("visuals_queued");
    expect(caseStage(accepted, [], [job("visual_options", "running")])).toBe("visuals_running");
    expect(caseStage(accepted, [], [job("visual_options", "failed")])).toBe("visuals_failed");
    expect(caseStage(accepted, [], [job("visual_options", "cancelled")])).toBe("visuals_failed");
  });
  it("visuals_ready while a variant is pending, even after the job finished", () => {
    expect(caseStage(accepted, [{ status: "pending" }, { status: "pending" }], [job("visual_options", "done")])).toBe("visuals_ready");
  });
  it("failed visual job with a pending variant stays visuals_ready (D.2: no variant pending is required for failed)", () => {
    expect(caseStage(accepted, [{ status: "pending" }], [job("visual_options", "failed")])).toBe("visuals_ready");
  });
  it("an accepted variant archives its siblings and the stage follows the video job", () => {
    const items = [{ status: "accepted" }, { status: "archived" }, { status: "archived" }];
    expect(caseStage(accepted, items, [job("visual_options", "done")], { gateOk: false })).toBe("data_blocked");
    expect(caseStage(accepted, items, [job("visual_options", "done"), job("generate_video", "queued", "2026-10-03T11:00:00Z")])).toBe("video_queued");
    expect(caseStage(accepted, items, [job("generate_video", "running")])).toBe("video_running");
    expect(caseStage(accepted, items, [job("generate_video", "failed")])).toBe("video_failed");
    expect(caseStage(accepted, items, [job("generate_video", "done")], { videos: 1 })).toBe("video_ready");
  });
  it("the latest job of a type wins", () => {
    const jobs = [job("visual_options", "failed", "2026-10-03T09:00:00Z"), job("visual_options", "queued", "2026-10-03T10:00:00Z")];
    expect(caseStage(accepted, [], jobs)).toBe("visuals_queued");
  });
});

describe("generation schemas", () => {
  it("enqueue validates ids", () => {
    expect(EnqueueGenerationSchema.safeParse({ type: "visual_options", case_id: "ci-0123abcd" }).success).toBe(true);
    expect(EnqueueGenerationSchema.safeParse({ type: "visual_options", case_id: "../etc" }).success).toBe(false);
    expect(EnqueueGenerationSchema.safeParse({ type: "generate_video", case_id: "ci-0123abcd", board_item_id: "x" }).success).toBe(false);
  });
  it("defaults: no budget, no timeout, dontAsk, web on", () => {
    const c = GenerationConfigSchema.parse({});
    expect(c.budgetUsd).toBeNull();
    expect(c.timeoutMin).toBeNull();
    expect(c.permissionMode).toBe("dontAsk");
    expect(c.web.search && c.web.fetch).toBe(true);
    expect(c.model).toBe("sonnet");
  });
  it("refuses bypassPermissions and dangerous extraArgs", () => {
    expect(GenerationConfigSchema.safeParse({ permissionMode: "bypassPermissions" }).success).toBe(false);
    expect(extraArgsProblem(["--dangerously-skip-permissions"])).toMatch(/dangerous|refused/);
    expect(extraArgsProblem(["--permission-mode", "bypassPermissions"])).toBeTruthy();
    expect(extraArgsProblem(["--allowedTools", "Bash(git:*)"])).toBeTruthy();
    expect(extraArgsProblem(["--tools", "Read,PowerShell"])).toBeTruthy();
    expect(extraArgsProblem(["Bash"])).toBeTruthy();
    expect(extraArgsProblem(["--effort", "high"])).toBeNull();
    expect(GenerationConfigSchema.safeParse({ cli: { extraArgs: ["--add-dir", "/"] } }).success).toBe(false);
  });
  // every flag below exists in `claude --help` (2026-10-04); each one widens the sandbox, swaps the session or
  // the prompt, or overrides a flag buildClaudeArgs already sets (model, budget, output stream)
  it.each([
    ["--plugin-dir", "x"], ["--plugin-url", "https://x/p.zip"], ["--agents", "{}"], ["--agent", "x"], ["--setting-sources", "user"],
    ["--permission-prompt-tool", "x"], ["--chrome"], ["--ide"], ["--remote-control"], ["--cloud"], ["--worktree"], ["--tmux"],
    ["--teleport"], ["--from-pr"], ["--resume", "s"], ["--continue"], ["--fork-session"], ["--session-id", "u"], ["--file", "f"],
    ["--debug-file", "C:/x.log"], ["--system-prompt", "x"], ["--append-system-prompt", "x"], ["--max-budget-usd", "999"],
    ["--output-format", "text"], ["--input-format", "stream-json"], ["--model", "opus"], ["--fallback-model", "opus"],
    ["--background"], ["--bg"], ["--effort", "high", "-r", "s"], ["--effort", "high", "-c"], ["--effort", "high", "-w"],
    ["--max-budget-usd=999"],
  ])("refuses %s (and its value) in extraArgs", (...args) => {
    expect(extraArgsProblem(args)).toMatch(/runner owns/);
    expect(GenerationConfigSchema.safeParse({ cli: { extraArgs: args } }).success).toBe(false);
  });
  it("still allows flags that change nothing the runner owns", () => {
    for (const args of [["--effort", "high"], ["--betas", "x"], ["--autocompact", "auto"]]) expect(extraArgsProblem(args)).toBeNull();
  });
  it("model id is pattern checked", () => {
    expect(GenerationConfigSchema.safeParse({ model: "x; rm -rf /" }).success).toBe(false);
  });
  it("per-type numbers", () => {
    expect(perTypeValue(null, "visual_options")).toBeNull();
    expect(perTypeValue(5, "generate_video")).toBe(5);
    expect(perTypeValue({ visual_options: 3 }, "generate_video")).toBeNull();
    expect(perTypeValue({ visual_options: 3 }, "visual_options")).toBe(3);
  });
});

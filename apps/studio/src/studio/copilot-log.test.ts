import { describe, expect, it } from "vitest";
import type { LlmEvent } from "../api";
import { activeLlmJob, isNearBottom, mergeEvents, toRows } from "./copilot-log";

const t = (text: string): LlmEvent => ({ type: "text", text });
const call = (id: string): LlmEvent => ({ type: "tool_call", id, tool: "mcp__statreel__get_props", input: {} });
const res = (id: string): LlmEvent => ({ type: "tool_result", id, content: "{}" });

describe("mergeEvents", () => {
  it("appends live events the base lacks", () => {
    expect(mergeEvents([t("a")], [t("b")])).toEqual([t("a"), t("b")]);
  });
  it("drops the live head that a refetch already persisted", () => {
    const base = [t("a"), call("1"), res("1")];
    const live = [call("1"), res("1"), t("b")];
    expect(mergeEvents(base, live)).toEqual([t("a"), call("1"), res("1"), t("b")]);
  });
  it("is idempotent when base already holds everything live has", () => {
    const base = [t("a"), t("b")];
    expect(mergeEvents(base, [t("a"), t("b")])).toEqual(base);
  });
  it("handles empty sides", () => {
    expect(mergeEvents([], [t("a")])).toEqual([t("a")]);
    expect(mergeEvents([t("a")], [])).toEqual([t("a")]);
  });
});

describe("toRows keys", () => {
  it("keys tools by call id and others by ordinal within their kind, stable under append", () => {
    const evs = [t("a"), call("x"), res("x"), t("b")];
    const keys = toRows(evs).map((r) => r.key);
    expect(keys).toEqual(["text:0", "tool:x", "text:1"]);
    expect(
      toRows([...evs, t("c")])
        .map((r) => r.key)
        .slice(0, 3),
    ).toEqual(keys);
  });
  it("attaches a result to its call and keeps keys unique", () => {
    const rows = toRows([call("x"), res("x"), res("orphan")]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(rows[0]?.k === "tool" && rows[0].result?.content).toBe("{}");
  });
});

describe("helpers", () => {
  it("isNearBottom", () => {
    expect(isNearBottom(1000, 561, 400)).toBe(true);
    expect(isNearBottom(1000, 100, 400)).toBe(false);
  });
  it("activeLlmJob picks only a live llm job", () => {
    expect(
      activeLlmJob([
        { kind: "render", status: "running" },
        { kind: "llm", status: "succeeded" },
      ]),
    ).toBeNull();
    expect(activeLlmJob([{ kind: "llm", status: "queued" }])?.kind).toBe("llm");
  });
});

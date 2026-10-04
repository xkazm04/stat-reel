import { describe, expect, it } from "vitest";
import { archiveReason, isSuperseded, reArchiveReason, restoreLabel, restoresTo } from "./archived";

describe("restoresTo (mirrors the server's statusBeforeArchive)", () => {
  it.each([
    [null, "pending"],
    ["superseded", "pending"],
    ["accept", "accepted"],
    ["reject_style", "rejected"],
    ["reject_case", "rejected"],
    ["reject_both", "rejected"],
    ["reject_short", "rejected"],
  ] as const)("%s -> %s", (decision, status) => {
    expect(restoresTo(decision)).toBe(status);
  });
});

describe("archiveReason", () => {
  it("prefers the recorded reason and never mistakes the decision note for it", () => {
    expect(
      archiveReason({ archive_reason: " off-brief ", note: "too many bars", decision: "reject_style" }, "item"),
    ).toEqual({ text: "off-brief", legacy: false });
  });
  it("a legacy design carries its reason in note", () => {
    expect(archiveReason({ archive_reason: null, note: "headline format", decision: "accept" }, "item")).toEqual({
      text: "headline format",
      legacy: true,
    });
  });
  it("a legacy idea only does when it was undecided", () => {
    expect(archiveReason({ archive_reason: null, note: "dup run", decision: null }, "idea")).toEqual({
      text: "dup run",
      legacy: true,
    });
    expect(archiveReason({ archive_reason: null, note: "five years", decision: "reject_short" }, "idea")).toEqual({
      text: null,
      legacy: false,
    });
  });
  it("no reason recorded is null, not an invented one", () => {
    expect(archiveReason({ archive_reason: null, note: null, decision: null }, "item")).toEqual({
      text: null,
      legacy: false,
    });
    expect(archiveReason({ archive_reason: "  ", note: null, decision: null }, "idea").text).toBeNull();
  });
});

describe("labels", () => {
  it("names the state the click restores", () => {
    expect(restoreLabel("accept")).toBe("Restore · back to accepted");
    expect(restoreLabel(null)).toBe("Restore · back to pending");
  });
  it("flags the superseded sibling marker", () => {
    expect(isSuperseded("superseded")).toBe(true);
    expect(isSuperseded("accept")).toBe(false);
  });
  it("re-archives with its own reason, else a stated one", () => {
    expect(reArchiveReason({ text: "off-brief", legacy: false })).toBe("off-brief");
    expect(reArchiveReason({ text: null, legacy: false })).toMatch(/restore undone/);
  });
});

import { describe, expect, it } from "vitest";
import { hasCaptionSidecar, hasChecks, isNewerRender } from "./render-gate";

describe("isNewerRender", () => {
  const rs = [{ id: "c" }, { id: "b" }, { id: "a" }];
  it("is false when nothing is pinned or the latest is pinned", () => {
    expect(isNewerRender(rs, null)).toBe(false);
    expect(isNewerRender(rs, "c")).toBe(false);
  });
  it("is true when an older render is pinned", () => {
    expect(isNewerRender(rs, "a")).toBe(true);
  });
  it("is false for an unknown pin or no renders", () => {
    expect(isNewerRender(rs, "zzz")).toBe(false);
    expect(isNewerRender([], "a")).toBe(false);
  });
});

describe("hasCaptionSidecar", () => {
  it("only when the manifest names the file", () => {
    expect(hasCaptionSidecar({ captions: { sidecar: ["captions.srt", "captions.vtt"] } }, "captions.vtt")).toBe(true);
    expect(hasCaptionSidecar({ captions: { sidecar: [] } }, "captions.vtt")).toBe(false);
    expect(hasCaptionSidecar(undefined, "captions.vtt")).toBe(false);
  });
});

describe("hasChecks", () => {
  it("rejects null and empty", () => {
    expect(hasChecks(null)).toBe(false);
    expect(hasChecks({})).toBe(false);
    expect(hasChecks({ duration_s: 40 })).toBe(true);
  });
});

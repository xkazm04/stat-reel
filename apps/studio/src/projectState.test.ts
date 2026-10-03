import { describe, expect, it } from "vitest";
import { STAGE_LABEL, STAGES } from "./logic";
import { bucketCounts, jobFlag, modeWord, PROJECT_STATE, projectState } from "./projectState";

describe("project state table", () => {
  it("covers every stage with logic.ts's word", () => {
    expect(Object.keys(PROJECT_STATE).sort()).toEqual([...STAGES].sort());
    for (const s of STAGES) expect(PROJECT_STATE[s].word).toBe(STAGE_LABEL[s]);
  });
  it("buckets sum to the total for every status, and for an unknown one", () => {
    const all = [...STAGES, "mystery"].map((status) => ({ status }));
    const c = bucketCounts(all);
    expect(c.total).toBe(7);
    expect(c.published + c.refused + c.gated + c.notGated).toBe(c.total);
    expect(c).toMatchObject({ published: 1, refused: 1, gated: 1, notGated: 4 });
    for (const s of [...STAGES, "mystery"]) {
      const one = bucketCounts([{ status: s }]);
      expect(one.published + one.refused + one.gated + one.notGated).toBe(1);
    }
  });
  it("has the gated bucket the old counts dropped", () => {
    expect(bucketCounts([{ status: "gated" }]).gated).toBe(1);
  });
  it("words job outcomes without raw tokens", () => {
    expect(jobFlag({ kind: "render", status: "failed", error: "ffmpeg died" })).toBe("Render failed: ffmpeg died");
    expect(jobFlag({ kind: "llm", status: "refused" })).toBe("Co-pilot draft refused");
    expect(jobFlag({ kind: "weird", status: "failed" })).toBe("A job failed");
    expect(jobFlag({ kind: "render", status: "running" })).toBeNull();
  });
  it("carries the gate flag only for a render the gate refused", () => {
    expect(projectState("rendered").flag).toMatch(/gate/);
    expect(projectState("gated").flag).toBeNull();
  });
  it("uses the list view's mode words", () => {
    expect(modeWord("monetized")).toBe("Monetized");
    expect(modeWord("non_commercial")).toBe("Non-commercial");
  });
});

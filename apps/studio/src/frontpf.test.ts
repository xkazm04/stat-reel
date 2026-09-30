import { describe, expect, it } from "vitest";
import { acrossCount, clock, numberWord, registryGrid, registryShare, sceneStrip, splitNeq, studioCounts } from "./frontpf";

describe("frontpf", () => {
  it("counts sources across the line per mode", () => {
    const s = [{ verdict: "legal" }, { verdict: "non_commercial" }, { verdict: "paid" }, { verdict: "avoid" }, { verdict: "legal" }];
    expect(acrossCount(s, "monetized")).toBe(2);
    expect(acrossCount(s, "non_commercial")).toBe(3);
  });
  it("counts the studio from statuses", () => {
    const c = studioCounts([{ status: "published" }, { status: "rendered" }, { status: "idea" }, { status: "scripted" }, { status: "gated" }]);
    expect(c).toEqual({ total: 5, published: 1, refused: 1, notGated: 2 });
  });
  it("groups the registry by sport and verdict", () => {
    const g = registryGrid([
      { id: "a", verdict: "legal", sport: "F1" },
      { id: "b", verdict: "avoid", sport: "F1" },
      { id: "c", verdict: "legal", sport: "all" },
    ]);
    expect(g.map((x) => x.group)).toEqual(["F1", "NBA", "NHL", "Soccer", "all"]);
    expect(g[0]?.total).toBe(2);
    expect(g[0]?.cells.avoid.map((s) => s.id)).toEqual(["b"]);
    expect(g[4]?.cells.legal.map((s) => s.id)).toEqual(["c"]);
  });
  it("moves the registry line with the mode", () => {
    expect(registryShare("monetized")).toBeCloseTo(0.7199, 3);
    expect(registryShare("non_commercial")).toBeCloseTo(0.4398, 3);
  });
  it("splits a hook at the not-equal sign", () => {
    expect(splitNeq("Most wins ≠ most dominant")).toEqual(["Most wins", "most dominant"]);
    expect(splitNeq("Plain")).toEqual(["Plain", null]);
  });
  it("uses measured timing, else an even draft split", () => {
    const scenes = [
      { id: "s1", kind: "hook" },
      { id: "s2", kind: "close" },
    ];
    const m = sceneStrip(scenes, { duration_s: 10, scenes: [{ scene_id: "s1", start_s: 0, end_s: 3 }, { scene_id: "s2", start_s: 3, end_s: 10 }] }, 60);
    expect(m.measured).toBe(true);
    expect(m.scenes[1]).toEqual({ id: "s2", label: "close", start: 3, end: 10 });
    const d = sceneStrip(scenes, null, 60);
    expect(d.measured).toBe(false);
    expect(d.scenes[1]?.start).toBe(30);
  });
  it("formats words and the clock", () => {
    expect(numberWord(10)).toBe("Ten");
    expect(numberWord(14)).toBe("14");
    expect(clock(62.5)).toBe("1:02.500");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRAME_STAT_BAR_HEIGHTS, FRAME_STAT_VIEWBOX, frameStatRects, frameStatSvg } from "./logo";

const count = (rs: ReturnType<typeof frameStatRects>, role: string) => rs.filter((r) => r.role === role).length;

describe("frameStatRects", () => {
  it("t=1: 1 frame, 12 holes, 1 window, 4 bars with the prototype heights", () => {
    const rs = frameStatRects(1);
    expect([count(rs, "frame"), count(rs, "hole"), count(rs, "window"), count(rs, "bar")]).toEqual([1, 12, 1, 4]);
    expect(rs.filter((r) => r.role === "bar").map((r) => r.h)).toEqual([...FRAME_STAT_BAR_HEIGHTS]);
    expect(rs.filter((r) => r.role === "bar").map((r) => r.x)).toEqual([17, 35, 53, 71]);
    expect(rs.filter((r) => r.role === "bar").every((r) => r.y + r.h === 67)).toBe(true);
  });
  it("t=0: no bars; bars appear one by one while building in", () => {
    expect(count(frameStatRects(0), "bar")).toBe(0);
    expect(count(frameStatRects(0.3), "bar")).toBeGreaterThan(0);
    expect(count(frameStatRects(0.3), "bar")).toBeLessThan(4);
  });
  it("is deterministic and the viewbox crops to the frame", () => {
    expect(frameStatRects(0.5)).toEqual(frameStatRects(0.5));
    expect(FRAME_STAT_VIEWBOX).toBe("6 14 88 72");
  });
  it("matches the master SVG rect list from the spec reference", () => {
    const svg = readFileSync(new URL("../../../docs/specs/2026-10-03-app-refresh/reference/C-frame-stat-master.svg", import.meta.url), "utf8");
    const master = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"/g)].map((m) =>
      m.slice(1).map(Number),
    );
    const ours = frameStatRects(1).map((r) => [r.x, r.y, r.w, r.h, r.rx]);
    expect(ours).toEqual(master);
  });
  it("renders standalone svg text", () => {
    expect(frameStatSvg({ ink: "#12161a", paper: "#eceff2" })).toContain('viewBox="6 14 88 72"');
  });
});

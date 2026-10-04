import { describe, expect, it } from "vitest";
import { laneArtCached, laneArtMarkup } from "./LaneArt";

describe("LaneArt drawing cache", () => {
  it("keeps one drawing per use case however often the art remounts", () => {
    // every client mount gets a fresh useId, so the gradient id differs per mount (the Front's
    // lane stage remounts on each 3.2 s rotation step and on every hover)
    const before = laneArtCached();
    const ids = Array.from({ length: 50 }, (_, i) => `lartgr${i.toString(32)}`);
    for (const g of ids) laneArtMarkup("era-adjusted-rankings", g);
    expect(laneArtCached() - before).toBe(1);
  });
  it("each mount still references its own gradient", () => {
    const a = laneArtMarkup("career-wins-race", "lartgA");
    const b = laneArtMarkup("career-wins-race", "lartgB");
    expect(a).toContain("url(#lartgA)");
    expect(b).toContain("url(#lartgB)");
    expect(b).not.toContain("lartgA");
  });
});

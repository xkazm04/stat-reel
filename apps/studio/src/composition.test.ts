import { afterEach, describe, expect, it, vi } from "vitest";

const COMPOSITIONS = "@statreel/compositions";

describe("loadComposition", () => {
  afterEach(() => {
    vi.doUnmock(COMPOSITIONS);
    vi.resetModules();
  });

  it("tries again after a failed load instead of keeping the failure for the life of the tab", async () => {
    vi.doMock(COMPOSITIONS, () => {
      throw new Error("chunk failed to load");
    });
    const { loadComposition } = await import("./composition");
    expect((await loadComposition()).status).toBe("missing");

    // the chunk is reachable again (dev server back, build fixed): the next mount must get it
    vi.doUnmock(COMPOSITIONS);
    vi.doMock(COMPOSITIONS, () => ({
      EraAdjustedSlope: () => null,
      FPS: 30,
      COMPOSITIONS: [],
      durationInFramesFor: () => 900,
    }));
    expect((await loadComposition()).status).toBe("ready");
  });

  it("loads a good chunk once and reuses it", async () => {
    let evaluated = 0;
    vi.doMock(COMPOSITIONS, () => {
      evaluated++;
      return { EraAdjustedSlope: () => null, FPS: 30, COMPOSITIONS: [], durationInFramesFor: () => 900 };
    });
    const { loadComposition } = await import("./composition");
    const a = await loadComposition();
    const b = await loadComposition();
    expect(a.status).toBe("ready");
    expect(b).toBe(a);
    expect(evaluated).toBe(1);
  });
});

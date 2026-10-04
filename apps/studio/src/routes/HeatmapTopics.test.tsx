import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The topics view's empty state, rendered without a router or a server: the hooks it reads are stubbed.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: unknown }) => h("a", null, children as never),
  useNavigate: () => () => undefined,
}));
vi.mock("../data", () => ({
  useHeatmapTopics: () => ({
    isLoading: false,
    isError: false,
    data: { generated_at: "2026-10-04T00:00:00Z", buckets: [], max_videos: 0, topics: [] },
  }),
}));

const { HeatmapTopics } = await import("./HeatmapTopics");

describe("HeatmapTopics empty state", () => {
  it("the 'Show all topics' it names is on screen, so the controlled list is reachable with no rows", () => {
    const out = renderToStaticMarkup(h(HeatmapTopics));
    expect(out).toContain('data-testid="topics-empty"');
    expect(out).toContain("Show all topics");
    expect(out).toContain('data-testid="topics-show-all"');
  });
});

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The layer's states, rendered without a router or a server: the hooks it reads are stubbed.
const state = vi.hoisted(() => ({
  hm: { isLoading: false, isError: false, isFetching: false, error: null as unknown, data: undefined as unknown, refetch: () => {} },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: unknown }) => h("a", null, children as never),
  useNavigate: () => () => undefined,
  useParams: () => ({ usecase: "era-adjusted-rankings", sport: "F1" }),
  useSearch: () => ({ mode: "monetized" }),
}));
vi.mock("../data", () => ({
  useHeatmap: () => state.hm,
  useSources: () => ({ data: undefined }),
  useProjects: () => ({ data: undefined }),
}));
vi.mock("../components/createProject", () => ({ useCreateProject: () => ({ isPending: false, isError: false }) }));

const { HeatmapCellLayer } = await import("./HeatmapCell");

describe("HeatmapCellLayer states", () => {
  it("a heatmap that failed to load is a failure with Retry, not 'No such cell'", () => {
    state.hm = { ...state.hm, isError: true, error: new Error("API 500: boom"), data: undefined };
    const out = renderToStaticMarkup(h(HeatmapCellLayer));
    expect(out).not.toContain("No such cell");
    expect(out).toContain("The heatmap did not load");
    expect(out).toContain(">Retry<");
    expect(out).toContain("Back to the grid");
  });
  it("a loaded heatmap without that cell still says so", () => {
    state.hm = { ...state.hm, isError: false, error: null, data: { usecases: [], cells: [], trend: [] } };
    const out = renderToStaticMarkup(h(HeatmapCellLayer));
    expect(out).toContain("No such cell");
    expect(out).not.toContain(">Retry<");
  });
});

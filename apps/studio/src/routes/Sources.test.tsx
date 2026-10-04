import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The sources desk's states, rendered without a server: the data hook is stubbed.
const state = vi.hoisted(() => ({
  q: {
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null as unknown,
    data: undefined as unknown,
    refetch: () => {},
  },
}));
vi.mock("../data", () => ({ useSources: () => state.q }));
// staged arrival waits for timers a static render never runs: mount the sections at once
vi.mock("../components/arrive", () => ({ Defer: ({ children }: { children: unknown }) => children }));

const { SourcesPage } = await import("./Sources");
const render = () => renderToStaticMarkup(h(SourcesPage));

describe("SourcesPage", () => {
  it("a registry that failed to load offers Retry, like every other screen's failure", () => {
    state.q = { ...state.q, isError: true, error: new Error("API 500: boom"), data: undefined };
    const out = render();
    expect(out).toContain("The registry did not load");
    expect(out).toContain(">Retry<");
  });

  it("a registry with no row to show says so instead of drawing a header-only table", () => {
    state.q = { ...state.q, isError: false, error: null, data: { sources: [], capabilities: [] } };
    const out = render();
    expect(out).toContain("No source to show");
    expect(out).not.toContain('class="tbl tbl--sources"');
  });
});

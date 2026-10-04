import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The sources desk's failure state, rendered without a server: the data hook is stubbed.
vi.mock("../data", () => ({
  useSources: () => ({ isLoading: false, isError: true, isFetching: false, error: new Error("API 500: boom"), data: undefined, refetch: () => {} }),
}));

const { SourcesPage } = await import("./Sources");

describe("SourcesPage", () => {
  it("a registry that failed to load offers Retry, like every other screen's failure", () => {
    const out = renderToStaticMarkup(h(SourcesPage));
    expect(out).toContain("The registry did not load");
    expect(out).toContain(">Retry<");
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER } from "./board";
import { filterFromSearch, parseBoardSearch, searchFromFilter } from "./search";

describe("board search params", () => {
  it("a clean URL is the pending queue", () => {
    expect(parseBoardSearch({})).toEqual({});
    expect(filterFromSearch(parseBoardSearch({}))).toEqual(DEFAULT_FILTER);
  });
  it("keeps variant and tab, drops unknown values", () => {
    expect(parseBoardSearch({ v: 2, tab: "styles" })).toEqual({ v: 2, tab: "styles" });
    expect(parseBoardSearch({ v: "9", tab: "nope", st: "bogus" })).toEqual({ v: 1, tab: "designs" });
  });
  it("round-trips status, style and case through the URL", () => {
    const f = { status: "all", style: "style:loom", case: "uc:x" } as const;
    const search = searchFromFilter(f);
    expect(search).toEqual({ st: "all", style: "style:loom", case: "uc:x" });
    expect(filterFromSearch(parseBoardSearch(search))).toEqual(f);
  });
  it("accepts the rejected lane as a status", () => {
    expect(parseBoardSearch({ st: "rejected" })).toEqual({ st: "rejected" });
  });
  it("omits defaults so the URL stays clean", () => {
    expect(searchFromFilter(DEFAULT_FILTER)).toEqual({ st: undefined, style: undefined, case: undefined });
    expect(parseBoardSearch({ st: "pending", style: "all" })).toEqual({});
  });
});

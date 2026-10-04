import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER } from "./board";
import { designsSearchForCase, filterFromSearch, parseBoardSearch, searchFromFilter } from "./search";

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

describe("designsSearchForCase (the visuals-ready badge link)", () => {
  const gen = { case_idea_id: "ci-1", use_case_id: null, proposed_case: { name: "Monaco, 1950 to 2026", pitch: "p" } };
  it("filters to the case the generated designs carry, pending by default, with no tab", () => {
    const s = designsSearchForCase("ci-1", "ignored title", [{ case_idea_id: "ci-2", use_case_id: "u", proposed_case: null }, gen]);
    expect(s).toEqual({ case: "new:monaco-1950-to-2026", st: undefined });
    expect(filterFromSearch(parseBoardSearch(s))).toEqual({ status: "pending", style: "all", case: "new:monaco-1950-to-2026" });
  });
  it("falls back to the title key before any design exists, and carries a non-default status", () => {
    expect(designsSearchForCase("ci-9", "Monaco, 1950 to 2026", [], "all")).toEqual({ case: "new:monaco-1950-to-2026", st: "all" });
  });
});

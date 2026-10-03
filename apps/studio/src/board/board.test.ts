import { describe, expect, it } from "vitest";
import type { BoardItem } from "../api";
import {
  axisOptions,
  axisVerdict,
  caseOf,
  countItems,
  decisionForKey,
  factRefs,
  filterItems,
  groupFacts,
  groupItems,
  itemState,
  justify,
  ledger,
  linearMove,
  NO_FILTER,
  neighbourAfterRemoval,
  nextPending,
  parseVariant,
  prevPending,
  DEFAULT_FILTER,
  isDefaultFilter,
  provenance,
  ratioOf,
  shapeOf,
  spatialMove,
  stateLabel,
  STATUS_FILTERS,
  styleOf,
  visibleItems,
  asStatusFilter,
} from "./board";

let n = 0;
function item(p: Partial<BoardItem> = {}): BoardItem {
  n += 1;
  return {
    id: `bd-${n}`,
    image: `items/x${n}.png`,
    image_url: `/files/board/items/x${n}.png`,
    video: null,
    video_url: null,
    duration_s: null,
    width: 1080,
    height: 1920,
    title: `Shot ${n}`,
    summary: null,
    use_case_id: "era-adjusted-rankings",
    proposed_case: null,
    style: { id: "painted-grid", name: "Painted Grid" },
    source: null,
    status: "pending",
    decision: null,
    note: null,
    decided_at: null,
    created_at: "2026-09-30T12:00:00.000Z",
    ...p,
  };
}

describe("variant param", () => {
  it("parses 1|2|3 from numbers or strings, defaulting to 1", () => {
    expect(parseVariant(2)).toBe(2);
    expect(parseVariant("3")).toBe(3);
    expect(parseVariant("1")).toBe(1);
    expect(parseVariant(undefined)).toBe(1);
    expect(parseVariant("9")).toBe(1);
    expect(parseVariant("wall")).toBe(1);
  });
});

describe("decisions", () => {
  it("maps A / S / C / B (any case) to the four decisions", () => {
    expect(decisionForKey("a")).toBe("accept");
    expect(decisionForKey("S")).toBe("reject_style");
    expect(decisionForKey("c")).toBe("reject_case");
    expect(decisionForKey("B")).toBe("reject_both");
    expect(decisionForKey("x")).toBeNull();
    expect(decisionForKey("Enter")).toBeNull();
  });
  it("derives the state from the decision first and names the rejected axis", () => {
    expect(itemState(item())).toBe("pending");
    expect(itemState(item({ decision: "accept", status: "accepted" }))).toBe("accepted");
    expect(itemState(item({ decision: "reject_case", status: "rejected" }))).toBe("rejected");
    expect(itemState(item({ decision: null, status: "rejected" }))).toBe("rejected");
    expect(stateLabel(item())).toBe("Pending");
    expect(stateLabel(item({ decision: "reject_style", status: "rejected" }))).toMatch(/rejected/i);
    expect(stateLabel(item({ decision: "reject_both", status: "rejected" }))).toBe("Rejected · both");
    expect(stateLabel(item({ decision: "accept", status: "accepted" }))).toBe("Accepted");
  });
});

describe("axes", () => {
  it("keys styles by id and cases as existing or proposed", () => {
    expect(styleOf(item()).key).toBe("style:painted-grid");
    expect(styleOf(item({ style: null })).key).toBe("style:none");
    const names = new Map([["era-adjusted-rankings", "Era-adjusted rankings"]]);
    const ex = caseOf(item(), names);
    expect(ex).toMatchObject({ kind: "existing", id: "era-adjusted-rankings", name: "Era-adjusted rankings" });
    const pr = caseOf(
      item({ use_case_id: null, proposed_case: { name: "Champion’s share", pitch: "p", requires: ["hist"] } }),
    );
    expect(pr).toMatchObject({ kind: "proposed", key: "new:champion-s-share", requires: ["hist"] });
  });
  it("lists existing cases before proposed ones", () => {
    const items = [
      item({ use_case_id: null, proposed_case: { name: "The Recount", pitch: "" } }),
      item({ use_case_id: "similarity-dna" }),
    ];
    expect(axisOptions(items, "case").map((o) => o.key)).toEqual(["uc:similarity-dna", "new:the-recount"]);
  });
});

describe("filters, counts, groups", () => {
  const items = [
    item({ decision: "accept", status: "accepted", source: { loop: "loop-001" } }),
    item({
      decision: "reject_style",
      status: "rejected",
      style: { id: "loom", name: "Loom" },
      source: { loop: "loop-001" },
    }),
    item({
      decision: "reject_both",
      status: "rejected",
      use_case_id: null,
      proposed_case: { name: "Dynasty river", pitch: "" },
    }),
    item({ style: { id: "loom", name: "Loom" }, source: { loop: "loop-002" } }),
  ];
  it("filters by status, style and case", () => {
    expect(filterItems(items, NO_FILTER)).toHaveLength(4);
    expect(filterItems(items, { ...NO_FILTER, status: "pending" })).toHaveLength(1);
    expect(filterItems(items, { ...NO_FILTER, style: "style:loom" })).toHaveLength(2);
    expect(filterItems(items, { ...NO_FILTER, case: "new:dynasty-river" })).toHaveLength(1);
  });
  it("hides rejected proposals: visibleItems, no rejected filter, ledger tallies keep them", () => {
    expect(visibleItems(items)).toHaveLength(2);
    expect(visibleItems(items).every((i) => itemState(i) !== "rejected")).toBe(true);
    expect(STATUS_FILTERS).toEqual(["all", "pending", "accepted"]);
    expect(asStatusFilter("rejected")).toBe("all");
    const shown = new Set(visibleItems(items).map((i) => i.id));
    const L = ledger(items, undefined, (i) => shown.has(i.id));
    expect(L.styles.reduce((a, s) => a + s.rejected, 0)).toBeGreaterThan(0);
    expect(L.styles.flatMap((s) => L.cases.flatMap((c) => L.cell(s.key, c.key)))).toHaveLength(2);
  });
  it("counts states, rejection axes, styles, cases and loops", () => {
    const c = countItems(items);
    expect(c).toMatchObject({
      total: 4,
      pending: 1,
      accepted: 1,
      rejected: 2,
      reject_style: 1,
      reject_both: 1,
      reject_case: 0,
    });
    expect(c.styles).toBe(2);
    expect(c.cases).toBe(2);
    expect(c.proposed).toBe(1);
    expect(c.loops).toEqual(["loop-001", "loop-002"]);
  });
  it("groups by style or case, keeping every item once", () => {
    const g = groupItems(items, "style");
    expect(g.map((x) => x.key)).toEqual(["style:painted-grid", "style:loom"]);
    expect(g.flatMap((x) => x.items)).toHaveLength(4);
    expect(groupItems(items, "none")).toHaveLength(1);
  });
});

describe("ledger", () => {
  it("tallies each axis with rejections aimed at it, and cells per pairing", () => {
    const a = item({ decision: "reject_style", status: "rejected" });
    const b = item({ decision: "reject_case", status: "rejected", style: { id: "loom", name: "Loom" } });
    const c = item({ style: { id: "loom", name: "Loom" }, use_case_id: "similarity-dna" });
    const L = ledger([a, b, c]);
    const grid = L.styles.find((s) => s.key === "style:painted-grid");
    const loom = L.styles.find((s) => s.key === "style:loom");
    const era = L.cases.find((x) => x.key === "uc:era-adjusted-rankings");
    expect(grid).toMatchObject({ total: 1, rejected: 1, spared: 0 });
    expect(loom).toMatchObject({ total: 2, rejected: 0, spared: 1, pending: 1 });
    expect(era).toMatchObject({ total: 2, rejected: 1, spared: 1 });
    expect(grid && axisVerdict(grid)).toBe("rejected");
    expect(loom && axisVerdict(loom)).toBe("liked");
    expect(era && axisVerdict(era)).toBe("mixed");
    expect(L.cell("style:loom", "uc:similarity-dna").map((i) => i.id)).toEqual([c.id]);
    expect(L.cell("style:painted-grid", "uc:similarity-dna")).toEqual([]);
  });
});

describe("shots", () => {
  it("clamps ratios to 9:16..16:9 and treats a 1x1 probe or missing size as square", () => {
    expect(ratioOf(1080, 1920)).toBeCloseTo(0.5625);
    expect(ratioOf(1920, 1080)).toBeCloseTo(16 / 9);
    expect(ratioOf(4000, 100)).toBeCloseTo(16 / 9);
    expect(ratioOf(1, 1)).toBe(1);
    expect(ratioOf(null, null)).toBe(1);
    expect(shapeOf(1080, 1920)).toBe("portrait");
    expect(shapeOf(1920, 1080)).toBe("landscape");
    expect(shapeOf(1, 1)).toBe("square");
  });
  it("justifies rows to fill the width exactly, all tiles of a row at one height", () => {
    const ratios = [0.5625, 16 / 9, 0.5625, 0.5625, 16 / 9, 0.5625, 1];
    const rows = justify(ratios, 1600, 480, 12);
    expect(rows.flatMap((r) => r.tiles.map((t) => t.index))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const r of rows.slice(0, -1)) {
      const used = r.tiles.reduce((a, t) => a + t.w, 0) + 12 * (r.tiles.length - 1);
      expect(used).toBe(1600);
      expect(r.tiles.every((t) => t.h === r.h)).toBe(true);
    }
    // the last row is never stretched past 1.25x the target
    expect(rows[rows.length - 1]?.h).toBeLessThanOrEqual(600);
  });
  it("leaves a short last row at the target height instead of blowing it up", () => {
    const rows = justify([16 / 9, 16 / 9, 16 / 9, 0.5625], 1600, 400, 10);
    const last = rows[rows.length - 1];
    expect(last?.tiles.map((t) => t.index)).toEqual([2, 3]);
    expect(last?.h).toBe(400);
    expect(last?.tiles.map((t) => t.w)).toEqual([711, 225]);
  });
  it("keeps a lone portrait on its own row on a phone rather than squashing it", () => {
    const rows = justify([0.5625, 16 / 9], 358, 420, 10);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.tiles.map((t) => t.index)).toEqual([0]);
  });
  it("returns no rows without a width", () => {
    expect(justify([1, 1], 0, 400, 10)).toEqual([]);
  });
});

describe("keyboard", () => {
  // two rows: [0 wide][1 narrow] / [2 narrow][3 wide]
  const boxes = [
    { x: 0, y: 0, w: 600, h: 300 },
    { x: 612, y: 0, w: 170, h: 300 },
    { x: 0, y: 320, w: 170, h: 300 },
    { x: 182, y: 320, w: 600, h: 300 },
  ];
  it("moves left/right on a line, then wraps in reading order", () => {
    expect(spatialMove(boxes, 0, "ArrowRight")).toBe(1);
    expect(spatialMove(boxes, 1, "ArrowRight")).toBe(2);
    expect(spatialMove(boxes, 2, "ArrowLeft")).toBe(1);
    expect(spatialMove(boxes, 0, "ArrowLeft")).toBeNull();
    expect(spatialMove(boxes, 3, "ArrowRight")).toBeNull();
  });
  it("moves up/down to the nearest line, then the closest box in x", () => {
    expect(spatialMove(boxes, 1, "ArrowDown")).toBe(3);
    expect(spatialMove(boxes, 0, "ArrowDown")).toBe(3);
    expect(spatialMove(boxes, 2, "ArrowUp")).toBe(0);
    expect(spatialMove(boxes, 0, "ArrowUp")).toBeNull();
    expect(spatialMove(boxes, 2, "Home")).toBe(0);
    expect(spatialMove(boxes, 0, "End")).toBe(3);
  });
  it("walks a strip linearly, clamped", () => {
    expect(linearMove(0, "ArrowLeft", 3)).toBe(0);
    expect(linearMove(1, "ArrowRight", 3)).toBe(2);
    expect(linearMove(2, "ArrowRight", 3)).toBe(2);
    expect(linearMove(1, "End", 3)).toBe(2);
    expect(linearMove(1, "a", 3)).toBeNull();
  });
  it("finds the next pending item, wrapping and skipping the current one", () => {
    const a = item({ decision: "accept", status: "accepted" });
    const b = item();
    const c = item({ decision: "reject_case", status: "rejected" });
    const d = item();
    expect(nextPending([a, b, c, d], b.id)).toBe(d.id);
    expect(nextPending([a, b, c, d], d.id)).toBe(b.id);
    expect(nextPending([a, b, c], b.id)).toBeNull();
    expect(nextPending([a, b], null)).toBe(b.id);
  });
});

describe("triage cursor", () => {
  const a = item({ decision: "accept", status: "accepted" });
  const b = item();
  const c = item({ decision: "reject_case", status: "rejected" });
  const d = item();
  it("finds the previous pending item, wrapping and skipping the current one", () => {
    expect(prevPending([a, b, c, d], d.id)).toBe(b.id);
    expect(prevPending([a, b, c, d], b.id)).toBe(d.id);
    expect(prevPending([a, b, c], b.id)).toBeNull();
    expect(prevPending([a, b, d], null)).toBe(d.id);
  });
  it("neighbourAfterRemoval: the next item, else the previous, else null", () => {
    expect(neighbourAfterRemoval([a, b, c], b.id)).toBe(c.id);
    expect(neighbourAfterRemoval([a, b, c], c.id)).toBe(b.id);
    expect(neighbourAfterRemoval([a], a.id)).toBeNull();
    expect(neighbourAfterRemoval([a, b], "nope")).toBeNull();
    expect(neighbourAfterRemoval([], a.id)).toBeNull();
  });
  it("the default queue is pending", () => {
    expect(DEFAULT_FILTER.status).toBe("pending");
    expect(isDefaultFilter(DEFAULT_FILTER)).toBe(true);
    expect(isDefaultFilter(NO_FILTER)).toBe(false);
  });
});

describe("provenance", () => {
  const source = {
    variant: "variant-3",
    skill: "board",
    loop: "loop-001",
    seat: "claude-opus",
    contest: "board-loop-001",
    facts: ["f1db:driver:x:season:2004#wins", "f1db:driver:x:season:2004#season", "f1db:driver:y#wins", 7],
    nested: { a: 1 },
  };
  it("lists scalar fields in a fixed order and the fact refs as strings", () => {
    expect(provenance(source).map((p) => p.k)).toEqual(["skill", "loop", "contest", "seat", "variant"]);
    expect(factRefs(source)).toHaveLength(3);
    expect(factRefs(null)).toEqual([]);
  });
  it("groups fact refs by key with their columns", () => {
    expect(groupFacts(factRefs(source))).toEqual([
      { key: "f1db:driver:x:season:2004", cols: ["wins", "season"] },
      { key: "f1db:driver:y", cols: ["wins"] },
    ]);
  });
});

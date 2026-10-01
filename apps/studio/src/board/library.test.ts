import type { UseCase } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import type { BoardItem, CaseIdea, StyleEntry } from "../api";
import { caseDecisionForKey, caseRows, groupStyles, inbox, nextUndecided, parseTab, styleItems } from "./library";

const item = (id: string, over: Partial<BoardItem> = {}): BoardItem => ({
  id, image: `items/${id}.png`, image_url: `/files/board/items/${id}.png`, video: null, video_url: null, duration_s: null,
  width: 1080, height: 1920, title: id, summary: null, use_case_id: "career-wins-race", proposed_case: null,
  style: { id: "ink", name: "Ink" }, source: null, status: "pending", decision: null, note: null, decided_at: null,
  created_at: "2026-10-01T00:00:00Z", ...over,
});
const style = (id: string, status: StyleEntry["status"], over: Partial<StyleEntry> = {}): StyleEntry => ({
  id, name: id, notes: null, verdict: "open", status, owner_note: null, hero_item_id: null, accepts: 0, style_rejects: 0,
  pending: 0, total: 0, item_ids: [], cases: [], updated_at: null, ...over,
});
const uc = (id: string, over: Partial<UseCase> = {}) =>
  ({ id, name: id.toUpperCase(), family: "time-evolution", data_time: { unit: "race", from: "first season", to: "latest race" }, arc: `arc of ${id}`, ...over }) as UseCase;
const idea = (id: string, over: Partial<CaseIdea> = {}): CaseIdea => ({
  id, title: id, pitch: "p", domain: "music", arc: "a", insight: "i", why_lasts: "w",
  tension: { expectation: "e", reality: "r", strength: "strong" }, unknowns: [], beats: [],
  timeline: { unit: "year", from: 1960, to: 2020, years_from: 1960, years_to: 2020 }, span_years: 60, chart_ideas: ["streamgraph"],
  kind: "observed", method: null, data_guess: null, feasibility: null,
  requires: [], sources: [{ name: "MusicBrainz", url: "https://musicbrainz.org", license: "CC0" }], evidence: [], data_status: "new-source",
  source: null, status: "pending", decision: null, note: null, decided_at: null, created_at: "2026-10-01T00:00:00Z", ...over,
});

describe("Case triage keys", () => {
  it("maps A / N / S / I / D / U to decisions, case-insensitive", () => {
    expect(["a", "N", "s", "i", "d", "u", "x"].map(caseDecisionForKey)).toEqual([
      "accept", "reject_not_interesting", "reject_short", "reject_no_insight", "reject_no_data", "reject_duplicate", null,
    ]);
  });

  it("advances to the next undecided idea, wrapping, skipping decided ones", () => {
    const order = [idea("a"), idea("b", { decision: "accept" }), idea("c"), idea("d")];
    expect(nextUndecided(order, "a")).toBe("c");
    expect(nextUndecided(order, "d")).toBe("a");
    expect(nextUndecided([idea("a"), idea("b", { decision: "accept" })], "a")).toBeNull();
  });
});

describe("Board tabs", () => {
  it("defaults to designs", () => {
    expect(parseTab(undefined)).toBe("designs");
    expect(parseTab("styles")).toBe("styles");
    expect(parseTab("cases")).toBe("cases");
    expect(parseTab("nope")).toBe("designs");
  });
});

describe("Style gallery", () => {
  it("groups styles by status in gallery order and drops empty groups", () => {
    const g = groupStyles([style("a", "accepted"), style("r", "retired"), style("l", "locked"), style("b", "accepted")]);
    expect(g.map((x) => [x.status, x.styles.map((s) => s.id)])).toEqual([
      ["locked", ["l"]],
      ["accepted", ["a", "b"]],
      ["retired", ["r"]],
    ]);
  });

  it("puts the hero first and skips items that are gone", () => {
    const byId = new Map([item("x"), item("y"), item("z")].map((i) => [i.id, i]));
    const s = style("ink", "accepted", { item_ids: ["x", "gone", "y", "z"], hero_item_id: "y" });
    expect(styleItems(s, byId).map((i) => i.id)).toEqual(["y", "x", "z"]);
  });
});

describe("Use case list", () => {
  it("merges registry formats, design proposals and case ideas with their verdicts", () => {
    const items = [
      item("1", { decision: "accept", status: "accepted" }),
      item("2", { use_case_id: "dominance-streams", decision: "reject_case", status: "rejected", note: "no story" }),
      item("3", { use_case_id: null, proposed_case: { name: "The wait for a first win", pitch: "first wins" }, decision: "accept", status: "accepted" }),
      item("4", { use_case_id: null, proposed_case: { name: "The wait for a first win", pitch: "again" } }),
      item("5", { use_case_id: "dominance-streams", status: "archived" }),
    ];
    const rows = caseRows(
      [uc("career-wins-race"), uc("dominance-streams"), uc("grid-to-victory"), uc("era-adjusted-rankings", { family: "headline" })],
      items,
      [idea("ci-1"), idea("ci-2", { decision: "reject_short", status: "rejected", note: "a decade is not enough here" }), idea("ci-3", { decision: "accept", status: "accepted" })],
    );
    const by = new Map(rows.map((r) => [r.key, r]));
    expect(by.get("career-wins-race")).toMatchObject({ origin: "registry", verdict: "accepted", accepts: 1, span: "first season → latest race" });
    expect(by.get("dominance-streams")).toMatchObject({ verdict: "rejected", case_rejects: 1, note: "no story" });
    expect(by.get("grid-to-victory")).toMatchObject({ verdict: "untested" });
    expect(by.has("era-adjusted-rankings")).toBe(false);
    expect(by.get("proposed:the-wait-for-a-first-win")).toMatchObject({ origin: "design", verdict: "accepted", accepts: 1, pending: 1 });
    expect(by.get("ci-1")).toMatchObject({ origin: "idea", verdict: "pending", span: "1960–2020", span_years: 60 });
    expect(by.get("ci-2")).toMatchObject({ verdict: "rejected", note: "a decade is not enough here" });
    expect(rows.map((r) => r.verdict)).toEqual([...rows.map((r) => r.verdict)].sort((a, b) =>
      ["accepted", "pending", "untested", "rejected"].indexOf(a) - ["accepted", "pending", "untested", "rejected"].indexOf(b)));
  });

  it("puts undecided ideas in the inbox, longest timeline first", () => {
    const got = inbox([
      idea("short", { span_years: 12 }),
      idea("long", { span_years: 70 }),
      idea("done", { decision: "accept", status: "accepted", span_years: 90 }),
    ]);
    expect(got.map((i) => i.id)).toEqual(["long", "short"]);
  });
});

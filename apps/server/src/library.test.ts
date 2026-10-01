import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BoardService } from "./board";
import { openDb } from "./db";
import { CaseIdeas, type NewCaseIdea, StyleLibrary, validateCaseIdea } from "./library";

const setup = () => {
  const root = mkdtempSync(path.join(tmpdir(), "lib-"));
  mkdirSync(path.join(root, "items"), { recursive: true });
  writeFileSync(path.join(root, "items", "a.png"), "png");
  const db = openDb(":memory:");
  return { board: new BoardService(db, root), styles: new StyleLibrary(db), cases: new CaseIdeas(db) };
};
const shot = (style: string, kase = "career-wins-race") => ({
  image: "items/a.png", width: 1080, height: 1920, title: `${style} on ${kase}`, use_case_id: kase, style: { id: style, name: style.toUpperCase() },
});

describe("Style library (verdicts from the gate + owner management)", () => {
  it("derives each style's verdict from the owner's decisions", () => {
    const { board, styles } = setup();
    const a = board.create(shot("ink"));
    const b = board.create(shot("ink", "dominance-streams"));
    const c = board.create(shot("neon"));
    board.create(shot("chalk"));
    board.decide(a.id, "accept");
    board.decide(b.id, "reject_case");
    board.decide(c.id, "reject_style", "too loud");
    const list = styles.list(board.list({ status: "all" }));
    const ink = list.find((s) => s.id === "ink")!;
    expect(ink).toMatchObject({ verdict: "accepted", status: "accepted", accepts: 1, style_rejects: 0, total: 2, hero_item_id: a.id });
    expect(ink.cases.sort()).toEqual(["career-wins-race", "dominance-streams"]);
    expect(list.find((s) => s.id === "neon")).toMatchObject({ verdict: "rejected", style_rejects: 1 });
    expect(list.find((s) => s.id === "chalk")).toMatchObject({ verdict: "open", pending: 1 });
    expect(list.map((s) => s.id)).toEqual(["ink", "chalk", "neon"]);
  });

  it("lets the owner lock, retire and annotate a style, and clear it back to its verdict", () => {
    const { board, styles } = setup();
    const a = board.create(shot("ink"));
    const b = board.create(shot("ink", "dominance-streams"));
    board.decide(a.id, "accept");
    const items = () => board.list({ status: "all" });
    expect(styles.update("ink", items(), { status: "locked", note: "the signature", hero_item_id: b.id })).toMatchObject({
      status: "locked", verdict: "accepted", owner_note: "the signature", hero_item_id: b.id,
    });
    expect(styles.update("ink", items(), { status: "retired" })).toMatchObject({ status: "retired", owner_note: "the signature" });
    expect(styles.update("ink", items(), { status: null, note: "" })).toMatchObject({ status: "accepted", owner_note: null });
  });

  it("refuses unknown styles, statuses and foreign hero items", () => {
    const { board, styles } = setup();
    const a = board.create(shot("ink"));
    const z = board.create(shot("neon"));
    const items = board.list({ status: "all" });
    expect(() => styles.update("nope", items, { status: "locked" })).toThrow(/unknown style/);
    expect(() => styles.update("ink", items, { status: "favourite" as never })).toThrow(/status/);
    expect(() => styles.update("ink", items, { hero_item_id: z.id })).toThrow(/does not carry/);
    expect(styles.update("ink", items, { hero_item_id: a.id }).hero_item_id).toBe(a.id);
  });

  it("ignores archived items", () => {
    const { board, styles } = setup();
    const a = board.create(shot("ink"));
    board.archive([a.id], "off brief");
    expect(styles.list(board.list({ status: "all" }))).toEqual([]);
  });
});

const idea: NewCaseIdea = {
  title: "The wins record changes hands", pitch: "Who held the all-time wins record, race by race",
  domain: "f1", arc: "Fangio, Clark, Stewart, Prost, Schumacher, Hamilton: six holders in 75 years",
  insight: "Records last longer each time: Prost held it 7 years, Schumacher 13",
  why_lasts: "75 seasons, six handovers spread across the whole run",
  tension: { expectation: "records fall often", reality: "only six holders since 1950", strength: "strong" },
  beats: [{ at: "1957", what: "Fangio 24" }, { at: "1968", what: "Clark 25" }, { at: "1987", what: "Prost 28" }, { at: "2001", what: "Schumacher 52" }],
  timeline: { unit: "race", from: 1, to: 1150, years_from: 1950, years_to: 2026 },
  sources: [{ name: "F1DB", url: "https://github.com/f1db/f1db", license: "CC-BY-4.0", registry_id: "f1db", class: "primary", confidence: "high" }],
  data_status: "staged", evidence: ["f1db:race:1:driver:x:entry:1#position_number"],
};

describe("Case ideas (use cases proposed as text, behind the owner's gate)", () => {
  it("stores an idea pending review with its span and tension", () => {
    const { cases } = setup();
    const c = cases.create(idea);
    expect(c).toMatchObject({ status: "pending", span_years: 76, domain: "f1", data_status: "staged" });
    expect(c.tension.strength).toBe("strong");
    expect(cases.list().map((x) => x.id)).toEqual([c.id]);
  });

  it("refuses an idea shorter than a decade, without tension or without sources", () => {
    expect(validateCaseIdea({ ...idea, timeline: { ...idea.timeline, years_from: 2021, years_to: 2026 } }).join()).toMatch(/at least 10/);
    expect(validateCaseIdea({ ...idea, tension: { expectation: "", reality: "x", strength: "strong" } }).join()).toMatch(/tension/);
    expect(validateCaseIdea({ ...idea, sources: [] }).join()).toMatch(/sources/);
    expect(validateCaseIdea({ ...idea, beats: idea.beats.slice(0, 3) }).join()).toMatch(/beats/);
    expect(validateCaseIdea({ ...idea, sources: [{ name: "x", url: "", license: "" }] }).join()).toMatch(/needs name, url and license/);
    expect(validateCaseIdea({ ...idea, domain: "weather" as never }).join()).toMatch(/domain/);
    expect(validateCaseIdea(idea)).toEqual([]);
  });

  it.each(["accept", "reject_short", "reject_no_insight", "reject_no_data", "reject_duplicate"] as const)("records %s with a note", (decision) => {
    const { cases } = setup();
    const c = cases.decide(cases.create(idea).id, decision, "why");
    expect(c).toMatchObject({ status: decision === "accept" ? "accepted" : "rejected", decision, note: "why" });
  });

  it("feeds decisions back oldest first and hides archived ideas", () => {
    const { cases } = setup();
    const a = cases.create(idea);
    const b = cases.create({ ...idea, title: "second" });
    const z = cases.create({ ...idea, title: "off" });
    cases.decide(a.id, "reject_short");
    cases.decide(b.id, "accept");
    cases.archive([z.id], "duplicate run");
    expect(cases.feedback().map((x) => [x.id, x.decision])).toEqual([[a.id, "reject_short"], [b.id, "accept"]]);
    expect(cases.list().map((x) => x.id)).not.toContain(z.id);
    expect(cases.list({ status: "all" }).map((x) => x.id)).toContain(z.id);
  });
});

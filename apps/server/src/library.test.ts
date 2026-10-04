import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchivedError, BoardService, NotArchivedError } from "./board";
import { openDb } from "./db";
import { CaseIdeas, type NewCaseIdea, StyleLibrary, validateCaseIdea } from "./library";

const setup = () => {
  const root = mkdtempSync(path.join(tmpdir(), "lib-"));
  mkdirSync(path.join(root, "items"), { recursive: true });
  writeFileSync(path.join(root, "items", "a.png"), "png");
  const db = openDb(":memory:");
  return { board: new BoardService(db, root), styles: new StyleLibrary(db), cases: new CaseIdeas(db), db };
};
const shot = (style: string, kase = "career-wins-race") => ({
  image: "items/a.png", width: 1080, height: 1920, title: `${style} on ${kase}`, use_case_id: kase, style: { id: style, name: style.toUpperCase() },
});

describe("Style library verdict precedence", () => {
  // now() has millisecond resolution: pin a clock that moves one second per call so "newest" is unambiguous
  const ticking = () => { let t = Date.parse("2026-10-01T00:00:00Z"); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(t); return () => { t += 1000; vi.setSystemTime(t); }; };
  afterEach(() => vi.useRealTimers());
  const items = (b: BoardService) => b.list({ status: "all" });

  it("reads a 1:1 tie as open, not accepted", () => {
    const { board, styles } = setup();
    board.decide(board.create(shot("ink")).id, "accept");
    board.decide(board.create(shot("ink", "k2")).id, "reject_style");
    expect(styles.list(items(board))[0]).toMatchObject({ verdict: "open", status: "open", accepts: 1, style_rejects: 1 });
  });

  it("counts reject_both as a style reject, with separate additive counts", () => {
    const { board, styles } = setup();
    board.decide(board.create(shot("ink")).id, "reject_both");
    board.decide(board.create(shot("ink", "k2")).id, "reject_style");
    expect(styles.list(items(board))[0]).toMatchObject({ verdict: "rejected", reject_both: 1, reject_style: 1, style_rejects: 2 });
  });

  it("flags at_risk when the newest decision is a reject that has not flipped the verdict", () => {
    const tick = ticking();
    const { board, styles } = setup();
    board.decide(board.create(shot("ink")).id, "accept");
    tick();
    board.decide(board.create(shot("ink", "k2")).id, "accept");
    tick();
    board.decide(board.create(shot("ink", "k3")).id, "reject_style");
    expect(styles.list(items(board))[0]).toMatchObject({ verdict: "accepted", accepts: 2, at_risk: true });
  });

  it("has no at_risk once rejected, or when the newest decision is an accept", () => {
    const tick = ticking();
    const { board, styles } = setup();
    board.decide(board.create(shot("neon")).id, "reject_style");
    tick();
    board.decide(board.create(shot("ink")).id, "reject_style");
    tick();
    board.decide(board.create(shot("ink", "k2")).id, "accept");
    const list = styles.list(items(board));
    expect(list.find((s) => s.id === "neon")!.at_risk).toBeUndefined();
    expect(list.find((s) => s.id === "ink")!.at_risk).toBeUndefined();
  });

  it("falls back to another hero when the stored hero is archived", () => {
    const { board, styles } = setup();
    const a = board.create(shot("ink"));
    const b = board.create(shot("ink", "k2"));
    styles.update("ink", items(board), { hero_item_id: a.id });
    board.archive([a.id], "off brief");
    expect(styles.list(items(board))[0]?.hero_item_id).toBe(b.id);
  });

  it("never falls back to an archived accepted item", () => {
    const { board, styles } = setup();
    const a = board.create(shot("ink"));
    const b = board.create(shot("ink", "k2"));
    board.decide(a.id, "accept");
    board.archive([a.id], "off brief");
    expect(styles.list(items(board))[0]?.hero_item_id).toBe(b.id);
  });

  it("takes name and notes from the newest item", () => {
    const tick = ticking();
    const { board, styles } = setup();
    board.create({ ...shot("ink"), style: { id: "ink", name: "Old", notes: "old notes" } });
    tick();
    board.create({ ...shot("ink", "k2"), style: { id: "ink", name: "New", notes: "new notes" } });
    expect(styles.list(items(board))[0]).toMatchObject({ name: "New", notes: "new notes" });
  });

  it("lets locked and retired survive a verdict flip", () => {
    const { board, styles } = setup();
    board.decide(board.create(shot("ink")).id, "accept");
    styles.update("ink", items(board), { status: "locked" });
    board.decide(board.create(shot("ink", "k2")).id, "reject_style");
    board.decide(board.create(shot("ink", "k3")).id, "reject_style");
    expect(styles.list(items(board))[0]).toMatchObject({ verdict: "rejected", status: "locked" });
    styles.update("ink", items(board), { status: "retired" });
    expect(styles.list(items(board))[0]).toMatchObject({ verdict: "rejected", status: "retired" });
  });
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

  it("accepts a data-less brainstorm (guess) with a feasibility instead of verified sources", () => {
    const { cases } = setup();
    const g = cases.create({ ...idea, data_status: "guess", sources: [], data_guess: "UN population tables, probably", feasibility: "likely" });
    expect(g).toMatchObject({ data_status: "guess", feasibility: "likely", kind: "observed" });
    expect(validateCaseIdea({ ...idea, data_status: "guess", sources: [] }).join()).toMatch(/data_guess.*feasibility/s);
  });

  it("needs a method for what-if and influence cases", () => {
    const { cases } = setup();
    expect(validateCaseIdea({ ...idea, kind: "what-if" }).join()).toMatch(/method/);
    expect(validateCaseIdea({ ...idea, kind: "influence", method: " " }).join()).toMatch(/influence is measured/);
    const w = cases.create({ ...idea, kind: "what-if", method: "re-score every season under the 2010 points system" });
    expect(w).toMatchObject({ kind: "what-if", method: "re-score every season under the 2010 points system" });
  });

  it.each(["accept", "reject_not_interesting", "reject_short", "reject_no_insight", "reject_no_data", "reject_duplicate"] as const)("records %s with a note", (decision) => {
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

  it("archiving keeps the decision note and always records the reason in archive_reason", () => {
    const { cases } = setup();
    const a = cases.decide(cases.create(idea).id, "reject_short", "only five years");
    const b = cases.create({ ...idea, title: "undecided" });
    cases.archive([a.id, b.id], "duplicate run");
    expect(cases.get(a.id)).toMatchObject({ status: "archived", decision: "reject_short", note: "only five years", archive_reason: "duplicate run" });
    expect(cases.get(b.id)).toMatchObject({ status: "archived", note: null, archive_reason: "duplicate run" });
  });

  it("has no archive_reason before archiving and returns it from list", () => {
    const { cases } = setup();
    const a = cases.create(idea);
    expect(cases.get(a.id)?.archive_reason).toBeNull();
    cases.archive([a.id], "off brief");
    expect(cases.list({ status: "archived" }).find((x) => x.id === a.id)?.archive_reason).toBe("off brief");
  });

  it("restores an archived idea to the state it left, keeping its decision note", () => {
    const { cases } = setup();
    const a = cases.create(idea);
    const b = cases.create({ ...idea, title: "b" });
    const c = cases.create({ ...idea, title: "c" });
    cases.decide(a.id, "accept", "good");
    cases.decide(b.id, "reject_short", "five years");
    cases.archive([a.id, b.id, c.id], "tidy");
    expect(cases.restore(a.id)).toMatchObject({ status: "accepted", decision: "accept", note: "good", archive_reason: null });
    expect(cases.restore(b.id)).toMatchObject({ status: "rejected", decision: "reject_short", note: "five years", archive_reason: null });
    expect(cases.restore(c.id)).toMatchObject({ status: "pending", decision: null, archive_reason: null });
    expect(() => cases.restore(c.id)).toThrow(NotArchivedError);
    expect(() => cases.restore("ci-nope")).toThrow(/unknown/);
  });

  it("a legacy undecided archived idea loses the note that was really its reason on restore", () => {
    const { cases, db } = setup();
    const a = cases.create(idea);
    cases.archive([a.id], "x");
    db.$client.prepare("update case_ideas set archive_reason = null, note = 'old reason' where id = ?").run(a.id);
    expect(cases.restore(a.id)).toMatchObject({ status: "pending", note: null });
  });

  it("re-archiving keeps the first reason, and undo of an archived idea is a named error", () => {
    const { cases } = setup();
    const a = cases.create(idea);
    cases.archive([a.id], "first");
    expect(cases.archive([a.id], "second")).toBe(0);
    expect(cases.get(a.id)?.archive_reason).toBe("first");
    expect(() => cases.undo(a.id)).toThrow(ArchivedError);
  });

  it("refuses to decide an archived idea", () => {
    const { cases } = setup();
    const a = cases.create(idea);
    cases.archive([a.id], "off");
    expect(() => cases.decide(a.id, "accept")).toThrow(/archived/);
    expect(cases.get(a.id)?.status).toBe("archived");
  });

  it("feedback(since) is exclusive of the boundary", () => {
    const { cases } = setup();
    const a = cases.decide(cases.create(idea).id, "accept");
    expect(cases.feedback(a.decided_at as string)).toEqual([]);
    expect(cases.feedback("1970-01-01T00:00:00.000Z").map((x) => x.id)).toEqual([a.id]);
  });
});

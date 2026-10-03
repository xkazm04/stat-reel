import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFeedback, assessLongevity, emptyLedger, excerptWindow, frameTimes, longevitySamples, loopPhase, renderBrief, renderLedgerMarkdown, stabilityProbe, validateDesign, validateShot } from "../scripts/lib.mjs";

const item = (id, decision, style, useCase, note = null, proposed = null) => ({
  id, decision, note, decided_at: `2026-09-30T10:0${id.length}:00Z`, style: { id: style, name: style }, use_case_id: useCase, proposed_case: proposed,
});

test("feedback folds into per-style and per-case tallies; reject_both counts against both", () => {
  const l = applyFeedback(emptyLedger(), [
    item("a", "accept", "floodlit", "era-adjusted-rankings"),
    item("bb", "reject_style", "neon", "era-adjusted-rankings", "too busy"),
    item("ccc", "reject_case", "floodlit", "metric-explainer-shorts"),
    item("dddd", "reject_both", "neon", "similarity-dna", "no"),
  ]);
  assert.deepEqual(l.styles.floodlit, { name: "floodlit", accepts: 1, style_rejects: 0, notes: [], last: "2026-09-30T10:03:00Z" });
  assert.equal(l.styles.neon.style_rejects, 2);
  assert.deepEqual(l.styles.neon.notes, ["too busy", "no"]);
  assert.equal(l.cases["era-adjusted-rankings"].accepts, 1);
  assert.equal(l.cases["metric-explainer-shorts"].case_rejects, 1);
  assert.equal(l.cases["similarity-dna"].case_rejects, 1);
  assert.equal(l.cursor, "2026-09-30T10:04:00Z");
});

test("a proposed case is keyed by its name and keeps its pitch", () => {
  const l = applyFeedback(emptyLedger(), [item("a", "accept", "s", null, null, { name: "Pit-stop DNA", pitch: "Every stop as a fingerprint" })]);
  assert.equal(l.cases["proposed:pit-stop-dna"].name, "Pit-stop DNA");
  assert.equal(l.cases["proposed:pit-stop-dna"].pitch, "Every stop as a fingerprint");
});

test("applying the same feedback twice changes nothing (idempotent by item id)", () => {
  const fb = [item("a", "accept", "s", "era-adjusted-rankings")];
  const once = applyFeedback(emptyLedger(), fb);
  assert.deepEqual(applyFeedback(once, fb), once);
});

test("discovery until enough decisions and at least one accepted style, then exploit", () => {
  assert.equal(loopPhase(emptyLedger()), "discovery");
  const l = applyFeedback(emptyLedger(), Array.from({ length: 12 }, (_, i) => item("x".repeat(i + 1), i % 3 ? "reject_style" : "accept", `s${i}`, "era-adjusted-rankings")));
  assert.equal(loopPhase(l), "exploit");
});

test("the brief quotes accepted styles as the floor and rejected ones as anti-patterns, with owner notes", () => {
  const l = applyFeedback(emptyLedger(), [item("a", "accept", "floodlit", "era-adjusted-rankings"), item("bb", "reject_style", "neon", "similarity-dna", "too busy")]);
  const b = renderBrief({ template: "{{phase}}|{{shots}}|{{styles_accepted}}|{{styles_rejected}}|{{cases}}", ledger: l, shots: 3 });
  assert.match(b, /^discovery\|3\|/);
  assert.match(b, /floodlit/);
  assert.match(b, /neon.*too busy/);
});

test("shot metadata: needs title, style, format, and a use case or a proposed case; figures need fact refs", () => {
  assert.deepEqual(validateShot({ title: "T", format: "vertical", style: { id: "s", name: "S" }, use_case_id: "era-adjusted-rankings", facts: ["f1db:driver:x:era-adjusted#rank_raw"] }), []);
  assert.match(validateShot({ title: "T", format: "square", style: { id: "s", name: "S" }, use_case_id: "x" }).join(), /format/);
  assert.match(validateShot({ title: "T", format: "vertical", style: { id: "s", name: "S" } }).join(), /use_case_id or proposed_case/);
  assert.match(validateShot({ title: "T", format: "vertical", style: { id: "s", name: "S" }, use_case_id: "x", facts: ["hamilton wins"] }).join(), /fact ref/);
});

test("the ledger renders as Obsidian-readable markdown tables", () => {
  const md = renderLedgerMarkdown(applyFeedback(emptyLedger(), [item("a", "accept", "floodlit", "era-adjusted-rankings")]));
  assert.match(md, /\| floodlit \| 1 \| 0 \|/);
  assert.match(md, /## Cases/);
});

test("the brief lists shots already on the board awaiting the owner, so later loops explore elsewhere", () => {
  const pending = [
    { status: "pending", title: "Loom", style: { id: "loom", name: "Loom" }, use_case_id: "era-adjusted-rankings", proposed_case: null },
    { status: "pending", title: "River", style: { id: "river", name: "Halftone river" }, use_case_id: null, proposed_case: { name: "Dynasty river", pitch: "p" } },
    { status: "accepted", title: "Old", style: { id: "old", name: "Old" }, use_case_id: "x", proposed_case: null },
  ];
  const b = renderBrief({ template: "{{tried}}", ledger: emptyLedger(), shots: 3, board: pending });
  assert.match(b, /Loom.*era-adjusted-rankings/);
  assert.match(b, /Halftone river.*proposed: Dynasty river/);
  assert.doesNotMatch(b, /Old/);
});

test("a clip declares 5-10 s, a poster moment inside it, and optionally fps (default 30)", () => {
  const base = { title: "T", format: "vertical", style: { id: "s", name: "S" }, use_case_id: "x" };
  assert.deepEqual(validateShot({ ...base, duration_s: 8, poster_t: 6.5 }, { clip: true }), []);
  assert.match(validateShot({ ...base, duration_s: 3, poster_t: 1 }, { clip: true }).join(), /5-10/);
  assert.match(validateShot({ ...base, duration_s: 8, poster_t: 9 }, { clip: true }).join(), /poster_t/);
  assert.match(validateShot({ ...base }, { clip: true }).join(), /duration_s/);
  assert.deepEqual(validateShot({ ...base }), []); // stills stay valid for older loops
});

test("frame times cover the clip at the declared fps, ending before duration", () => {
  const t = frameTimes(2, 30);
  assert.equal(t.length, 60);
  assert.equal(t[0], 0);
  assert.ok(Math.abs(t[59] - 59 / 30) < 1e-9);
});

test("the stability probe revisits moments out of order, as a video renderer does", () => {
  const p = stabilityProbe(8);
  assert.ok(p.length >= 4);
  const firsts = new Map();
  for (const t of p) firsts.set(t, (firsts.get(t) ?? 0) + 1);
  assert.ok([...firsts.values()].some((n) => n >= 2), "some moment is rendered twice");
  assert.ok(p.some((t, i) => i > 0 && t < p[i - 1]), "it seeks backwards at least once");
});

// ---- time-evolution designs (ADR 007): full 30-90 s run, one cut-out, longevity measured

const tl = { title: "T", format: "vertical", style: { id: "s", name: "S" }, use_case_id: "career-wins-race", chart_form: "bar-chart race",
  duration_s: 72, timeline: { unit: "season", from: 1950, to: 2026 } };

test("a time-evolution design declares a 30-90 s run and a data timeline", () => {
  assert.deepEqual(validateDesign(tl, { useCases: ["career-wins-race"] }), []);
  assert.match(validateDesign({ ...tl, duration_s: 12 }, { useCases: ["career-wins-race"] }).join(), /30-90/);
  assert.match(validateDesign({ ...tl, timeline: undefined }, { useCases: ["career-wins-race"] }).join(), /timeline/);
  assert.match(validateDesign({ ...tl, timeline: { unit: "season", from: 2026, to: 1950 } }, { useCases: ["career-wins-race"] }).join(), /from < to/);
  assert.match(validateDesign({ ...tl, use_case_id: "era-adjusted-rankings" }, { useCases: ["career-wins-race"] }).join(), /not a time-evolution use case/);
  assert.deepEqual(validateDesign({ ...tl, use_case_id: null, proposed_case: { name: "N", pitch: "p", data_time: "season" } }, { useCases: [] }), []);
  assert.match(validateDesign({ ...tl, use_case_id: null, proposed_case: { name: "N", pitch: "p" } }, { useCases: [] }).join(), /data_time/);
});

test("the cut-out comes from the middle of the run, not the finale", () => {
  const w = excerptWindow(72, 8);
  assert.equal(w.duration_s, 8);
  assert.ok(w.start_s > 72 * 0.3 && w.start_s + 8 < 72 * 0.7, JSON.stringify(w));
  assert.deepEqual(excerptWindow(30, 8), { start_s: 9.5, duration_s: 8 });
});

test("longevity: the data clock advances monotonically across the run and the picture keeps changing", () => {
  const good = Array.from({ length: 12 }, (_, i) => ({ t: i * 6, clock: 1950 + i * 7, hash: `h${i}` }));
  const r = assessLongevity(good, { unit: "season", from: 1950, to: 2026 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const stalled = good.map((s, i) => ({ ...s, clock: i < 3 ? 1950 + i : 1952 }));
  assert.match(assessLongevity(stalled, { unit: "season", from: 1950, to: 2026 }).problems.join(), /coverage|stall/);
  const backwards = good.map((s, i) => ({ ...s, clock: i === 5 ? 1950 : s.clock }));
  assert.match(assessLongevity(backwards, { unit: "season", from: 1950, to: 2026 }).problems.join(), /backwards/);
  const frozen = good.map((s, i) => ({ ...s, hash: i > 3 ? "same" : s.hash }));
  assert.match(assessLongevity(frozen, { unit: "season", from: 1950, to: 2026 }).problems.join(), /static/);
  const noClock = good.map((s) => ({ ...s, clock: null }));
  assert.match(assessLongevity(noClock, { unit: "season", from: 1950, to: 2026 }).problems.join(), /dataClock/);
});

test("longevity samples span the whole run", () => {
  const s = longevitySamples(72);
  assert.equal(s[0], 0);
  assert.ok(s.at(-1) > 70 && s.at(-1) < 72);
  assert.ok(s.length >= 10);
});

test("resolveFacts flags keys and columns that are not staged", async () => {
  const { resolveFacts } = await import("../scripts/lib.mjs");
  const tables = { a: [{ fact_key: "f1db:race:1:driver:x:entry:1", points_awarded: 9 }], b: [{ fact_key: "f1db:season:1950", races_held: 7 }] };
  const r = resolveFacts(["f1db:race:1:driver:x:entry:1#points_awarded", "f1db:season:1950#races_held", "f1db:season:1950#nope", "f1db:race:2#wins"], tables);
  assert.equal(r.cited, 4);
  assert.deepEqual(r.unresolved, ["f1db:season:1950#nope", "f1db:race:2#wins"]);
});

test("seatLanes spreads seats over distinct cases and rotates by round", async () => {
  const { seatLanes } = await import("../scripts/lib.mjs");
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  const r0 = seatLanes(ids, 3, 0);
  assert.deepEqual(r0, [["a", "b"], ["c", "d"], ["e", "f"]]);
  assert.deepEqual(seatLanes(ids, 3, 1)[0], ["g", "a"]);
  assert.deepEqual(seatLanes([], 2, 0), [[], []]);
});

test("rejectedCases lists only cases rejected more than accepted", async () => {
  const { rejectedCases } = await import("../scripts/lib.mjs");
  const l = { cases: { x: { accepts: 0, case_rejects: 1 }, y: { accepts: 1, case_rejects: 1 }, z: { accepts: 2, case_rejects: 0 } } };
  assert.deepEqual(rejectedCases(l), ["x"]);
});

test("validateCaseIdea mirrors the server rules (decade, beats, tension, sources)", async () => {
  const { validateCaseIdea, titleKey } = await import("../scripts/lib.mjs");
  const ok = {
    title: "t", pitch: "p", arc: "a", insight: "i", why_lasts: "w", domain: "music", topic: "music", data_status: "new-source",
    tension: { expectation: "e", reality: "r", strength: "moderate" },
    beats: [{ at: "1960", what: "a" }, { at: "1970", what: "b" }, { at: "1985", what: "c" }, { at: "2005", what: "d" }],
    timeline: { unit: "year", from: 1960, to: 2020, years_from: 1960, years_to: 2020 },
    sources: [{ name: "MusicBrainz", url: "https://musicbrainz.org/doc/MusicBrainz_Database", license: "CC0" }],
  };
  assert.deepEqual(validateCaseIdea(ok), []);
  assert.match(validateCaseIdea({ ...ok, timeline: { ...ok.timeline, years_from: 2015 } }).join(), /at least 10/);
  assert.match(validateCaseIdea({ ...ok, beats: ok.beats.slice(1) }).join(), /beats/);
  assert.match(validateCaseIdea({ ...ok, topic: undefined }).join(), /topic must be one of/);
  assert.match(validateCaseIdea({ ...ok, topic: "knitting" }).join(), /topic must be one of/);
  assert.deepEqual(validateCaseIdea({ ...ok, topic: "energy" }), []);
  assert.match(validateCaseIdea({ ...ok, tension: { expectation: "e", reality: "", strength: "x" } }).join(), /tension/);
  assert.match(validateCaseIdea({ ...ok, sources: [{ name: "x" }] }).join(), /needs name, url and license/);
  assert.equal(titleKey("The Wins Record, hand to hand"), titleKey("wins record hand-to-hand"));
  // data-less brainstorm: a guess and a feasibility instead of verified sources
  assert.deepEqual(validateCaseIdea({ ...ok, data_status: "guess", sources: [], data_guess: "UN tables", feasibility: "likely" }), []);
  assert.match(validateCaseIdea({ ...ok, data_status: "guess", sources: [] }).join(), /data_guess.*feasibility/s);
  assert.match(validateCaseIdea({ ...ok, kind: "what-if" }).join(), /method/);
  assert.deepEqual(validateCaseIdea({ ...ok, kind: "influence", method: "trophies per season of tenure vs club value" }), []);
});

test("overusedForms counts chart forms across the Board, ignoring parentheses and archived items", async () => {
  const { overusedForms } = await import("../scripts/lib.mjs");
  const it = (f, status = "pending") => ({ status, source: { chart_form: f } });
  const board = [...Array(5)].map(() => it("bar-chart race (top 10)")).concat([it("Bar-chart race"), it("streamgraph"), it("bar-chart race", "archived")]);
  assert.deepEqual(overusedForms(board), [{ form: "bar chart race", count: 6 }]);
});

test("renderBrief lists locked styles apart, drops retired ones from the floor, names overused forms", async () => {
  const { renderBrief, emptyLedger } = await import("../scripts/lib.mjs");
  const l = emptyLedger();
  l.styles = {
    ink: { name: "Ink", accepts: 2, style_rejects: 0, notes: [] },
    oars: { name: "Oars", accepts: 1, style_rejects: 0, notes: [] },
    tape: { name: "Tape", accepts: 1, style_rejects: 0, notes: [] },
  };
  l.style_status = { ink: { status: "locked", note: "the signature" }, tape: { status: "retired", note: null } };
  const board = [...Array(5)].map(() => ({ status: "pending", source: { chart_form: "line race" } }));
  const out = renderBrief({ template: "L:{{styles_locked}}\nA:{{styles_accepted}}\nR:{{styles_rejected}}\nO:{{overused}}", ledger: l, shots: 3, board });
  assert.match(out, /L:- \*\*Ink\*\* \(`ink`\) - owner on the style: "the signature"/);
  assert.match(out, /A:- \*\*Oars\*\*/);
  assert.doesNotMatch(out.split("\n")[1], /Tape|Ink/);
  assert.match(out, /R:- \*\*Tape\*\* \(`tape`\) - retired by the owner/);
  assert.match(out, /O:- line race \(5 on the Board\)/);
});

test("checkImages: listed, inside the folder, small, text-banned prompts, no unlisted files", async () => {
  const { checkImages } = await import("../scripts/lib.mjs");
  const ok = [{ file: "img/asphalt.jpg", role: "texture", prompt: "warm asphalt grain, no text, letters, numbers or logos" }];
  assert.deepEqual(checkImages(ok, { "img/asphalt.jpg": 400000 }), []);
  assert.deepEqual(checkImages([], {}), []);
  assert.match(checkImages(ok, { "img/asphalt.jpg": 4e6 }).join(), /under 2.5 MB/);
  assert.match(checkImages([{ ...ok[0], prompt: "asphalt" }], { "img/asphalt.jpg": 1 }).join(), /text ban/);
  assert.match(checkImages([{ ...ok[0], role: "chart" }], { "img/asphalt.jpg": 1 }).join(), /role/);
  assert.match(checkImages([], { "img/x.png": 1 }).join(), /not listed/);
  assert.match(checkImages([{ ...ok[0], file: "../x.jpg" }], {}).join(), /inside the variant folder/);
});

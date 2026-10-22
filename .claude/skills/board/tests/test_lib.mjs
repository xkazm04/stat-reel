import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFeedback, assessClockLabels, assessFrameFacts, assessLongevity, attributionPresent, dataReadySports, dataReadyUseCases, emptyLedger, excerptWindow, frameTimes, longevitySamples, loopPhase, renderBrief, renderLedgerMarkdown, stabilityProbe, stagedSeasonRange, textOutsideSafeBox, validateDesign, validateShot } from "../scripts/lib.mjs";

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

test("a re-decided item (undo, then a new decision) replaces its old tally instead of being skipped", () => {
  const first = applyFeedback(emptyLedger(), [item("a", "reject_both", "neon", "era-adjusted-rankings", "too busy")]);
  const redo = { ...item("a", "reject_case", "neon", "era-adjusted-rankings", "style is fine, case is not"), decided_at: "2026-10-02T09:00:00Z" };
  const l = applyFeedback(first, [redo]);
  assert.deepEqual([l.styles.neon.accepts, l.styles.neon.style_rejects, l.styles.neon.notes], [0, 0, []]);
  assert.deepEqual([l.cases["era-adjusted-rankings"].case_rejects, l.cases["era-adjusted-rankings"].notes], [1, ["style is fine, case is not"]]);
  assert.equal(l.cursor, "2026-10-02T09:00:00Z");
  assert.deepEqual(applyFeedback(l, [redo]), l, "the same decision folded twice is still a no-op");
  const accepted = applyFeedback(l, [{ ...item("a", "accept", "neon", "era-adjusted-rankings"), decided_at: "2026-10-03T09:00:00Z" }]);
  assert.deepEqual([accepted.styles.neon.accepts, accepted.cases["era-adjusted-rankings"].case_rejects, accepted.cases["era-adjusted-rankings"].accepts], [1, 0, 1]);
  assert.equal(accepted.seen.length, 1);
  const b = renderBrief({ template: "{{styles_rejected}}", ledger: first, shots: 3 });
  assert.match(b, /neon/);
  assert.doesNotMatch(renderBrief({ template: "{{styles_rejected}}", ledger: accepted, shots: 3 }), /neon/, "an un-rejected style leaves the anti-pattern list");
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
  assert.deepEqual(validateDesign({ ...tl, use_case_id: null, proposed_case: { name: "N", pitch: "p", data_time: "season", sport: "F1" } }, { useCases: [] }), []);
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

test("longevity: coverage is the overlap with the declared timeline, not the clock's own span", () => {
  const tl = { unit: "season", from: 1950, to: 2026 };
  const run = (f) => Array.from({ length: 12 }, (_, i) => ({ t: i * 6, clock: f(i), hash: `h${i}` }));
  // a clock in the wrong unit (race index 0..1100 against seasons) spans 1447% of the range
  assert.match(assessLongevity(run((i) => i * 100), tl).problems.join(), /coverage 0%/);
  // a clock that runs 1900-1980 spans 105% of the range but covers only its first 30 seasons
  assert.match(assessLongevity(run((i) => 1900 + (i * 80) / 11), tl).problems.join(), /coverage 39%/);
  assert.match(assessLongevity(run((i) => (i === 11 ? Infinity : 1950 + i * 7)), tl).problems.join(), /dataClock/);
  assert.equal(assessLongevity(run((i) => 1950 + i * 7), tl).ok, true);
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
    title: "t", pitch: "p", arc: "a", insight: "i", why_lasts: "Fangio leads until 1957, Clark passes him in 1968, Prost collapses in 1987", domain: "music", topic: "music", data_status: "new-source",
    tension: { expectation: "e", reality: "r", strength: "moderate" },
    beats: [{ at: "1960", what: "a" }, { at: "1970", what: "b" }, { at: "1985", what: "c" }, { at: "2005", what: "d" }],
    timeline: { unit: "year", from: 1960, to: 2020, years_from: 1960, years_to: 2020 },
    sources: [{ name: "MusicBrainz", url: "https://musicbrainz.org/doc/MusicBrainz_Database", license: "CC0" }],
  };
  assert.deepEqual(validateCaseIdea(ok), []);
  assert.match(validateCaseIdea({ ...ok, timeline: { ...ok.timeline, years_from: 2015 } }).join(), /at least 10/);
  assert.match(validateCaseIdea({ ...ok, beats: ok.beats.slice(1) }).join(), /beats/);
  const at = (...ys) => ys.map((y, i) => ({ at: String(y), what: "t" + i }));
  assert.match(validateCaseIdea({ ...ok, beats: at(1930, 1940, 1950, 1955, 1970) }).join(), /inside 1960-2020/);
  assert.match(validateCaseIdea({ ...ok, beats: at(1961, 1962, 1963, 1964, 1965) }).join(), /spread them/);
  assert.match(validateCaseIdea({ ...ok, beats: at(...Array.from({ length: 16 }, (_, i) => 1960 + i * 3)) }).join(), /keep the 15/);
  assert.match(validateCaseIdea({ ...ok, why_lasts: "A fascinating topic that keeps changing all the way through" }).join(), /why_lasts/);
  assert.match(validateCaseIdea({ ...ok, why_lasts: "Fangio leads until 1957, then Clark and Prost trade the lead" }).join(), /why_lasts/);
  const cast = (...k) => k.map((known, i) => ({ name: "E" + i, known }));
  assert.deepEqual(validateCaseIdea({ ...ok, cast: cast(true, true, false) }), []);
  assert.match(validateCaseIdea({ ...ok, cast: cast(true, false, false) }).join(), /only 1 of 3/);
  assert.match(validateCaseIdea({ ...ok, cast: cast(true) }).join(), /2-10 entities/);
  const series = (template, ...instances) => ({ template, instances });
  assert.deepEqual(validateCaseIdea({ ...ok, series: series("country share of a global chart", "films", "books", "video games") }), []);
  assert.match(validateCaseIdea({ ...ok, series: series("country share of a global chart", "films", "books") }).join(), /at least 3 further/);
  assert.match(validateCaseIdea({ ...ok, series: series("country share of a global chart", "T", "films", "Films") }).join(), /1 distinct/);
  assert.match(validateCaseIdea({ ...ok, series: series("", "films", "books", "games") }).join(), /series.template/);
  const wi = { ...ok, kind: "what-if", method: "hold the pre-event growth rate" };
  assert.deepEqual(validateCaseIdea({ ...wi, branch_year: 1990 }), []);
  assert.deepEqual(validateCaseIdea(wi), []);
  assert.match(validateCaseIdea({ ...wi, branch_year: 1975 }).join(), /only 15 years of real baseline/);
  assert.match(validateCaseIdea({ ...wi, branch_year: 1990, timeline: { ...ok.timeline, years_to: 2100 } }).join(), /more than 2x/);
  assert.match(validateCaseIdea({ ...wi, branch_year: 1990, timeline: { ...ok.timeline, years_to: 2110 } }).join(), /stops at 2100/);
  assert.doesNotMatch(validateCaseIdea({ ...wi, branch_year: 1975, timeline: { ...ok.timeline, unit: "month", years_to: 1995 } }).join(), /real baseline|more than 2x/);
  assert.match(validateCaseIdea({ ...wi, branch_year: 1975, timeline: { ...ok.timeline, years_to: 1995 } }).join(), /real baseline/);
  assert.match(validateCaseIdea({ ...wi, branch_year: 2020 }).join(), /must fall inside/);
  assert.match(validateCaseIdea({ ...ok, branch_year: 1990 }).join(), /only a what-if/);
  assert.match(validateCaseIdea({ ...ok, topic: undefined }).join(), /topic must be one of/);
  assert.match(validateCaseIdea({ ...ok, topic: "knitting" }).join(), /topic must be one of/);
  assert.deepEqual(validateCaseIdea({ ...ok, topic: "energy" }), []);
  assert.match(validateCaseIdea({ ...ok, tension: { expectation: "e", reality: "", strength: "x" } }).join(), /tension/);
  const strong = { expectation: "e", reality: "r", strength: "strong" };
  assert.match(validateCaseIdea({ ...ok, tension: strong }).join(), /tension.counter is required/);
  assert.deepEqual(validateCaseIdea({ ...ok, tension: { ...strong, counter: { provenance: "constructed", case: "rules changed" } } }), []);
  assert.match(validateCaseIdea({ ...ok, tension: { ...strong, counter: { provenance: "absent", case: "searched" } } }).join(), /YYYY-MM-DD/);
  assert.match(validateCaseIdea({ ...ok, tension: { ...strong, counter: { provenance: "guess", case: "x" } } }).join(), /needs provenance/);
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

// ---- truth probes

test("clock labels: a frame whose printed season agrees with floor(dataClock) passes", () => {
  const r = assessClockLabels([
    { t: 0, clock: 1990, texts: ["1990 · R1", "Data: F1DB (CC BY 4.0)"] },
    { t: 10, clock: 1994.94, texts: [{ text: "1994 · R16", px: 120 }, { text: "1990", px: 30 }] }, // axis tick 1990 is smaller: not the clock
    { t: 20, clock: 1995.0000000001, texts: ["1995"] },
  ]);
  assert.deepEqual(r.problems, []);
  assert.equal(r.checked, 3);
});

test("clock labels: a season-ahead label (the tl-001 failure) is caught with frame time, label and clock", () => {
  const r = assessClockLabels([
    { t: 0, clock: 1987, texts: ["1987 · R1"] },
    { t: 30.5, clock: 1987.94, texts: [{ text: "1988 · R16", px: 140 }, { text: "1987", px: 32 }] },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /t=30\.5s label "1988" but dataClock=1987\.94 \(season 1987\)/);
});

test("clock labels: unlabelled frames, year ranges and non-season units are not failures", () => {
  const r = assessClockLabels([
    { t: 0, clock: 1950, texts: ["Wins", "Hamilton 12"] },
    { t: 5, clock: 1960, texts: ["1950-2026 F1 wins"] }, // a range is a title
    { t: 9, clock: NaN, texts: ["1999"] },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.checked, 0);
  assert.equal(r.unlabelled, 2);
  assert.match(assessClockLabels([{ t: 0, clock: 3, texts: ["2020"] }], { unit: "race" }).skipped, /race/);
});

const rr = (race_id, season, round, name, pos, pts) => ({ race_id, season, round, display_name: name, position_number: pos, points_current_system: pts, is_indianapolis: false });
const tables = { f1_race_results: [
  rr("a", 1990, 1, "Senna", 1, 25), rr("a", 1990, 1, "Prost", 2, 18),
  rr("b", 1990, 2, "Prost", 1, 25), rr("b", 1990, 2, "Senna", 3, 15),
  rr("c", 1991, 1, "Senna", 1, 25), rr("c", 1991, 1, "Prost", 4, 12),
  { ...rr("i", 1991, 2, "Senna", 1, 25), is_indianapolis: true },
] };

test("frameFacts: declared standings that match the staged data pass (cumulative, season-scoped, per round)", () => {
  assert.equal(assessFrameFacts({ period: { season: 1990, round: 2 }, top: [{ name: "Prost", value: 1 }, { name: "Senna", value: 1 }] }, tables, { clock: 1990.5 }).ok, true);
  assert.equal(assessFrameFacts({ period: 1991, top: [{ name: "Senna", value: 2 }, { name: "Prost", value: 1 }] }, tables).ok, true);
  assert.equal(assessFrameFacts({ period: 1991, from: 1991, top: [{ name: "Senna", value: 1 }, { name: "Prost", value: 0 }] }, tables).ok, true); // window starts in 1991
  assert.equal(assessFrameFacts({ period: 1991, scope: "season", metric: "points_current_system", top: [{ name: "Senna", value: 25 }, { name: "Prost", value: 12 }] }, tables).ok, true);
});

test("frameFacts: a wrong value, a missing leader, an unknown driver and a period off the clock fail", () => {
  const wrong = assessFrameFacts({ period: 1991, top: [{ name: "Senna", value: 3 }] }, tables, { t: 12 });
  assert.match(wrong.problems.join(), /t=12\.0s.*"Senna" drawn as 3.*gives 2/);
  const missing = assessFrameFacts({ period: 1991, top: [{ name: "Prost", value: 1 }] }, tables);
  assert.match(missing.problems.join(), /leader is missing/);
  assert.match(assessFrameFacts({ period: 1991, top: [{ name: "Nobody", value: 1 }] }, tables).problems.join(), /no wins/);
  assert.match(assessFrameFacts({ period: 1991, top: [{ name: "Senna", value: 2 }] }, tables, { clock: 1990.9 }).problems.join(), /dataClock=1990\.90/);
});

test("frameFacts: the period is pinned to the clock only when the clock counts seasons", () => {
  // a race-unit design (one season, clock = round 1..N) declaring the standings it draws
  const decl = { period: { season: 1990, round: 2 }, top: [{ name: "Prost", value: 1 }, { name: "Senna", value: 1 }] };
  assert.deepEqual(assessFrameFacts(decl, tables, { clock: 2, unit: "race" }).problems, []);
  assert.deepEqual(assessFrameFacts(decl, tables, { clock: 3, unit: "career-start" }).problems, []);
  assert.match(assessFrameFacts(decl, tables, { clock: 1991.2, unit: "season" }).problems.join(), /dataClock=1991\.20/);
  assert.match(assessFrameFacts(decl, tables, { clock: 1991.2 }).problems.join(), /dataClock=1991\.20/, "unit defaults to season");
});

test("frameFacts: a design that does not declare it is skipped, never failed", () => {
  for (const d of [undefined, null]) assert.deepEqual(assessFrameFacts(d, tables), { ok: true, declared: false, problems: [], note: "not declared" });
});

// ---- the F1 data-ready predicate and proposed cases

const cell = (sport, status) => ({ sport, mode: "m", status });
const ucs = [
  { id: "f1-ready", cells: [cell("Soccer", "blocked"), cell("F1", "data-ready")] },
  { id: "soccer-only", cells: [cell("Soccer", "data-ready"), cell("F1", "not-tested")] },
  { id: "f1-failing", cells: [cell("F1", "failing")] },
  { id: "no-cells" },
];

test("dataReadyUseCases keeps only use cases with a data-ready cell for the sport", () => {
  assert.deepEqual(dataReadyUseCases(ucs).map((u) => u.id), ["f1-ready"]);
  assert.deepEqual(dataReadyUseCases(ucs, { sport: "soccer" }).map((u) => u.id), ["soccer-only"]);
  assert.deepEqual(dataReadyUseCases(undefined), []);
  assert.deepEqual(dataReadySports(ucs).sort(), ["F1", "Soccer"]);
});

test("a proposed case must be about a sport with data-ready cells and fit the staged seasons", () => {
  const base = { ...tl, use_case_id: null };
  const pc = (extra) => ({ ...base, proposed_case: { name: "N", pitch: "p", data_time: "season", ...extra } });
  const opts = { useCases: [], sports: ["F1"], period: { from: 1950, to: 2026 } };
  assert.deepEqual(validateDesign(pc({ sport: "F1" }), opts), []);
  assert.match(validateDesign(pc({ sport: "Soccer" }), opts).join(), /proposed case needs Soccer data, which is not tested yet/);
  assert.match(validateDesign(pc({}), opts).join(), /needs sport/);
  assert.match(validateDesign(pc({ sport: "F1", data_time: "fortnight" }), opts).join(), /data_time/);
  const out = { ...pc({ sport: "F1" }), timeline: { unit: "season", from: 1940, to: 2026 } };
  assert.match(validateDesign(out, opts).join(), /staged tables cover seasons 1950-2026/);
  assert.deepEqual(validateDesign(out, { ...opts, period: null }), []); // range unknown (harvest pre-check): skipped
  assert.deepEqual(stagedSeasonRange({ f1_seasons: [{ season: 1950 }, { season: 2025 }] }), { from: 1950, to: 2025 });
  assert.equal(stagedSeasonRange({}), null);
});

// ---- safe box and attribution

const rect = (text, x, y, w = 200, h = 40) => ({ text, x, y, w, h, t: 12 });

test("safe box (vertical): text inside passes, text in the bands fails", () => {
  // box: x 65..950, y 270..1250
  assert.deepEqual(textOutsideSafeBox([rect("1990", 65, 300), rect("Wins", 700, 1200, 250, 50)], "vertical").outside, []);
  const r = textOutsideSafeBox([rect("1990", 80, 300), rect("tick", 80, 100), rect("source", 80, 1300), rect("left", 20, 600), rect("right", 800, 600, 200)], "vertical");
  assert.deepEqual(r.outside.map((o) => o.text), ["tick", "source", "left", "right"]);
  assert.equal(r.ok, false);
  assert.equal(textOutsideSafeBox([rect("edge", 64, 269)], "vertical").ok, true); // 2 px slack
});

test("safe box: landscape has no box defined and is skipped with a note; unknown formats fail", () => {
  const r = textOutsideSafeBox([rect("x", 0, 0)], "landscape");
  assert.equal(r.ok, true);
  assert.match(r.skipped, /no landscape safe box/);
  assert.equal(textOutsideSafeBox([], "square").ok, false);
});

test("attribution: present when the string is on screen (any spacing, any node split), missing otherwise", () => {
  assert.equal(attributionPresent(["1990", "Data: F1DB (CC BY 4.0)"]).ok, true);
  assert.equal(attributionPresent([{ text: "Data:" }, { text: "F1DB (CC BY 4.0)" }]).ok, true);
  assert.equal(attributionPresent(["DATA:  F1DB  (CC BY 4.0)"]).ok, true);
  assert.equal(attributionPresent(["1990", "Source: F1DB"]).ok, false);
  assert.equal(attributionPresent([]).ok, false);
  assert.equal(attributionPresent(["Data: Ergast"], "Data: Ergast").ok, true);
});

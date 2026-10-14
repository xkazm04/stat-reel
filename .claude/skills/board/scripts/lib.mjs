// Pure half of the board skill (node --test tests/). Builtins only.

export const FORMATS = { vertical: [1080, 1920], landscape: [1920, 1080] };
const FACT_REF = /^[a-z0-9-]+:[^#\s]+#[a-z_]+$/;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function emptyLedger() {
  return { version: 1, cursor: null, seen: [], styles: {}, cases: {}, decisions: {} };
}

export const caseKey = (item) => (item.use_case_id ? item.use_case_id : item.proposed_case ? `proposed:${slug(item.proposed_case.name)}` : "unknown");

/** Add (sign 1) or take back (sign -1) one decision's tallies and note. */
function foldDecision(s, c, { decision, note }, sign) {
  if (decision === "accept") { s.accepts += sign; c.accepts += sign; }
  if (decision === "reject_style" || decision === "reject_both") s.style_rejects += sign;
  if (decision === "reject_case" || decision === "reject_both") c.case_rejects += sign;
  if (!note) return;
  const lists = [];
  if (decision !== "reject_case") lists.push(s.notes);
  if (decision === "reject_case" || decision === "reject_both" || decision === "accept") lists.push(c.notes);
  for (const notes of lists) {
    if (sign > 0) notes.push(note);
    else if (notes.lastIndexOf(note) >= 0) notes.splice(notes.lastIndexOf(note), 1);
  }
}

/**
 * Fold decided board items into the ledger. Idempotent by item id and decision: the same decision
 * twice is a no-op, but a re-decided item (the Board's undo, then a new decision) takes its old
 * tally back first, so the brief never quotes a verdict the owner withdrew. Items folded before
 * `decisions` existed have no record to take back and keep the old skip.
 */
export function applyFeedback(ledger, items) {
  const l = structuredClone(ledger);
  l.decisions ??= {};
  const seen = new Set(l.seen);
  for (const it of items) {
    if (!it.decision) continue;
    const prev = l.decisions[it.id];
    const note = it.note ?? null;
    if (seen.has(it.id) && (!prev || (prev.decision === it.decision && prev.note === note))) continue;
    seen.add(it.id);
    if (prev) foldDecision(l.styles[prev.style], l.cases[prev.case], prev, -1);
    const styleId = it.style?.id ?? "unknown";
    const s = (l.styles[styleId] ??= { name: it.style?.name ?? styleId, accepts: 0, style_rejects: 0, notes: [], last: null });
    const ck = caseKey(it);
    const c = (l.cases[ck] ??= { name: it.proposed_case?.name ?? it.use_case_id ?? ck, ...(it.proposed_case ? { pitch: it.proposed_case.pitch } : {}), accepts: 0, case_rejects: 0, notes: [], last: null });
    foldDecision(s, c, { decision: it.decision, note }, 1);
    l.decisions[it.id] = { decision: it.decision, style: styleId, case: ck, note };
    s.last = it.decided_at;
    c.last = it.decided_at;
    if (!l.cursor || it.decided_at > l.cursor) l.cursor = it.decided_at;
  }
  l.seen = [...seen];
  return l;
}

/** Discovery (find the form) until the owner has judged enough shots and accepted at least one style. */
export function loopPhase(ledger, { minDecisions = 12 } = {}) {
  const decided = ledger.seen.length;
  const accepted = Object.values(ledger.styles).some((s) => s.accepts > 0);
  return decided >= minDecisions && accepted ? "exploit" : "discovery";
}

const bullets = (rows) => (rows.length ? rows.map((r) => `- ${r}`).join("\n") : "- (none yet)");
const quoteNotes = (notes) => (notes.length ? ` - owner: ${notes.slice(-3).map((n) => `"${n}"`).join("; ")}` : "");

/**
 * Chart forms the Board already holds many times over: the brief names them so seats stop
 * reaching for the same x/y chart. `min` is the count from which a form counts as overused.
 */
export function overusedForms(board, min = 5) {
  const norm = (f) => String(f).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  const n = new Map();
  for (const i of board) {
    const f = i.source?.chart_form;
    if (!f || i.status === "archived") continue;
    const k = norm(f);
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return [...n].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).map(([form, count]) => ({ form, count }));
}

export function renderBrief({ template, ledger, shots, board = [], extra = {} }) {
  const styles = Object.entries(ledger.styles);
  const owner = ledger.style_status ?? {};
  const statusOf = (id) => owner[id]?.status ?? null;
  const ownerNote = (id) => (owner[id]?.note ? ` - owner on the style: "${owner[id].note}"` : "");
  const locked = styles.filter(([id]) => statusOf(id) === "locked")
    .map(([id, s]) => `**${s.name}** (\`${id}\`)${ownerNote(id)}${quoteNotes(s.notes)}`);
  const accepted = styles.filter(([id, s]) => !statusOf(id) && s.accepts > 0 && s.accepts >= s.style_rejects)
    .map(([id, s]) => `**${s.name}** (\`${id}\`) - ${s.accepts} accepted, ${s.style_rejects} style-rejected${ownerNote(id)}${quoteNotes(s.notes)}`);
  const rejected = [
    ...styles.filter(([id, s]) => statusOf(id) !== "locked" && statusOf(id) !== "retired" && s.style_rejects > s.accepts)
      .map(([id, s]) => `**${s.name}** (\`${id}\`) - ${s.style_rejects} style-rejected${quoteNotes(s.notes)}`),
    ...styles.filter(([id]) => statusOf(id) === "retired").map(([id, s]) => `**${s.name}** (\`${id}\`) - retired by the owner${ownerNote(id)}`),
  ];
  const overused = overusedForms(board).map((o) => `${o.form} (${o.count} on the Board)`);
  const cases = Object.entries(ledger.cases).map(([id, c]) => `\`${id}\` ${c.name}${c.pitch ? ` - ${c.pitch}` : ""}: ${c.accepts} accepted, ${c.case_rejects} case-rejected${quoteNotes(c.notes)}`);
  const tried = board.filter((i) => i.status === "pending")
    .map((i) => `**${i.style?.name}** (\`${i.style?.id}\`) on ${i.use_case_id ?? `proposed: ${i.proposed_case?.name}`} - "${i.title}"`);
  const vars = { phase: loopPhase(ledger), shots: String(shots), tried: bullets(tried), styles_locked: bullets(locked), styles_accepted: bullets(accepted), styles_rejected: bullets(rejected), overused: bullets(overused), cases: bullets(cases), decisions: String(ledger.seen.length), ...extra };
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function validateShot(meta, { clip = false } = {}) {
  const errors = [];
  if (!meta || typeof meta !== "object") return ["shot.json is missing or not an object"];
  if (!meta.title) errors.push("title is required");
  if (!(meta.format in FORMATS)) errors.push(`format must be one of ${Object.keys(FORMATS).join(", ")}`);
  if (!meta.style?.id || !meta.style?.name) errors.push("style {id, name} is required (a stable id: the owner's style feedback is keyed on it)");
  if (!meta.use_case_id && !meta.proposed_case?.name) errors.push("a use_case_id or proposed_case {name, pitch} is required");
  for (const f of meta.facts ?? []) if (!FACT_REF.test(f)) errors.push(`'${f}' is not a fact ref (<fact_key>#<column>)`);
  if (clip) {
    const d = meta.duration_s;
    if (typeof d !== "number") errors.push("duration_s is required for a clip (5-10 s)");
    else if (d < 5 || d > 10) errors.push(`duration_s ${d} must be 5-10 s`);
    if (typeof meta.poster_t !== "number" || meta.poster_t < 0 || (typeof d === "number" && meta.poster_t >= d))
      errors.push("poster_t must be a moment inside the clip (0 <= poster_t < duration_s)");
    if (meta.fps !== undefined && ![24, 25, 30].includes(meta.fps)) errors.push("fps must be 24, 25 or 30");
  }
  return errors;
}

export function renderLedgerMarkdown(ledger) {
  const styleRows = Object.entries(ledger.styles).sort((a, b) => b[1].accepts - a[1].accepts)
    .map(([id, s]) => `| ${s.name} | ${s.accepts} | ${s.style_rejects} | \`${id}\` | ${s.notes.slice(-2).join(" / ")} |`);
  const caseRows = Object.entries(ledger.cases).sort((a, b) => b[1].accepts - a[1].accepts)
    .map(([id, c]) => `| ${c.name} | ${c.accepts} | ${c.case_rejects} | \`${id}\` | ${c.notes.slice(-2).join(" / ")} |`);
  return [
    "# Board ledger", "", `Decisions folded: ${ledger.seen.length} · phase: **${loopPhase(ledger)}** · cursor: ${ledger.cursor ?? "-"}`, "",
    "## Styles", "", "| Style | Accepted | Style-rejected | id | Owner notes |", "|---|---|---|---|---|", ...styleRows, "",
    "## Cases", "", "| Case | Accepted | Case-rejected | id | Owner notes |", "|---|---|---|---|---|", ...caseRows, "",
  ].join("\n");
}

/** Frame timestamps for a clip: 0, 1/fps, ... (last frame strictly before duration). */
export function frameTimes(duration_s, fps = 30) {
  const n = Math.round(duration_s * fps);
  return Array.from({ length: n }, (_, i) => i / fps);
}

/**
 * Seek-stability probe: moments visited out of order and twice, the way a video renderer seeks
 * (Remotion renders frames in parallel and out of order). A frame that differs between visits is
 * not a pure function of t and will not survive the port to a real video.
 */
export function stabilityProbe(duration_s) {
  const at = (f) => Math.round(duration_s * f * 30) / 30;
  return [at(0.7), at(0.2), at(0.95), at(0.7), at(0.45), at(0.2)];
}

// ---- time-evolution designs (ADR 007) -------------------------------------------------------

const UNITS = ["season", "race", "matchday", "career-start", "date"];

/**
 * Use cases whose `cells` hold a data-ready cell for `sport` (the staged data is F1 only, so a Soccer
 * format is not a valid target). The one predicate for lanes, harvest and check.mjs.
 */
export function dataReadyUseCases(usecases, { sport = "F1" } = {}) {
  const same = (a) => String(a).toLowerCase() === String(sport).toLowerCase();
  return (usecases ?? []).filter((u) => (u.cells ?? []).some((c) => same(c.sport) && c.status === "data-ready"));
}

/** Sports that have at least one data-ready cell across the use cases (what a proposed case may be about). */
export function dataReadySports(usecases) {
  return [...new Set((usecases ?? []).flatMap((u) => (u.cells ?? []).filter((c) => c.status === "data-ready").map((c) => c.sport)))];
}

/** Season range the staged tables cover (f1_seasons, else f1_race_results), or null when nothing is staged. */
export function stagedSeasonRange(tables) {
  const seasons = (tables?.f1_seasons?.length ? tables.f1_seasons : tables?.f1_race_results ?? []).map((r) => r.season).filter((s) => typeof s === "number");
  return seasons.length ? { from: Math.min(...seasons), to: Math.max(...seasons) } : null;
}

/** A Board design is a full 30-90 s run whose data clock advances over a declared timeline. */
export function validateDesign(meta, { useCases = [], sports = ["F1"], period = null } = {}) {
  const errors = validateShot({ ...meta, facts: meta?.facts ?? [] });
  if (errors.length && !meta) return errors;
  const d = meta.duration_s;
  if (typeof d !== "number" || d < 30 || d > 90) errors.push(`duration_s ${d} must be 30-90 s (the full video, not a clip)`);
  const tl = meta.timeline;
  if (!tl || !UNITS.includes(tl.unit) || typeof tl.from !== "number" || typeof tl.to !== "number") {
    errors.push(`timeline {unit: ${UNITS.join("|")}, from: number, to: number} is required (the data time the video runs through)`);
  } else if (!(tl.from < tl.to)) errors.push("timeline must run forward (from < to)");
  if (!meta.chart_form) errors.push("chart_form is required (e.g. bar-chart race, line race, streamgraph)");
  if (meta.use_case_id && !useCases.includes(meta.use_case_id)) errors.push(`${meta.use_case_id} is not a time-evolution use case (${useCases.join(", ") || "none staged"})`);
  const pc = meta.proposed_case;
  if (!meta.use_case_id && pc) {
    // a proposal bypasses the use-case list, so it must still be makeable from the staged data
    if (!pc.data_time) errors.push("a proposed case needs data_time (what its clock runs through)");
    const sport = String(pc.sport ?? "").trim();
    if (!sport) errors.push(`a proposed case needs sport (one of ${sports.join(", ") || "none"}: the sport whose staged data it uses)`);
    else if (!sports.some((s) => String(s).toLowerCase() === sport.toLowerCase())) errors.push(`proposed case needs ${sport} data, which is not tested yet (staged: ${sports.join(", ") || "none"})`);
    const unit = typeof pc.data_time === "string" ? pc.data_time : pc.data_time?.unit;
    if (pc.data_time && !UNITS.includes(unit)) errors.push(`proposed case data_time ${JSON.stringify(unit)} must be one of ${UNITS.join(", ")}`);
    else if (unit === "season" && period && tl && typeof tl.from === "number" && (tl.from < period.from || tl.to > period.to))
      errors.push(`proposed case runs ${tl.from}-${tl.to} but the staged tables cover seasons ${period.from}-${period.to}`);
  }
  return errors;
}

/** The one cut-out the Board shows: `len` seconds centred on 45% of the run (never the finale). */
export function excerptWindow(duration_s, len = 8) {
  const start = Math.max(0, Math.min(duration_s - len, duration_s * 0.45 - len / 2));
  return { start_s: Math.round(start * 30) / 30, duration_s: len };
}

/** Moments sampled across the whole run for the longevity check (12 points, last just before the end). */
export function longevitySamples(duration_s, n = 12) {
  return Array.from({ length: n }, (_, i) => Math.round(((duration_s - 1 / 30) * i) / (n - 1) * 30) / 30);
}

/**
 * Longevity over the full run: the data clock must never go backwards, must cover >= 85% of the
 * declared range, and must not stall for more than 30% of the run; the picture must keep changing
 * (<= 30% of consecutive samples identical).
 */
export function assessLongevity(samples, timeline) {
  const problems = [];
  const clocks = samples.map((s) => s.clock);
  if (clocks.some((c) => typeof c !== "number" || !Number.isFinite(c))) problems.push("dataClock(t) missing or not a number");
  else {
    if (clocks.some((c, i) => i > 0 && c < clocks[i - 1] - 1e-9)) problems.push("data clock runs backwards");
    const span = timeline.to - timeline.from;
    // the part of the declared range the clock actually visits (a clock in another unit, or one
    // that runs before or after the range, does not cover it however far it travels)
    const covered = Math.max(0, Math.min(Math.max(...clocks), timeline.to) - Math.max(Math.min(...clocks), timeline.from)) / span;
    if (covered < 0.85) problems.push(`coverage ${(covered * 100).toFixed(0)}% of ${timeline.from}-${timeline.to}`);
    const stalls = clocks.filter((c, i) => i > 0 && Math.abs(c - clocks[i - 1]) < 1e-9).length / (clocks.length - 1);
    if (stalls > 0.3) problems.push(`data clock stalls for ${(stalls * 100).toFixed(0)}% of the run`);
  }
  const same = samples.filter((s, i) => i > 0 && s.hash === samples[i - 1].hash).length / Math.max(1, samples.length - 1);
  if (same > 0.3) problems.push(`picture static for ${(same * 100).toFixed(0)}% of the run`);
  const numeric = clocks.filter((c) => Number.isFinite(c));
  return {
    ok: problems.length === 0, problems,
    clock_from: numeric.length ? Math.min(...numeric) : null, clock_to: numeric.length ? Math.max(...numeric) : null,
    static_fraction: Math.round(same * 100) / 100,
  };
}

// ---- truth probes: the picture must say what the data clock says (loop tl-001) -------------------

const YEAR_RANGE = /(?<!\d)(?:19[5-9]\d|20[0-2]\d)\s*[-–—]\s*(?:19[5-9]\d|20[0-2]\d)(?!\d)/g;
const YEAR_TOKEN = /(?<![\d.,])(19[5-9]\d|20[0-2]\d)(?![\d])/g;
const ROUND_TOKEN = /(?<![A-Za-z])(?:R|Rd|Round)\s*(\d{1,2})(?!\d)/gi;
const CLOCK_EPS = 1e-6;

/** Year and round tokens visible in one frame's text (a year range such as "1950-2026" is a title, not a clock). */
export function clockTokens(texts) {
  const years = [];
  const rounds = [];
  for (const t of texts ?? []) {
    const text = typeof t === "string" ? t : String(t?.text ?? "");
    const px = typeof t === "object" && typeof t?.px === "number" ? t.px : null;
    const plain = text.replace(YEAR_RANGE, " ");
    for (const m of plain.matchAll(YEAR_TOKEN)) years.push({ year: Number(m[1]), px, text });
    for (const m of plain.matchAll(ROUND_TOKEN)) rounds.push(Number(m[1]));
  }
  return { years, rounds };
}

/**
 * Does the season printed on each sampled frame agree with `dataClock(t)`? Samples are
 * [{t, clock, texts}] where texts are strings or {text, px}. A season clock reads as
 * floor(clock) (1987.94 is still 1987; the skeleton's season + (round-1)/rounds), with 1e-6 slack
 * for float noise and NO other tolerance: the failure this catches is a label one season ahead.
 * When text sizes are known, the label is the year in the largest year-bearing text (the clock is
 * the largest element on screen; axis ticks and annotations may print other years); without sizes
 * any visible year may match. A frame with no year is "unlabelled", never a failure. Only
 * `unit: "season"` has a year-valued clock, other units return `skipped`.
 */
export function assessClockLabels(samples, { unit = "season" } = {}) {
  if (unit !== "season") return { ok: true, problems: [], checked: 0, unlabelled: 0, skipped: `unit ${unit}: no year-valued clock to compare` };
  const problems = [];
  let checked = 0;
  let unlabelled = 0;
  for (const s of samples ?? []) {
    if (typeof s.clock !== "number" || Number.isNaN(s.clock)) continue;
    const { years } = clockTokens(s.texts);
    if (!years.length) { unlabelled++; continue; }
    checked++;
    const sized = years.filter((y) => y.px !== null);
    const top = sized.length ? Math.max(...sized.map((y) => y.px)) : null;
    const label = top === null ? years : sized.filter((y) => y.px >= top - 1);
    const expected = Math.floor(s.clock + CLOCK_EPS);
    if (!label.some((y) => y.year === expected)) {
      const shown = [...new Set(label.map((y) => y.year))].join("/");
      problems.push(`t=${Number(s.t).toFixed(1)}s label "${shown}" but dataClock=${s.clock.toFixed(2)} (season ${expected}): the printed season and the data must come from the same step`);
    }
  }
  return { ok: problems.length === 0, problems, checked, unlabelled };
}

const FRAME_FACT_METRICS = ["wins", "podiums", "points_awarded", "points_current_system"];

/**
 * Optional contract `window.statreel.frameFacts(t)` -> {period, metric, scope, top:[{name, value}]}:
 * the standings the frame draws. `period` is a season or {season, round}; `metric` one of
 * wins|podiums|points_awarded|points_current_system (default wins); `scope` "cumulative" (default,
 * career totals through the period, counted from `from` when the design's window starts later) or "season". Recomputed from the staged f1_race_results
 * (Indianapolis 500 excluded). Not declared -> `declared: false` and no failure. `ctx.clock` also
 * pins period.season to floor(dataClock) when `ctx.unit` is "season" (the default); a race or
 * career-start clock counts rounds, not years, so it is not compared (as in assessClockLabels).
 */
export function assessFrameFacts(declared, tables, ctx = {}) {
  if (declared === undefined || declared === null) return { ok: true, declared: false, problems: [], note: "not declared" };
  const problems = [];
  const t = ctx.t === undefined ? "" : `t=${Number(ctx.t).toFixed(1)}s `;
  const period = typeof declared.period === "number" ? { season: declared.period } : declared.period;
  const metric = declared.metric ?? "wins";
  const scope = declared.scope ?? "cumulative";
  if (!period || typeof period.season !== "number") problems.push(`${t}frameFacts.period must be a season or {season, round}`);
  if (!FRAME_FACT_METRICS.includes(metric)) problems.push(`${t}frameFacts.metric must be one of ${FRAME_FACT_METRICS.join(", ")}`);
  if (!["cumulative", "season"].includes(scope)) problems.push(`${t}frameFacts.scope must be cumulative or season`);
  if (!Array.isArray(declared.top) || !declared.top.length) problems.push(`${t}frameFacts.top must list {name, value} entries`);
  const results = tables?.f1_race_results;
  if (!Array.isArray(results)) problems.push(`${t}f1_race_results is not staged, frameFacts cannot be checked`);
  if (problems.length) return { ok: false, declared: true, problems };
  if ((ctx.unit ?? "season") === "season" && typeof ctx.clock === "number" && period.season !== Math.floor(ctx.clock + CLOCK_EPS))
    problems.push(`${t}frameFacts.period season ${period.season} but dataClock=${ctx.clock.toFixed(2)}`);
  const upTo = period.round ?? Infinity;
  const totals = new Map();
  const seen = new Set();
  for (const r of results) {
    if (r.is_indianapolis) continue;
    if (r.season > period.season || (r.season === period.season && r.round > upTo)) continue;
    if (scope === "season" && r.season !== period.season) continue;
    if (r.season < (declared.from ?? 0)) continue;
    let add = 0;
    if (metric === "wins") add = r.position_number === 1 ? 1 : 0;
    else if (metric === "podiums") add = r.position_number >= 1 && r.position_number <= 3 ? 1 : 0;
    else add = Number(r[metric]) || 0;
    if (metric === "wins" || metric === "podiums") { // a take-over entry must not count a race twice
      const k = `${r.race_id}|${r.display_name}`;
      if (add && seen.has(k)) continue;
      if (add) seen.add(k);
    }
    totals.set(r.display_name, (totals.get(r.display_name) ?? 0) + add);
  }
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  for (const e of declared.top) {
    const want = totals.get(e.name);
    if (want === undefined) problems.push(`${t}frameFacts: "${e.name}" has no ${metric} in the staged data through ${period.season}${period.round ? ` R${period.round}` : ""}`);
    else if (typeof e.value !== "number" || !near(want, e.value)) problems.push(`${t}frameFacts: "${e.name}" drawn as ${e.value} but the staged data gives ${want} (${scope} ${metric} through ${period.season}${period.round ? ` R${period.round}` : ""})`);
  }
  const k = declared.top.length;
  const best = [...totals.values()].sort((a, b) => b - a).slice(0, k);
  const drawn = declared.top.map((e) => e.value).sort((a, b) => b - a);
  if (!problems.length && best.some((v, i) => !near(v, drawn[i]))) problems.push(`${t}frameFacts: the drawn top ${k} (${drawn.join(", ")}) is not the staged top ${k} (${best.join(", ")}): a leader is missing or mis-valued`);
  return { ok: problems.length === 0, declared: true, problems };
}

// ---- safe box and attribution gates (were prose in the briefs; mechanical now) --------------------

/** Required on screen for the whole run (CC BY 4.0 for F1DB). */
export const ATTRIBUTION = "Data: F1DB (CC BY 4.0)";

/**
 * Margins of the critical box per format, in artboard px. Vertical: 1080 - 65 - 130 = the 885 px
 * critical width of DESIGN.md (captions), top 270 and bottom 670 for platform UI. No landscape box is
 * defined yet, so landscape designs are skipped (with a note) rather than judged on a made-up box.
 */
export const SAFE_BOX = { vertical: { top: 270, bottom: 670, left: 65, right: 130 }, landscape: null };
const SAFE_SLACK = 2; // px: sub-pixel glyph overhang is not a violation

/**
 * Readable TEXT outside the safe box. rects are [{text, x, y, w, h, t?}] in artboard px (DOM text
 * ranges and canvas text boxes as measured by check.mjs). Atmosphere, texture and graphics may sit in
 * the bands outside the box; only text must not, so only text is passed in.
 */
export function textOutsideSafeBox(rects, format) {
  if (!(format in FORMATS)) return { ok: false, outside: [], skipped: null, problems: [`unknown format ${format}`] };
  const m = SAFE_BOX[format];
  if (!m) return { ok: true, outside: [], skipped: `no ${format} safe box defined: not checked` };
  const [W, H] = FORMATS[format];
  const box = { l: m.left - SAFE_SLACK, t: m.top - SAFE_SLACK, r: W - m.right + SAFE_SLACK, b: H - m.bottom + SAFE_SLACK };
  const outside = (rects ?? []).filter((r) => r.x < box.l || r.y < box.t || r.x + r.w > box.r || r.y + r.h > box.b);
  return { ok: outside.length === 0, outside, skipped: null };
}

/** Is the required attribution on screen? texts are one frame's visible strings; whitespace-insensitive, may span text nodes. */
export function attributionPresent(texts, required = ATTRIBUTION) {
  const squash = (s) => String(s).replace(/\s+/g, "").toLowerCase();
  const seen = squash((texts ?? []).map((t) => (typeof t === "string" ? t : t?.text ?? "")).join(" "));
  return { ok: seen.includes(squash(required)) };
}

// ---- mass loops (cheap seats, many rounds) -------------------------------------------------

/**
 * Every cited `<fact_key>#<column>` must name a staged row and one of its columns. A weak seat can
 * cite plausible keys that do not exist; those designs show figures nobody can trace.
 */
export function resolveFacts(facts, tables) {
  const rows = new Map();
  for (const list of Object.values(tables)) for (const r of list) if (r && r.fact_key) rows.set(r.fact_key, r);
  const unresolved = [];
  for (const f of facts ?? []) {
    const i = f.lastIndexOf("#");
    const row = i > 0 ? rows.get(f.slice(0, i)) : undefined;
    if (!row || !(f.slice(i + 1) in row)) unresolved.push(f);
  }
  return { cited: (facts ?? []).length, unresolved };
}

/**
 * Lanes keep parallel seats from converging: seat i gets two use cases, rotated by round, skipping
 * case-rejected ones. Seats still may propose a new case; the lane is where they start.
 */
export function seatLanes(caseIds, seats, round = 0, per = 2) {
  if (!caseIds.length) return Array.from({ length: seats }, () => []);
  return Array.from({ length: seats }, (_, s) =>
    Array.from({ length: Math.min(per, caseIds.length) }, (_, k) => caseIds[(round * seats * per + s * per + k) % caseIds.length]));
}

/** Case ids the owner rejected more often than accepted - lanes skip them. */
export function rejectedCases(ledger) {
  return Object.entries(ledger.cases).filter(([, c]) => c.case_rejects > c.accepts).map(([id]) => id);
}

// ---- case ideas (text-only use cases; mirrors apps/server/src/library.ts validateCaseIdea) ----

export const CASE_DOMAINS = ["f1", "sports", "games", "geoeconomy", "music", "culture", "science", "other"];
/** Mirrors TOPIC_SEED in packages/schemas/src/topics.ts (the controlled topic list, ADR 011), without the reserved "unassigned". */
export const CASE_TOPICS = ["formula-1", "football", "basketball", "ice-hockey", "tennis", "cycling", "motorsport-endurance", "motorcycle-racing", "athletics", "baseball", "american-football", "boxing", "golf", "cricket", "rugby", "energy", "trade", "markets", "demographics", "labour", "growth-income", "prices-housing", "debt-finance", "agriculture-food", "migration", "culture", "science", "games", "music", "other"];
export const DATA_STATUSES = ["staged", "registry", "new-source", "guess"];
export const CASE_KINDS = ["observed", "what-if", "influence"];
export const FEASIBILITY = ["likely", "possible", "hard"];
export const MIN_SPAN_YEARS = 10;
export const MIN_BEATS = 4;

/** Most beats a case may name; past this the video is a caption reel (accelerator-events). */
export const MAX_BEATS = 15;
/** Parsed beats must cover at least this share of the timeline, or the story is bunched in one stretch. */
export const MIN_BEAT_COVERAGE = 0.5;
const BEAT_YEAR = /\b(1[5-9]\d\d|20\d\d)\b/;

/**
 * Beats against the timeline (accelerator-events): beats dated before years_from are intro material, not
 * on-screen events, so only in-span beats count toward the minimum; a beat whose `at` names no year is
 * kept (it cannot be judged); and the dated in-span beats must spread over the span instead of bunching.
 */
export function beatProblems(c) {
  const beats = (Array.isArray(c.beats) ? c.beats : []).filter((b) => b?.at && b?.what);
  const tl = c.timeline;
  if (!tl || typeof tl.years_from !== "number" || typeof tl.years_to !== "number") return [];
  const e = [];
  if (beats.length > MAX_BEATS) e.push(`beats: ${beats.length} named; keep the ${MAX_BEATS} that explain the largest moves`);
  const years = [];
  let undated = 0;
  for (const b of beats) {
    const m = BEAT_YEAR.exec(String(b.at));
    if (!m) { undated++; continue; }
    const y = Number(m[1]);
    if (y >= tl.years_from && y <= tl.years_to) years.push(y);
  }
  if (years.length + undated < MIN_BEATS && beats.length >= MIN_BEATS) {
    e.push(`beats: only ${years.length + undated} fall inside ${tl.years_from}-${tl.years_to}; beats before the start are intro material and do not count`);
  }
  const span = tl.years_to - tl.years_from;
  if (years.length >= 2 && span > 0 && (Math.max(...years) - Math.min(...years)) / span < MIN_BEAT_COVERAGE) {
    e.push(`beats: dated ${Math.min(...years)}-${Math.max(...years)} cover under ${MIN_BEAT_COVERAGE * 100}% of ${tl.years_from}-${tl.years_to}; spread them over the span`);
  }
  return e;
}

/** Steel-man of the tension (mirrors the server's counterProblems): a strong tension must carry the strongest case against it, marked found / constructed / absent (dated). */
export function counterProblems(t) {
  const k = t?.counter;
  if (!k) return t?.strength === "strong" ? ["tension.counter is required for a strong tension: the strongest case against it {provenance: found|constructed|absent, case, searched}"] : [];
  if (!["found", "constructed", "absent"].includes(k.provenance) || !String(k.case ?? "").trim()) return ["tension.counter needs provenance (found|constructed|absent) and a case: what the opposition says, or what was searched for"];
  if (k.provenance === "absent" && !/^\d{4}-\d{2}-\d{2}$/.test(k.searched ?? "")) return ["tension.counter 'absent' needs searched: YYYY-MM-DD, the date of the search that found no opposition"];
  return [];
}

/** Shortest keep-watching rationale (path-over-conclusion); shorter cannot walk through moments by name and date. */
export const MIN_RATIONALE_CHARS = 40;
const RATIONALE_YEAR = /\b(1[5-9]\d\d|20\d\d)\b/g;

/**
 * The keep-watching rationale (path-over-conclusion): `why_lasts` must walk through the moments by name and date,
 * not call the topic interesting. Mechanical form: long enough, at least two dated moments, at least two named
 * entities (capitalised words past the first). A rationale that only says "keeps changing" fails.
 */
export function rationaleProblems(c) {
  const r = String(c.why_lasts ?? "").trim();
  if (!r) return [];
  const e = [];
  const years = new Set(r.match(RATIONALE_YEAR) ?? []);
  const names = new Set((r.replace(/^\S+\s*/, "").match(/\b[A-Z][\p{L}'-]{2,}/gu) ?? []).map((n) => n.toLowerCase()));
  if (r.length < MIN_RATIONALE_CHARS || years.size < 2 || names.size < 2) {
    e.push("why_lasts: walk through the moments that keep a viewer watching - at least two dated turns and two named entities (\"X leads until 2007, Y passes it in 2011\"), not that the topic is interesting");
  }
  return e;
}

/** Peak-cast bounds and recognisable share (recognizable-cast); mirror of apps/server/src/library.ts. */
export const MIN_CAST = 2;
export const MAX_CAST = 10;
export const MIN_CAST_KNOWN = 0.5;

/** An absent cast passes; a supplied one names 2-10 peak entities and at least half must be known without a caption. */
export function castProblems(c) {
  if (c.cast === undefined || c.cast === null) return [];
  const cast = Array.isArray(c.cast) ? c.cast.filter((x) => x?.name && String(x.name).trim()) : [];
  if (cast.length < MIN_CAST || cast.length > MAX_CAST) return [`cast: name ${MIN_CAST}-${MAX_CAST} entities on screen at the peak moment (${cast.length} given)`];
  const known = cast.filter((x) => x.known === true).length;
  if (known / cast.length < MIN_CAST_KNOWN) {
    return [`cast: only ${known} of ${cast.length} peak entities would be recognised without a caption; reframe around a recognisable anchor or drop the cast if scale is the draw`];
  }
  return [];
}

export function validateCaseIdea(c) {
  const e = [];
  if (!c || typeof c !== "object") return ["not an object"];
  for (const k of ["title", "pitch", "arc", "insight", "why_lasts"]) if (!c[k] || !String(c[k]).trim()) e.push(`${k} is required`);
  const t = c.tension;
  if (!t?.expectation?.trim() || !t?.reality?.trim() || !["strong", "moderate", "weak"].includes(t?.strength)) e.push("tension {expectation, reality, strength: strong|moderate|weak} is required");
  e.push(...counterProblems(t));
  if (!Array.isArray(c.beats) || c.beats.filter((b) => b?.at && b?.what).length < MIN_BEATS) e.push(`beats: at least ${MIN_BEATS} dated turns {at, what}`);
  if (!CASE_DOMAINS.includes(c.domain)) e.push(`domain must be one of ${CASE_DOMAINS.join(", ")}`);
  if (!CASE_TOPICS.includes(c.topic)) e.push(`topic must be one of ${CASE_TOPICS.join(", ")} (the controlled topic list)`);
  if (!DATA_STATUSES.includes(c.data_status)) e.push(`data_status must be one of ${DATA_STATUSES.join(", ")}`);
  const tl = c.timeline;
  if (!tl || typeof tl.years_from !== "number" || typeof tl.years_to !== "number" || !tl.unit || typeof tl.from !== "number" || typeof tl.to !== "number") e.push("timeline {unit, from, to, years_from, years_to} (numbers) is required");
  else if (tl.years_to - tl.years_from < MIN_SPAN_YEARS) e.push(`timeline covers ${tl.years_to - tl.years_from} years; needs at least ${MIN_SPAN_YEARS}`);
  e.push(...beatProblems(c));
  e.push(...rationaleProblems(c));
  e.push(...castProblems(c));
  if (c.kind !== undefined && !CASE_KINDS.includes(c.kind)) e.push(`kind must be one of ${CASE_KINDS.join(", ")}`);
  if ((c.kind === "what-if" || c.kind === "influence") && !String(c.method ?? "").trim()) e.push(`a ${c.kind} case needs method: how it is computed or measured`);
  if (c.data_status === "guess") {
    if (!String(c.data_guess ?? "").trim()) e.push("data_guess: say where the data might come from");
    if (!FEASIBILITY.includes(c.feasibility)) e.push(`feasibility must be one of ${FEASIBILITY.join(", ")}`);
    for (const s of c.sources ?? []) if (!s?.name) e.push("a source hint needs at least a name");
  } else if (!Array.isArray(c.sources) || !c.sources.length) e.push("sources: at least one {name, url, license}");
  else for (const s of c.sources) if (!s?.name || !s?.url || !s?.license) e.push(`source ${s?.name ?? "?"} needs name, url and license`);
  return e;
}

/** Normalised title for de-duplication across seats and against ideas already on the Board. */
export const titleKey = (s) => String(s).toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

// ---- generated images in a design (texture / backdrop / scene / motif; never data) ----------

export const IMAGE_ROLES = ["texture", "backdrop", "scene", "motif", "fill"];
export const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
export const MAX_IMAGES_BYTES = 15 * 1024 * 1024;
const NO_TEXT = /no (text|letters|lettering|words)/i;

/**
 * shot.json `images` against the files in the variant folder. `files` maps a relative path to its
 * byte size (every image file in the folder). Code draws the data; images carry texture, mood and
 * scene only, so every prompt carries the text ban and every image file is listed with its prompt.
 */
export function checkImages(images, files) {
  const e = [];
  const listed = new Set();
  let total = 0;
  for (const [i, im] of (images ?? []).entries()) {
    const f = String(im?.file ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!f || f.includes("..") || f.startsWith("/")) { e.push(`images[${i}].file must be a path inside the variant folder`); continue; }
    listed.add(f);
    if (!(f in files)) { e.push(`images[${i}] ${f} does not exist`); continue; }
    total += files[f];
    if (files[f] > MAX_IMAGE_BYTES) e.push(`${f} is ${(files[f] / 1048576).toFixed(1)} MB; compress it under 2.5 MB (jpg/webp)`);
    if (!IMAGE_ROLES.includes(im.role)) e.push(`images[${i}].role must be one of ${IMAGE_ROLES.join(", ")}`);
    if (!im.prompt || !NO_TEXT.test(im.prompt)) e.push(`images[${i}].prompt must be recorded and carry the text ban ("no text, letters, numbers, logos")`);
  }
  for (const f of Object.keys(files)) if (!listed.has(f)) e.push(`${f} is not listed in shot.json images[] (record every generated image with its prompt and role)`);
  if (total > MAX_IMAGES_BYTES) e.push(`images total ${(total / 1048576).toFixed(1)} MB; keep all images under 15 MB`);
  return e;
}

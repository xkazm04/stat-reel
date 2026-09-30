// Pure half of the board skill (node --test tests/). Builtins only.

export const FORMATS = { vertical: [1080, 1920], landscape: [1920, 1080] };
const FACT_REF = /^[a-z0-9-]+:[^#\s]+#[a-z_]+$/;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function emptyLedger() {
  return { version: 1, cursor: null, seen: [], styles: {}, cases: {} };
}

export const caseKey = (item) => (item.use_case_id ? item.use_case_id : item.proposed_case ? `proposed:${slug(item.proposed_case.name)}` : "unknown");

/** Fold decided board items into the ledger. Idempotent by item id. */
export function applyFeedback(ledger, items) {
  const l = structuredClone(ledger);
  const seen = new Set(l.seen);
  for (const it of items) {
    if (!it.decision || seen.has(it.id)) continue;
    seen.add(it.id);
    const styleId = it.style?.id ?? "unknown";
    const s = (l.styles[styleId] ??= { name: it.style?.name ?? styleId, accepts: 0, style_rejects: 0, notes: [], last: null });
    const ck = caseKey(it);
    const c = (l.cases[ck] ??= { name: it.proposed_case?.name ?? it.use_case_id ?? ck, ...(it.proposed_case ? { pitch: it.proposed_case.pitch } : {}), accepts: 0, case_rejects: 0, notes: [], last: null });
    if (it.decision === "accept") { s.accepts++; c.accepts++; }
    if (it.decision === "reject_style" || it.decision === "reject_both") s.style_rejects++;
    if (it.decision === "reject_case" || it.decision === "reject_both") c.case_rejects++;
    if (it.note) {
      if (it.decision !== "reject_case") s.notes.push(it.note);
      if (it.decision === "reject_case" || it.decision === "reject_both") c.notes.push(it.note);
      if (it.decision === "accept") c.notes.push(it.note);
    }
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

export function renderBrief({ template, ledger, shots, board = [], extra = {} }) {
  const styles = Object.entries(ledger.styles);
  const accepted = styles.filter(([, s]) => s.accepts > 0 && s.accepts >= s.style_rejects)
    .map(([id, s]) => `**${s.name}** (\`${id}\`) - ${s.accepts} accepted, ${s.style_rejects} style-rejected${quoteNotes(s.notes)}`);
  const rejected = styles.filter(([, s]) => s.style_rejects > s.accepts)
    .map(([id, s]) => `**${s.name}** (\`${id}\`) - ${s.style_rejects} style-rejected${quoteNotes(s.notes)}`);
  const cases = Object.entries(ledger.cases).map(([id, c]) => `\`${id}\` ${c.name}${c.pitch ? ` - ${c.pitch}` : ""}: ${c.accepts} accepted, ${c.case_rejects} case-rejected${quoteNotes(c.notes)}`);
  const tried = board.filter((i) => i.status === "pending")
    .map((i) => `**${i.style?.name}** (\`${i.style?.id}\`) on ${i.use_case_id ?? `proposed: ${i.proposed_case?.name}`} - "${i.title}"`);
  const vars = { phase: loopPhase(ledger), shots: String(shots), tried: bullets(tried), styles_accepted: bullets(accepted), styles_rejected: bullets(rejected), cases: bullets(cases), decisions: String(ledger.seen.length), ...extra };
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

/** A Board design is a full 30-90 s run whose data clock advances over a declared timeline. */
export function validateDesign(meta, { useCases = [] } = {}) {
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
  if (!meta.use_case_id && meta.proposed_case && !meta.proposed_case.data_time) errors.push("a proposed case needs data_time (what its clock runs through)");
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
  if (clocks.some((c) => typeof c !== "number" || Number.isNaN(c))) problems.push("dataClock(t) missing or not a number");
  else {
    if (clocks.some((c, i) => i > 0 && c < clocks[i - 1] - 1e-9)) problems.push("data clock runs backwards");
    const span = timeline.to - timeline.from;
    const covered = (Math.max(...clocks) - Math.min(...clocks)) / span;
    if (covered < 0.85) problems.push(`coverage ${(covered * 100).toFixed(0)}% of ${timeline.from}-${timeline.to}`);
    const stalls = clocks.filter((c, i) => i > 0 && Math.abs(c - clocks[i - 1]) < 1e-9).length / (clocks.length - 1);
    if (stalls > 0.3) problems.push(`data clock stalls for ${(stalls * 100).toFixed(0)}% of the run`);
  }
  const same = samples.filter((s, i) => i > 0 && s.hash === samples[i - 1].hash).length / Math.max(1, samples.length - 1);
  if (same > 0.3) problems.push(`picture static for ${(same * 100).toFixed(0)}% of the run`);
  const numeric = clocks.filter((c) => typeof c === "number");
  return {
    ok: problems.length === 0, problems,
    clock_from: numeric.length ? Math.min(...numeric) : null, clock_to: numeric.length ? Math.max(...numeric) : null,
    static_fraction: Math.round(same * 100) / 100,
  };
}

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
export const DATA_STATUSES = ["staged", "registry", "new-source"];
export const MIN_SPAN_YEARS = 10;
export const MIN_BEATS = 4;

export function validateCaseIdea(c) {
  const e = [];
  if (!c || typeof c !== "object") return ["not an object"];
  for (const k of ["title", "pitch", "arc", "insight", "why_lasts"]) if (!c[k] || !String(c[k]).trim()) e.push(`${k} is required`);
  const t = c.tension;
  if (!t?.expectation?.trim() || !t?.reality?.trim() || !["strong", "moderate", "weak"].includes(t?.strength)) e.push("tension {expectation, reality, strength: strong|moderate|weak} is required");
  if (!Array.isArray(c.beats) || c.beats.filter((b) => b?.at && b?.what).length < MIN_BEATS) e.push(`beats: at least ${MIN_BEATS} dated turns {at, what}`);
  if (!CASE_DOMAINS.includes(c.domain)) e.push(`domain must be one of ${CASE_DOMAINS.join(", ")}`);
  if (!DATA_STATUSES.includes(c.data_status)) e.push(`data_status must be one of ${DATA_STATUSES.join(", ")}`);
  const tl = c.timeline;
  if (!tl || typeof tl.years_from !== "number" || typeof tl.years_to !== "number" || !tl.unit || typeof tl.from !== "number" || typeof tl.to !== "number") e.push("timeline {unit, from, to, years_from, years_to} (numbers) is required");
  else if (tl.years_to - tl.years_from < MIN_SPAN_YEARS) e.push(`timeline covers ${tl.years_to - tl.years_from} years; needs at least ${MIN_SPAN_YEARS}`);
  if (!Array.isArray(c.sources) || !c.sources.length) e.push("sources: at least one {name, url, license}");
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

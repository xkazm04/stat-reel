/**
 * checkGenerationRules(props, plan, ctx): the six binding generation rules of spec D.8, enforced in
 * code. finalize and the MCP `validate_generation_output` call it and reject any violation.
 *
 *   1  side reveals only: no transition/enter/exit key anywhere
 *   2  timing plan first: sha256 matches, card frames come from the plan, knots are monotone
 *   3  top-10 with logos: <= 10 entities, ledger row per logo file, wordmark fallback, unique colours
 *   4  non-revealing title and hook
 *   5  fixed ending: the props cannot override or reorder it
 *   6  event cards: life_frames 105-135
 *
 * It works on UNPARSED input (anything an LLM wrote) and never throws. Rule 0 reports zod schema issues.
 */
import { DATA_RACE_LIMITS, DataRacePropsSchema } from "./data-race";
import {
  DATA_RACE_DURATION_S,
  DATA_RACE_FPS,
  ENDING_FRAMES,
  type TimingPlan,
  planSha256,
} from "./timing-plan";

export type RuleNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type RuleViolation = { rule: RuleNumber; code: string; path: string; message: string };
export type GenerationRulesResult = { ok: boolean; violations: RuleViolation[] };

/** A row of `out/assets.json` (spec D.8 rule 3). */
export type AssetLedgerRow = {
  /** repo-relative path of the saved file; matches `logo.path` */
  path: string;
  url: string;
  source_page: string;
  licence: string;
  author: string;
  trademark: boolean | string;
  sha256: string;
};

export type GenerationRulesContext = {
  /** rows of `out/assets.json`; required to accept any `logo.kind === "file"` */
  ledger?: readonly AssetLedgerRow[];
  /** optional: real sha256 of a logo file on disk (null = file missing); compared with the ledger row */
  fileSha256?: (path: string) => string | null;
};

/** The reveal denylist (rule 4). Matched as whole words / tokens, case-insensitive. */
export const REVEAL_DENYLIST = [
  "wins",
  "won",
  "dominates",
  "takes over",
  "overtakes",
  "beats",
  "champion",
  "record",
  "#1",
  "number one",
  "first place",
] as const;

const FORBIDDEN_TRANSITION_KEY = /(^|_)(transition|enter|exit)s?($|_)/i;
const ENDING_KEY = /(ending|outro|end_?card|subscribe|powered|sequence)/i;

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive containment (letters and digits are word characters). */
export function containsTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, "iu");
  return re.test(text);
}

function walkKeys(v: unknown, path: string, visit: (key: string, path: string) => void): void {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) walkKeys(v[i], `${path}[${i}]`, visit);
  }
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      visit(k, path ? `${path}.${k}` : k);
      walkKeys(x, path ? `${path}.${k}` : k, visit);
    }
  }
}

/** Rule 1: event transitions are fixed side reveals; props carry no transition vocabulary. */
function rule1(p: Loose, out: RuleViolation[]): void {
  walkKeys(p, "", (key, path) => {
    if (FORBIDDEN_TRANSITION_KEY.test(key))
      out.push({
        rule: 1,
        code: "transition-key",
        path,
        message: `'${key}' is not allowed: event cards always side-reveal, alternating left/right by card index (no transition, enter or exit field)`,
      });
  });
}

/** Rule 2: timing plan first. */
function rule2(p: Loose, plan: TimingPlan | undefined, out: RuleViolation[]): void {
  const add = (code: string, path: string, message: string) => out.push({ rule: 2, code, path, message });
  if (!plan || !isObj(plan)) {
    add("plan-missing", "timing_plan_sha256", "no timing plan: run compute_timing_plan first");
    return;
  }
  const actual = planSha256(plan);
  const claimed = str(p.timing_plan_sha256);
  if (!claimed) add("sha-missing", "timing_plan_sha256", "props must carry timing_plan_sha256 of timing-plan.json");
  else if (claimed !== actual)
    add("sha-mismatch", "timing_plan_sha256", `props name plan ${claimed} but timing-plan.json is ${actual}`);
  if (isObj(p.timing_plan) && planSha256(p.timing_plan) !== actual)
    add("embedded-plan-mismatch", "timing_plan", "the embedded timing_plan is not the plan timing_plan_sha256 names");

  // knots: strictly increasing frames and periods
  const knots = arr(plan.knots) as [number, number][];
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1];
    const b = knots[i];
    if (!a || !b || !(b[0] > a[0]) || !(b[1] > a[1])) {
      add("knots-not-monotone", `timing_plan.knots[${i}]`, `knots must increase in frame and period (${JSON.stringify(a)} -> ${JSON.stringify(b)})`);
      break;
    }
  }
  const periods = arr(p.periods);
  if (plan.periods.length !== periods.length)
    add("periods-mismatch", "periods", `props have ${periods.length} periods, the plan ${plan.periods.length}`);
  if (knots.length !== plan.periods.length)
    add("knots-count", "timing_plan.knots", `plan has ${knots.length} knots for ${plan.periods.length} periods`);

  // duration band 30-90 s
  const s = plan.sections;
  const seconds = s.total / DATA_RACE_FPS;
  if (seconds < DATA_RACE_DURATION_S.min || seconds > DATA_RACE_DURATION_S.max)
    add("duration", "timing_plan.sections.total", `video is ${seconds.toFixed(1)} s; must be 30-90 s (ADR 007)`);

  // every card's start_frame comes from the plan
  const byId = new Map(plan.events.map((e) => [e.id, e]));
  const seen = new Set<string>();
  arr(p.events).forEach((raw, i) => {
    const e = isObj(raw) ? raw : {};
    const id = str(e.id);
    if (seen.has(id)) add("event-duplicate", `events[${i}].id`, `duplicate event id '${id}'`);
    seen.add(id);
    const pe = byId.get(id);
    if (!pe) add("event-not-in-plan", `events[${i}].id`, `event '${id}' is not in the timing plan: pass it to compute_timing_plan`);
    else if (e.start_frame !== pe.frame)
      add("start-frame", `events[${i}].start_frame`, `event '${id}' starts at ${String(e.start_frame)}; the plan says ${pe.frame}`);
    else if (pe.frame >= s.timeline_end)
      add("event-after-timeline", `events[${i}].start_frame`, `event '${id}' starts at ${pe.frame}, after the timeline ends (${s.timeline_end})`);
  });
  // entities must be the ones the plan ordered
  const ids = arr(p.entities).map((e) => (isObj(e) ? str(e.id) : ""));
  if ([...ids].sort().join("|") !== [...plan.entities].sort().join("|"))
    add("entities-mismatch", "entities", "entity ids differ from the entities the timing plan was computed for");
}

/** Rule 3: top-10 entities with logos, unique colours. */
function rule3(p: Loose, ctx: GenerationRulesContext, out: RuleViolation[]): void {
  const add = (code: string, path: string, message: string) => out.push({ rule: 3, code, path, message });
  const entities = arr(p.entities).map((e) => (isObj(e) ? e : {}));
  if (entities.length > DATA_RACE_LIMITS.maxEntities)
    add("too-many-entities", "entities", `${entities.length} entities; the race shows min(10, available)`);
  if (entities.length < DATA_RACE_LIMITS.maxEntities && !str(p.entity_count_reason).trim())
    add("count-reason", "entity_count_reason", `${entities.length} entities shown: entity_count_reason must say why there are fewer than 10`);

  const colors = new Map<string, string>();
  const missing = new Set(arr(p.missing_logos).map(str));
  const ids = new Set(entities.map((e) => str(e.id)));
  for (const m of missing) if (!ids.has(m)) add("missing-logo-unknown", "missing_logos", `missing_logos names unknown entity '${m}'`);

  entities.forEach((e, i) => {
    const id = str(e.id) || `#${i}`;
    const c = str(e.color).toLowerCase();
    if (c) {
      const prev = colors.get(c);
      if (prev) add("duplicate-colour", `entities[${i}].color`, `entities '${prev}' and '${id}' share colour ${c}: every entity needs a unique colour`);
      else colors.set(c, id);
    }
    const logo = isObj(e.logo) ? e.logo : undefined;
    if (!logo) {
      add("logo-missing", `entities[${i}].logo`, `entity '${id}' has no logo: use an asset file with a ledger row or { kind: "wordmark" }`);
    } else if (logo.kind === "wordmark") {
      if (!missing.has(str(e.id))) add("wordmark-not-listed", `entities[${i}].logo`, `entity '${id}' uses the wordmark fallback: list it in missing_logos`);
    } else if (logo.kind === "file") {
      const path = str(logo.path);
      const row = ctx.ledger?.find((r) => r.path === path);
      if (!row) {
        add("logo-no-ledger-row", `entities[${i}].logo.path`, `logo '${path}' has no row in out/assets.json (url, source_page, licence, author, trademark, sha256)`);
      } else {
        for (const f of ["url", "source_page", "licence", "author"] as const)
          if (!str(row[f]).trim()) add("ledger-field", `entities[${i}].logo.path`, `ledger row for '${path}' lacks ${f}`);
        if (row.trademark === undefined || row.trademark === null || row.trademark === "")
          add("ledger-field", `entities[${i}].logo.path`, `ledger row for '${path}' lacks trademark`);
        if (!/^[0-9a-f]{64}$/.test(str(row.sha256))) add("ledger-field", `entities[${i}].logo.path`, `ledger row for '${path}' lacks a sha256`);
        else if (ctx.fileSha256) {
          const real = ctx.fileSha256(path);
          if (real === null) add("logo-file-missing", `entities[${i}].logo.path`, `logo file '${path}' does not exist`);
          else if (real !== row.sha256) add("logo-sha-mismatch", `entities[${i}].logo.path`, `logo file '${path}' does not match its ledger sha256`);
        }
      }
      if (missing.has(str(e.id))) add("missing-logo-has-file", "missing_logos", `entity '${id}' is in missing_logos but has a logo file`);
    } else {
      add("logo-kind", `entities[${i}].logo.kind`, `logo.kind must be "file" or "wordmark"; no other fallback exists`);
    }
  });
}

/** The entity that is #1 at the end, per the plan's last order (fallback: highest last value). */
function winnerOf(p: Loose, plan: TimingPlan | undefined): Loose | undefined {
  const entities = arr(p.entities).filter(isObj);
  const last = plan && Array.isArray(plan.orders) ? plan.orders[plan.orders.length - 1] : undefined;
  const id = last?.[0];
  if (id) return entities.find((e) => e.id === id);
  let best: Loose | undefined;
  let bestV = Number.NEGATIVE_INFINITY;
  for (const e of entities) {
    const vs = arr(e.values);
    const v = vs[vs.length - 1];
    if (typeof v === "number" && v > bestV) {
      bestV = v;
      best = e;
    }
  }
  return best;
}

/** Rule 4: non-revealing one-line title and a question hook. */
function rule4(p: Loose, plan: TimingPlan | undefined, out: RuleViolation[]): void {
  const add = (code: string, path: string, message: string) => out.push({ rule: 4, code, path, message });
  const title = str(p.title);
  const hook = str(p.hook);
  if (/[\r\n]/.test(title)) add("title-multiline", "title", "title must be a single line (no newline)");
  if (title.length > DATA_RACE_LIMITS.titleMaxChars)
    add("title-length", "title", `title is ${title.length} chars; the limit is ${DATA_RACE_LIMITS.titleMaxChars}`);
  if (!hook.trim().endsWith("?")) add("hook-question", "hook", 'hook must end with "?"');

  const winner = winnerOf(p, plan);
  const names = winner ? [str(winner.name), str(winner.id).replace(/-/g, " "), ...arr(winner.aliases).map(str)] : [];
  for (const [field, text] of [["title", title], ["hook", hook]] as const) {
    for (const n of names)
      if (n && containsTerm(text, n)) {
        add("reveals-winner", field, `${field} names the final #1 ('${n}'): titles and hooks never reveal the outcome`);
        break;
      }
    for (const w of REVEAL_DENYLIST)
      if (containsTerm(text, w)) add("reveal-word", field, `${field} contains the reveal word '${w}'`);
  }
  arr(p.events).forEach((raw, i) => {
    const t = str((raw as Loose | undefined)?.title);
    if (/[\r\n]/.test(t)) add("event-title-multiline", `events[${i}].title`, "event title must be a single line");
    if (t.length > DATA_RACE_LIMITS.eventTitleMaxChars)
      add("event-title-length", `events[${i}].title`, `event title is ${t.length} chars; the limit is ${DATA_RACE_LIMITS.eventTitleMaxChars}`);
  });
}

/** Rule 5: the ending is fixed and rendered by the composition. */
function rule5(p: Loose, plan: TimingPlan | undefined, out: RuleViolation[]): void {
  const add = (code: string, path: string, message: string) => out.push({ rule: 5, code, path, message });
  for (const k of Object.keys(p))
    if (k !== "spotlight" && ENDING_KEY.test(k))
      add("ending-override", k, `'${k}': the ending (winner spotlight, like & subscribe, Powered by StatReel) is fixed; props cannot add, reorder or override it`);
  if (!isObj(p.spotlight)) add("spotlight-missing", "spotlight", "spotlight.facts[] (1-2 fact-ref'd stats of the final #1) is required");
  else {
    for (const k of Object.keys(p.spotlight))
      if (k !== "facts") add("ending-override", `spotlight.${k}`, `spotlight only takes facts[]; '${k}' would change the fixed ending`);
    const n = arr(p.spotlight.facts).length;
    if (n < 1 || n > 2) add("spotlight-facts", "spotlight.facts", `spotlight.facts needs 1-2 entries, has ${n}`);
  }
  if (plan?.sections) {
    const s = plan.sections;
    const ok =
      s.spotlight_end - s.timeline_end === ENDING_FRAMES.spotlight &&
      s.like_end - s.spotlight_end === ENDING_FRAMES.like &&
      s.total - s.like_end === ENDING_FRAMES.powered;
    if (!ok)
      add("ending-frames", "timing_plan.sections", `ending must be spotlight ${ENDING_FRAMES.spotlight} + like & subscribe ${ENDING_FRAMES.like} + Powered by ${ENDING_FRAMES.powered} frames, in that order`);
  }
}

/** Rule 6: each event card lives 105-135 frames (default 120). */
function rule6(p: Loose, out: RuleViolation[]): void {
  arr(p.events).forEach((raw, i) => {
    const life = (raw as Loose | undefined)?.life_frames;
    if (life === undefined) return;
    if (typeof life !== "number" || !Number.isFinite(life) || life < DATA_RACE_LIMITS.lifeFramesMin || life > DATA_RACE_LIMITS.lifeFramesMax)
      out.push({
        rule: 6,
        code: "life-frames",
        path: `events[${i}].life_frames`,
        message: `life_frames ${String(life)} is outside ${DATA_RACE_LIMITS.lifeFramesMin}-${DATA_RACE_LIMITS.lifeFramesMax} (default ${DATA_RACE_LIMITS.lifeFramesDefault})`,
      });
  });
}

/**
 * Runs rules 1-6 (plus schema validation as rule 0). `props` is the unparsed props object;
 * `plan` is the parsed `work/out/timing-plan.json`.
 */
export function checkGenerationRules(
  props: unknown,
  plan: TimingPlan | undefined,
  ctx: GenerationRulesContext = {},
): GenerationRulesResult {
  const violations: RuleViolation[] = [];
  if (!isObj(props)) return { ok: false, violations: [{ rule: 0, code: "schema", path: "", message: "props must be a JSON object" }] };
  const parsed = DataRacePropsSchema.safeParse(props);
  if (!parsed.success)
    for (const i of parsed.error.issues)
      violations.push({ rule: 0, code: "schema", path: i.path.join("."), message: i.message });
  rule1(props, violations);
  rule2(props, plan, violations);
  rule3(props, ctx, violations);
  rule4(props, plan, violations);
  rule5(props, plan, violations);
  rule6(props, violations);
  return { ok: violations.length === 0, violations };
}

/** One line per violation, for validate_generation_output and job errors (verbatim). */
export const formatViolations = (vs: readonly RuleViolation[]): string[] =>
  vs.map((v) => `rule ${v.rule} [${v.code}] ${v.path || "(root)"}: ${v.message}`);

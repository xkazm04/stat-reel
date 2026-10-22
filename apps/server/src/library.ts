/**
 * The Board's two libraries (ADR 008):
 *
 * - Styles: every style id seen on the Board with its verdict from the owner's decisions, plus the
 *   owner's management on top - lock (a signature to rebuild faithfully), retire (no longer built
 *   on), a note and a hero item. The board skill reads it so the brief carries locked and retired
 *   styles, not just accept counts.
 * - Case ideas: use cases proposed as text, without art style, by the case loop. Each covers at
 *   least a decade of data time, says what it reveals over time, and names its data (staged, in the
 *   registry, or a new source the owner must approve). The owner accepts or rejects with a reason
 *   (too short, no insight, no data, duplicate) that feeds the next loop.
 */
import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { ArchivedError, type BoardItem, NotArchivedError, statusBeforeArchive } from "./board";
import { boardStyles, caseIdeas, type Db, now } from "./db";
import { TopicService } from "./topics";

// ---------------------------------------------------------------- styles

export const STYLE_ACTIONS = ["locked", "retired"] as const;
export type StyleOverride = (typeof STYLE_ACTIONS)[number];
export type StyleVerdict = "accepted" | "rejected" | "open";
export type StyleStatus = StyleVerdict | StyleOverride;
export type StyleEntry = {
  id: string;
  name: string;
  notes: string | null;
  /**
   * from the owner's decisions: accepted when accepts > style rejects, rejected when style rejects >
   * accepts, open on a tie (1:1 is no verdict) or when nothing is decided
   */
  verdict: StyleVerdict;
  /** precedence: the owner's explicit lock / retire, else the derived verdict */
  status: StyleStatus;
  owner_note: string | null;
  hero_item_id: string | null;
  accepts: number;
  /** reject_style + reject_both, kept for existing consumers */
  style_rejects: number;
  /** the two kinds of style reject, counted apart (additive) */
  reject_style: number;
  reject_both: number;
  /** the newest decision on the style is a reject yet the verdict is not "rejected": one click from flipping */
  at_risk?: true;
  pending: number;
  total: number;
  /** board item ids carrying this style, newest first */
  item_ids: string[];
  /** use case keys the style was tried on */
  cases: string[];
  updated_at: string | null;
};

const caseKey = (i: BoardItem) => i.use_case_id ?? (i.proposed_case ? `proposed:${i.proposed_case.name}` : "unknown");

export class StyleLibrary {
  constructor(private readonly db: Db) {}

  list(items: readonly BoardItem[]): StyleEntry[] {
    const overrides = new Map(this.db.select().from(boardStyles).all().map((r) => [r.id, r]));
    const by = new Map<string, StyleEntry>();
    for (const i of items) {
      if (!i.style?.id || i.status === "archived") continue;
      const e = by.get(i.style.id) ?? {
        id: i.style.id, name: i.style.name, notes: i.style.notes ?? null, verdict: "open", status: "open", owner_note: null,
        hero_item_id: null, accepts: 0, style_rejects: 0, reject_style: 0, reject_both: 0, pending: 0, total: 0, item_ids: [], cases: [], updated_at: null,
      } satisfies StyleEntry;
      e.total++;
      e.item_ids.push(i.id);
      if (!e.cases.includes(caseKey(i))) e.cases.push(caseKey(i));
      if (i.decision === "accept") e.accepts++;
      else if (i.decision === "reject_style") { e.reject_style++; e.style_rejects++; }
      else if (i.decision === "reject_both") { e.reject_both++; e.style_rejects++; }
      else if (!i.decision) e.pending++;
      by.set(i.style.id, e);
    }
    for (const e of by.values()) {
      e.verdict = e.accepts > e.style_rejects ? "accepted" : e.style_rejects > e.accepts ? "rejected" : "open";
      const newest = items.filter((i) => i.style?.id === e.id && i.status !== "archived" && i.decided_at)
        .reduce<BoardItem | null>((m, i) => (!m || (i.decided_at as string) > (m.decided_at as string) ? i : m), null);
      if (e.verdict !== "rejected" && (newest?.decision === "reject_style" || newest?.decision === "reject_both")) e.at_risk = true;
      const o = overrides.get(e.id);
      e.status = (o?.status as StyleOverride | null) ?? e.verdict;
      e.owner_note = o?.note ?? null;
      e.updated_at = o?.updated_at ?? null;
      e.hero_item_id = o?.hero_item_id && e.item_ids.includes(o.hero_item_id) ? o.hero_item_id : null;
      if (!e.hero_item_id) {
        const accepted = items.find((i) => i.style?.id === e.id && i.decision === "accept" && i.status !== "archived");
        e.hero_item_id = accepted?.id ?? e.item_ids[0] ?? null;
      }
    }
    const rank: Record<StyleStatus, number> = { locked: 0, accepted: 1, open: 2, retired: 3, rejected: 4 };
    return [...by.values()].sort((a, b) => rank[a.status] - rank[b.status] || b.accepts - a.accepts || a.name.localeCompare(b.name));
  }

  /**
   * The owner's management: `status` locked | retired | null (null clears the override and the
   * style goes back to its verdict); `note` replaces the owner note ("" clears); `hero_item_id`
   * picks the item shown for the style.
   */
  update(id: string, items: readonly BoardItem[], patch: { status?: StyleOverride | null; note?: string | null; hero_item_id?: string | null }): StyleEntry {
    const own = items.filter((i) => i.style?.id === id);
    if (!own.length) throw new Error(`unknown style ${id}`);
    // list() skips archived items, so a style with only archived items is not listed: managing it would store an
    // override and then have no entry to return (restore an item first)
    if (own.every((i) => i.status === "archived")) throw new ArchivedError("style", id, "restore one of its items first");
    if (patch.status !== undefined && patch.status !== null && !STYLE_ACTIONS.includes(patch.status)) {
      throw new Error(`status must be one of ${STYLE_ACTIONS.join(", ")} or null`);
    }
    if (patch.hero_item_id) {
      const hero = items.find((i) => i.id === patch.hero_item_id);
      if (!hero || hero.style?.id !== id) throw new Error(`item ${patch.hero_item_id} does not carry style ${id}`);
      // list() never shows an archived hero, so it would be stored and silently replaced
      if (hero.status === "archived") throw new ArchivedError("item", hero.id, "restore it before making it the hero");
    }
    const cur = this.db.select().from(boardStyles).where(eq(boardStyles.id, id)).get();
    const row = {
      id,
      status: patch.status !== undefined ? patch.status : (cur?.status ?? null),
      note: patch.note !== undefined ? patch.note?.trim() || null : (cur?.note ?? null),
      hero_item_id: patch.hero_item_id !== undefined ? patch.hero_item_id : (cur?.hero_item_id ?? null),
      updated_at: now(),
    };
    if (cur) this.db.update(boardStyles).set(row).where(eq(boardStyles.id, id)).run();
    else this.db.insert(boardStyles).values(row).run();
    return this.list(items).find((s) => s.id === id)!;
  }
}

// ---------------------------------------------------------------- case ideas

export const CASE_DOMAINS = ["f1", "sports", "games", "geoeconomy", "music", "culture", "science", "other"] as const;
export type CaseDomain = (typeof CASE_DOMAINS)[number];
export const CASE_DECISIONS = ["accept", "reject_not_interesting", "reject_short", "reject_no_insight", "reject_no_data", "reject_duplicate"] as const;
export type CaseDecision = (typeof CASE_DECISIONS)[number];
/** guess = brainstormed without verification (owner, 2026-10-01): where the data might come from, not proof. */
export const DATA_STATUSES = ["staged", "registry", "new-source", "guess"] as const;
export type DataStatus = (typeof DATA_STATUSES)[number];
/** The owner's rule: an approved case runs over at least a decade of data time. */
export const MIN_SPAN_YEARS = 10;
export const MIN_BEATS = 4;

/** Most beats a case may name; past this the video is a caption reel (accelerator-events). */
export const MAX_BEATS = 15;
/** Parsed beats must cover at least this share of the timeline, or the story is bunched in one stretch. */
export const MIN_BEAT_COVERAGE = 0.5;
const BEAT_YEAR = /\b(1[5-9]\d\d|20\d\d)\b/;

/** Peak-cast bounds (the DATA_RACE_LIMITS entity range) and the share that must be recognisable without a caption. */
export const MIN_CAST = 2;
export const MAX_CAST = 10;
export const MIN_CAST_KNOWN = 0.5;

/**
 * The peak cast against the universality claim (recognizable-cast): a case that supplies its cast must name
 * 2-10 entities and flag each as recognisable-without-a-caption or not; fewer than half known fails.
 * An absent cast passes (size and record ladders have no cast; the object is the draw).
 */
export function castProblems(c: Partial<NewCaseIdea>): string[] {
  if (c.cast === undefined || c.cast === null) return [];
  const cast = Array.isArray(c.cast) ? c.cast.filter((x) => x?.name && String(x.name).trim()) : [];
  if (cast.length < MIN_CAST || cast.length > MAX_CAST) return [`cast: name ${MIN_CAST}-${MAX_CAST} entities on screen at the peak moment (${cast.length} given)`];
  const known = cast.filter((x) => x.known === true).length;
  if (known / cast.length < MIN_CAST_KNOWN) {
    return [`cast: only ${known} of ${cast.length} peak entities would be recognised without a caption; reframe around a recognisable anchor or drop the cast if scale is the draw`];
  }
  return [];
}

/** Further instances a declared series must name besides the case itself. */
export const MIN_SERIES_INSTANCES = 3;

/**
 * The template a case belongs to (series-repeatability): a case that declares a series must name the template
 * (the data shape every episode shares) and at least 3 further instances, distinct from the case and each other.
 * An absent series passes (an event-driven one-off). A series never excuses a weak case; every instance is judged alone.
 */
export function seriesProblems(c: Partial<NewCaseIdea>): string[] {
  if (c.series === undefined || c.series === null) return [];
  const s = c.series;
  if (!String(s?.template ?? "").trim()) return ["series.template: name the repeatable template this case is one instance of (the data shape every episode shares)"];
  const key = (x: unknown) => String(x).toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set([key(c.title ?? "")]);
  let distinct = 0;
  for (const x of Array.isArray(s.instances) ? s.instances : []) {
    const k = key(x ?? "");
    if (k && !seen.has(k)) distinct++;
    if (k) seen.add(k);
  }
  if (distinct < MIN_SERIES_INSTANCES) return [`series.instances: name at least ${MIN_SERIES_INSTANCES} further episodes on the same data shape, other than this case (${distinct} distinct given); drop series for a one-off`];
  return [];
}

/** Real baseline a what-if must stand on before its branch year (speculative-grounding); about 10 when the series is monthly or finer. */
export const MIN_BASELINE_YEARS = 20;
export const MIN_BASELINE_YEARS_FINE = 10;
/** The speculative stretch may run at most this many times the real baseline, and never past MAX_PROJECTION_YEAR. */
export const MAX_REACH_RATIO = 2;
export const MAX_PROJECTION_YEAR = 2100;

/**
 * Speculative grounding: a what-if case that declares branch_year (the last year of real data) must stand on a real
 * baseline of 20 years (10 for monthly or finer series), reach no further than twice that baseline, and stop at 2100.
 * An absent branch_year passes (the case is not yet shaped); a branch_year on any other kind is refused.
 */
export function speculationProblems(c: Partial<NewCaseIdea>): string[] {
  if (c.branch_year === undefined || c.branch_year === null) return [];
  if (c.kind !== "what-if") return ["branch_year: only a what-if case has a branch point; drop it for an observed or influence case"];
  const t = c.timeline;
  if (!Number.isInteger(c.branch_year) || !t || typeof t.years_from !== "number" || typeof t.years_to !== "number") return ["branch_year: a whole year inside the timeline is required"];
  if (c.branch_year <= t.years_from || c.branch_year >= t.years_to) return [`branch_year ${c.branch_year} must fall inside ${t.years_from}-${t.years_to}, with speculation after it`];
  const fine = /month|week|day|hour|quarter/i.test(t.unit ?? "");
  const floor = fine ? MIN_BASELINE_YEARS_FINE : MIN_BASELINE_YEARS;
  const baseline = c.branch_year - t.years_from;
  const e: string[] = [];
  if (baseline < floor) e.push(`branch_year: only ${baseline} years of real baseline before ${c.branch_year}; a what-if needs at least ${floor}`);
  const horizon = t.years_to - c.branch_year;
  if (baseline > 0 && horizon > MAX_REACH_RATIO * baseline) e.push(`branch_year: the speculative stretch (${horizon} years) runs more than ${MAX_REACH_RATIO}x the ${baseline}-year real baseline; shorten it`);
  if (t.years_to > MAX_PROJECTION_YEAR) e.push(`timeline: speculation stops at ${MAX_PROJECTION_YEAR}`);
  return e;
}

/**
 * Beats against the timeline (accelerator-events): beats dated before years_from are intro material, not
 * on-screen events, so only in-span beats count toward the minimum; a beat whose `at` names no year is
 * kept (it cannot be judged); and the dated in-span beats must spread over the span instead of bunching.
 */
export function beatProblems(c: Partial<NewCaseIdea>): string[] {
  const beats = (Array.isArray(c.beats) ? c.beats : []).filter((b) => b?.at && b?.what);
  const tl = c.timeline;
  if (!tl || typeof tl.years_from !== "number" || typeof tl.years_to !== "number") return [];
  const e: string[] = [];
  if (beats.length > MAX_BEATS) e.push(`beats: ${beats.length} named; keep the ${MAX_BEATS} that explain the largest moves`);
  const years: number[] = [];
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
/** Shortest keep-watching rationale (path-over-conclusion); shorter cannot walk through moments by name and date. */
export const MIN_RATIONALE_CHARS = 40;
const RATIONALE_YEAR = /\b(1[5-9]\d\d|20\d\d)\b/g;

/**
 * The keep-watching rationale (path-over-conclusion): `why_lasts` must walk through the moments by name and date,
 * not call the topic interesting. Mechanical form: long enough, at least two dated moments, at least two named
 * entities (capitalised words past the first). A rationale that only says "keeps changing" fails.
 */
export function rationaleProblems(c: Partial<NewCaseIdea>): string[] {
  const r = String(c.why_lasts ?? "").trim();
  if (!r) return [];
  const e: string[] = [];
  const years = new Set(r.match(RATIONALE_YEAR) ?? []);
  const names = new Set((r.replace(/^\S+\s*/, "").match(/\b[A-Z][\p{L}'-]{2,}/gu) ?? []).map((n) => n.toLowerCase()));
  if (r.length < MIN_RATIONALE_CHARS || years.size < 2 || names.size < 2) {
    e.push("why_lasts: walk through the moments that keep a viewer watching - at least two dated turns and two named entities (\"X leads until 2007, Y passes it in 2011\"), not that the topic is interesting");
  }
  return e;
}
/**
 * observed: the data as it happened. what-if: a computed scenario (cross-era comparison, an injury
 * that did not happen) - always labelled a simulation, method stated. influence: key persons
 * (leaders, owners, managers) against the success or value of what they led, over time.
 */
export const CASE_KINDS = ["observed", "what-if", "influence"] as const;
export type CaseKind = (typeof CASE_KINDS)[number];
export const FEASIBILITY = ["likely", "possible", "hard"] as const;

export type CaseTimeline = { unit: string; from: number; to: number; years_from: number; years_to: number };
export type CaseSource = {
  name: string; url: string; license: string; coverage?: string; registry_id?: string | null;
  /** primary | secondary | aggregator | vendor | self-published (content-research-grounding / evidence-grading-ladder) */
  class?: string; confidence?: "high" | "medium" | "low";
};
/** What the viewer expects vs what the data shows over time; strength = how checkable, not how big. */
/** A dated moment where the story turns; >= 4 spread over the span is what makes a case last. */
export type CaseBeat = { at: string; what: string };
/** One entity on screen at the peak; `known`: a general viewer in the target market names it without a caption. */
export type CaseCastEntry = { name: string; known: boolean };
/** The repeatable template a case is one episode of, and further episodes on the same data shape. */
export type CaseSeries = { template: string; instances: string[] };
export type CaseTension = { expectation: string; reality: string; strength: "strong" | "moderate" | "weak"; counter?: CaseCounter };
/** The strongest case against the tension (steel-man): found beats constructed; "absent" is a dated search that came back empty. */
export type CaseCounter = { provenance: "found" | "constructed" | "absent"; case: string; searched?: string };
export const COUNTER_PROVENANCE = ["found", "constructed", "absent"] as const;

/** A "strong" tension must carry its steel-man; any counter present must be marked and, when absent, dated. */
export function counterProblems(t: Partial<CaseTension> | undefined): string[] {
  const k = t?.counter;
  if (!k) return t?.strength === "strong" ? ["tension.counter is required for a strong tension: the strongest case against it {provenance: found|constructed|absent, case, searched}"] : [];
  if (!COUNTER_PROVENANCE.includes(k.provenance) || !k.case?.trim()) return ["tension.counter needs provenance (found|constructed|absent) and a case: what the opposition says, or what was searched for"];
  if (k.provenance === "absent" && !/^\d{4}-\d{2}-\d{2}$/.test(k.searched ?? "")) return ["tension.counter 'absent' needs searched: YYYY-MM-DD, the date of the search that found no opposition"];
  return [];
}
export type NewCaseIdea = {
  title: string; pitch: string; domain: CaseDomain; arc: string; insight: string; why_lasts: string;
  tension: CaseTension; beats: CaseBeat[]; cast?: CaseCastEntry[] | null; series?: CaseSeries | null; branch_year?: number | null; unknowns?: string[]; timeline: CaseTimeline; chart_ideas?: string[]; requires?: string[]; sources: CaseSource[];
  evidence?: string[]; data_status: DataStatus; source?: Record<string, unknown> | null;
  kind?: CaseKind;
  /** what-if / influence: how the scenario or the influence is computed, in one or two sentences */
  method?: string | null;
  /** guess: where the data might come from */
  data_guess?: string | null;
  feasibility?: (typeof FEASIBILITY)[number] | null;
  /** topics.key (ADR 011): one of the controlled list; the case brief emits it, create() rejects unknown keys */
  topic?: string | null;
};
export type CaseIdea = Omit<NewCaseIdea, "source"> & {
  id: string; span_years: number; source: Record<string, unknown> | null;
  status: "pending" | "accepted" | "rejected" | "archived" | string; decision: CaseDecision | null; note: string | null;
  /** why the owner archived the idea; null while it is not archived */
  archive_reason: string | null; decided_at: string | null; created_at: string;
};

const parse = <T>(s: string | null, d: T): T => (s ? (JSON.parse(s) as T) : d);
const hydrate = (r: typeof caseIdeas.$inferSelect): CaseIdea => ({
  id: r.id, title: r.title, pitch: r.pitch, domain: r.domain as CaseDomain, arc: r.arc, insight: r.insight, why_lasts: r.why_lasts,
  tension: parse(r.tension_json, { expectation: "", reality: "", strength: "weak" } as CaseTension), unknowns: parse(r.unknowns_json, []), beats: parse(r.beats_json, []), cast: parse(r.cast_json, null), series: parse(r.series_json, null), branch_year: r.branch_year ?? null,
  timeline: parse(r.timeline_json, {} as CaseTimeline), span_years: r.span_years, chart_ideas: parse(r.chart_ideas_json, []),
  requires: parse(r.requires_json, []), sources: parse(r.sources_json, []), evidence: parse(r.evidence_json, []),
  data_status: r.data_status as DataStatus, source: parse(r.source_json, null), status: r.status,
  kind: (r.kind as CaseKind | null) ?? "observed", method: r.method, data_guess: r.data_guess,
  feasibility: (r.feasibility as NewCaseIdea["feasibility"]) ?? null, topic: r.topic ?? null,
  decision: r.decision as CaseDecision | null, note: r.note, archive_reason: r.archive_reason ?? null, decided_at: r.decided_at, created_at: r.created_at,
});

export function validateCaseIdea(c: Partial<NewCaseIdea>): string[] {
  const e: string[] = [];
  for (const k of ["title", "pitch", "arc", "insight", "why_lasts"] as const) if (!c[k] || !String(c[k]).trim()) e.push(`${k} is required`);
  if (!c.tension?.expectation?.trim() || !c.tension?.reality?.trim() || !["strong", "moderate", "weak"].includes(c.tension?.strength ?? "")) {
    e.push("tension {expectation, reality, strength: strong|moderate|weak} is required - what the viewer expects vs what the data shows");
  }
  e.push(...counterProblems(c.tension));
  if (!Array.isArray(c.beats) || c.beats.filter((b) => b?.at && b?.what).length < MIN_BEATS) {
    e.push(`beats: name at least ${MIN_BEATS} dated turns of the story {at, what} - a case without them cannot last`);
  }
  if (!c.domain || !CASE_DOMAINS.includes(c.domain)) e.push(`domain must be one of ${CASE_DOMAINS.join(", ")}`);
  if (!c.data_status || !DATA_STATUSES.includes(c.data_status)) e.push(`data_status must be one of ${DATA_STATUSES.join(", ")}`);
  const t = c.timeline;
  if (!t || typeof t.years_from !== "number" || typeof t.years_to !== "number" || !t.unit || typeof t.from !== "number" || typeof t.to !== "number") {
    e.push("timeline {unit, from, to, years_from, years_to} is required");
  } else if (t.years_to - t.years_from < MIN_SPAN_YEARS) {
    e.push(`timeline covers ${t.years_to - t.years_from} years; an approved case needs at least ${MIN_SPAN_YEARS} (a decade or all time)`);
  }
  e.push(...beatProblems(c));
  e.push(...rationaleProblems(c));
  e.push(...castProblems(c));
  e.push(...seriesProblems(c));
  e.push(...speculationProblems(c));
  if (c.kind !== undefined && !CASE_KINDS.includes(c.kind)) e.push(`kind must be one of ${CASE_KINDS.join(", ")}`);
  if ((c.kind === "what-if" || c.kind === "influence") && !c.method?.trim()) {
    e.push(`a ${c.kind} case needs method: how the ${c.kind === "what-if" ? "scenario is computed" : "influence is measured"}`);
  }
  if (c.data_status === "guess") {
    // brainstorming: a guess at where the data lives and how feasible it is, no proof needed
    if (!c.data_guess?.trim()) e.push("data_guess: say where the data might come from");
    if (!c.feasibility || !FEASIBILITY.includes(c.feasibility)) e.push(`feasibility must be one of ${FEASIBILITY.join(", ")}`);
    for (const s of c.sources ?? []) if (!s?.name) e.push("a source hint needs at least a name");
  } else if (!Array.isArray(c.sources) || !c.sources.length) e.push("sources: name at least one source {name, url, license}");
  else for (const s of c.sources) if (!s?.name || !s?.url || !s?.license) e.push(`source ${s?.name ?? "?"} needs name, url and license`);
  return e;
}

export class CaseIdeas {
  private readonly topics: TopicService;
  constructor(private readonly db: Db) {
    this.topics = new TopicService(db);
  }

  create(c: NewCaseIdea): CaseIdea {
    const errors = validateCaseIdea(c);
    if (c.topic !== undefined && c.topic !== null) {
      try { this.topics.assertPickable(c.topic); } catch (e) { errors.push(`topic: ${e instanceof Error ? e.message : String(e)}`); }
    }
    if (errors.length) throw new Error(errors.join("; "));
    const row = {
      id: `ci-${randomUUID().slice(0, 8)}`, title: c.title.trim(), pitch: c.pitch.trim(), domain: c.domain, arc: c.arc.trim(),
      insight: c.insight.trim(), why_lasts: c.why_lasts.trim(), tension_json: JSON.stringify(c.tension),
      unknowns_json: JSON.stringify(c.unknowns ?? []), beats_json: JSON.stringify(c.beats), cast_json: c.cast ? JSON.stringify(c.cast) : null, series_json: c.series ? JSON.stringify(c.series) : null, branch_year: c.branch_year ?? null, timeline_json: JSON.stringify(c.timeline),
      span_years: c.timeline.years_to - c.timeline.years_from, chart_ideas_json: JSON.stringify(c.chart_ideas ?? []),
      requires_json: JSON.stringify(c.requires ?? []), sources_json: JSON.stringify(c.sources ?? []), evidence_json: JSON.stringify(c.evidence ?? []),
      topic: c.topic ?? null, kind: c.kind ?? "observed", method: c.method?.trim() || null, data_guess: c.data_guess?.trim() || null, feasibility: c.feasibility ?? null,
      data_status: c.data_status, source_json: c.source ? JSON.stringify(c.source) : null, status: "pending", decision: null, note: null, archive_reason: null,
      decided_at: null, created_at: now(),
    };
    this.db.insert(caseIdeas).values(row).run();
    return hydrate(row);
  }

  /** Default list hides archived ideas; "all" shows everything. */
  list(filter: { status?: string } = {}): CaseIdea[] {
    const q = this.db.select().from(caseIdeas);
    const rows = (filter.status && filter.status !== "all" ? q.where(eq(caseIdeas.status, filter.status)) : q).orderBy(desc(caseIdeas.created_at)).all();
    return rows.filter((r) => filter.status === "archived" || filter.status === "all" || r.status !== "archived").map(hydrate);
  }

  get(id: string): CaseIdea | undefined {
    const r = this.db.select().from(caseIdeas).where(eq(caseIdeas.id, id)).get();
    return r ? hydrate(r) : undefined;
  }

  /** The owner picks (or with null clears) the topic of an idea; only an active key of the controlled list is accepted. */
  setTopic(id: string, topic: string | null): CaseIdea {
    if (!this.get(id)) throw new Error(`unknown case idea ${id}`);
    this.topics.setCaseTopic(id, topic);
    return this.get(id)!;
  }

  decide(id: string, decision: CaseDecision, note?: string): CaseIdea {
    if (!CASE_DECISIONS.includes(decision)) throw new Error(`decision must be one of ${CASE_DECISIONS.join(", ")}`);
    const cur = this.get(id);
    if (!cur) throw new Error(`unknown case idea ${id}`);
    if (cur.status === "archived") throw new ArchivedError("case idea", id, "restore it before deciding");
    this.db.update(caseIdeas).set({ status: decision === "accept" ? "accepted" : "rejected", decision, note: note?.trim() || null, decided_at: now() })
      .where(eq(caseIdeas.id, id)).run();
    return this.get(id)!;
  }

  /** Undo a decision (D.1): back to pending, decision, note and decided_at cleared. Archived ideas cannot be undone. */
  undo(id: string): CaseIdea {
    const cur = this.get(id);
    if (!cur) throw new Error(`unknown case idea ${id}`);
    if (cur.status === "archived") throw new ArchivedError("case idea", id, "restore it before undoing");
    this.db.update(caseIdeas).set({ status: "pending", decision: null, note: null, decided_at: null }).where(eq(caseIdeas.id, id)).run();
    return this.get(id)!;
  }

  /**
   * Archiving never touches the owner's decision note (the ledger survives the edit); the triage reason always
   * lands in its own `archive_reason` column, which the brainstorming loop reads as a signal.
   */
  archive(ids: string[], reason: string): number {
    let n = 0;
    for (const id of ids) {
      const cur = this.get(id);
      if (!cur || cur.status === "archived") continue; // the first reason stands
      this.db.update(caseIdeas).set({ status: "archived", archive_reason: reason }).where(eq(caseIdeas.id, id)).run();
      n++;
    }
    return n;
  }

  /**
   * Back to the state the idea left (decision kept, so accepted / rejected / pending, see statusBeforeArchive). Legacy rows
   * archived before archive_reason existed stored the reason in `note` only when the idea had none, so an undecided legacy
   * idea with a note has that note cleared; a decided one keeps its note.
   */
  restore(id: string): CaseIdea {
    const cur = this.get(id);
    if (!cur) throw new Error(`unknown case idea ${id}`);
    if (cur.status !== "archived") throw new NotArchivedError("case idea", id);
    const legacyReasonNote = cur.archive_reason === null && cur.decision === null;
    this.db.update(caseIdeas).set({ status: statusBeforeArchive(cur.decision), archive_reason: null, ...(legacyReasonNote ? { note: null } : {}) }).where(eq(caseIdeas.id, id)).run();
    return this.get(id) ?? cur;
  }

  /** Decided ideas since an ISO time (exclusive), oldest first: the case loop's feedback feed. */
  feedback(since?: string): CaseIdea[] {
    return this.db.select().from(caseIdeas).orderBy(asc(caseIdeas.decided_at)).all().map(hydrate)
      .filter((i) => i.status !== "archived" && i.decided_at && (!since || i.decided_at > since));
  }
}

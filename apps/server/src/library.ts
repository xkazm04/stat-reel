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
import type { BoardItem } from "./board";
import { boardStyles, caseIdeas, type Db, now } from "./db";

// ---------------------------------------------------------------- styles

export const STYLE_ACTIONS = ["locked", "retired"] as const;
export type StyleOverride = (typeof STYLE_ACTIONS)[number];
export type StyleVerdict = "accepted" | "rejected" | "open";
export type StyleStatus = StyleVerdict | StyleOverride;
export type StyleEntry = {
  id: string;
  name: string;
  notes: string | null;
  /** from the owner's decisions: accepted when accepts >= style rejects (and > 0) */
  verdict: StyleVerdict;
  /** the verdict unless the owner locked or retired the style */
  status: StyleStatus;
  owner_note: string | null;
  hero_item_id: string | null;
  accepts: number;
  style_rejects: number;
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
        hero_item_id: null, accepts: 0, style_rejects: 0, pending: 0, total: 0, item_ids: [], cases: [], updated_at: null,
      } satisfies StyleEntry;
      e.total++;
      e.item_ids.push(i.id);
      if (!e.cases.includes(caseKey(i))) e.cases.push(caseKey(i));
      if (i.decision === "accept") e.accepts++;
      else if (i.decision === "reject_style" || i.decision === "reject_both") e.style_rejects++;
      else if (!i.decision) e.pending++;
      by.set(i.style.id, e);
    }
    for (const e of by.values()) {
      e.verdict = e.accepts > 0 && e.accepts >= e.style_rejects ? "accepted" : e.style_rejects > e.accepts ? "rejected" : "open";
      const o = overrides.get(e.id);
      e.status = (o?.status as StyleOverride | null) ?? e.verdict;
      e.owner_note = o?.note ?? null;
      e.updated_at = o?.updated_at ?? null;
      e.hero_item_id = o?.hero_item_id && e.item_ids.includes(o.hero_item_id) ? o.hero_item_id : null;
      if (!e.hero_item_id) {
        const accepted = items.find((i) => i.style?.id === e.id && i.decision === "accept");
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
    if (!items.some((i) => i.style?.id === id)) throw new Error(`unknown style ${id}`);
    if (patch.status !== undefined && patch.status !== null && !STYLE_ACTIONS.includes(patch.status)) {
      throw new Error(`status must be one of ${STYLE_ACTIONS.join(", ")} or null`);
    }
    if (patch.hero_item_id && !items.some((i) => i.id === patch.hero_item_id && i.style?.id === id)) {
      throw new Error(`item ${patch.hero_item_id} does not carry style ${id}`);
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
export type CaseTension = { expectation: string; reality: string; strength: "strong" | "moderate" | "weak" };
export type NewCaseIdea = {
  title: string; pitch: string; domain: CaseDomain; arc: string; insight: string; why_lasts: string;
  tension: CaseTension; beats: CaseBeat[]; unknowns?: string[]; timeline: CaseTimeline; chart_ideas?: string[]; requires?: string[]; sources: CaseSource[];
  evidence?: string[]; data_status: DataStatus; source?: Record<string, unknown> | null;
  kind?: CaseKind;
  /** what-if / influence: how the scenario or the influence is computed, in one or two sentences */
  method?: string | null;
  /** guess: where the data might come from */
  data_guess?: string | null;
  feasibility?: (typeof FEASIBILITY)[number] | null;
};
export type CaseIdea = Omit<NewCaseIdea, "source"> & {
  id: string; span_years: number; source: Record<string, unknown> | null;
  status: "pending" | "accepted" | "rejected" | "archived" | string; decision: CaseDecision | null; note: string | null;
  decided_at: string | null; created_at: string;
};

const parse = <T>(s: string | null, d: T): T => (s ? (JSON.parse(s) as T) : d);
const hydrate = (r: typeof caseIdeas.$inferSelect): CaseIdea => ({
  id: r.id, title: r.title, pitch: r.pitch, domain: r.domain as CaseDomain, arc: r.arc, insight: r.insight, why_lasts: r.why_lasts,
  tension: parse(r.tension_json, { expectation: "", reality: "", strength: "weak" } as CaseTension), unknowns: parse(r.unknowns_json, []), beats: parse(r.beats_json, []),
  timeline: parse(r.timeline_json, {} as CaseTimeline), span_years: r.span_years, chart_ideas: parse(r.chart_ideas_json, []),
  requires: parse(r.requires_json, []), sources: parse(r.sources_json, []), evidence: parse(r.evidence_json, []),
  data_status: r.data_status as DataStatus, source: parse(r.source_json, null), status: r.status,
  kind: (r.kind as CaseKind | null) ?? "observed", method: r.method, data_guess: r.data_guess,
  feasibility: (r.feasibility as NewCaseIdea["feasibility"]) ?? null,
  decision: r.decision as CaseDecision | null, note: r.note, decided_at: r.decided_at, created_at: r.created_at,
});

export function validateCaseIdea(c: Partial<NewCaseIdea>): string[] {
  const e: string[] = [];
  for (const k of ["title", "pitch", "arc", "insight", "why_lasts"] as const) if (!c[k] || !String(c[k]).trim()) e.push(`${k} is required`);
  if (!c.tension?.expectation?.trim() || !c.tension?.reality?.trim() || !["strong", "moderate", "weak"].includes(c.tension?.strength ?? "")) {
    e.push("tension {expectation, reality, strength: strong|moderate|weak} is required - what the viewer expects vs what the data shows");
  }
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
  constructor(private readonly db: Db) {}

  create(c: NewCaseIdea): CaseIdea {
    const errors = validateCaseIdea(c);
    if (errors.length) throw new Error(errors.join("; "));
    const row = {
      id: `ci-${randomUUID().slice(0, 8)}`, title: c.title.trim(), pitch: c.pitch.trim(), domain: c.domain, arc: c.arc.trim(),
      insight: c.insight.trim(), why_lasts: c.why_lasts.trim(), tension_json: JSON.stringify(c.tension),
      unknowns_json: JSON.stringify(c.unknowns ?? []), beats_json: JSON.stringify(c.beats), timeline_json: JSON.stringify(c.timeline),
      span_years: c.timeline.years_to - c.timeline.years_from, chart_ideas_json: JSON.stringify(c.chart_ideas ?? []),
      requires_json: JSON.stringify(c.requires ?? []), sources_json: JSON.stringify(c.sources ?? []), evidence_json: JSON.stringify(c.evidence ?? []),
      kind: c.kind ?? "observed", method: c.method?.trim() || null, data_guess: c.data_guess?.trim() || null, feasibility: c.feasibility ?? null,
      data_status: c.data_status, source_json: c.source ? JSON.stringify(c.source) : null, status: "pending", decision: null, note: null,
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

  decide(id: string, decision: CaseDecision, note?: string): CaseIdea {
    if (!CASE_DECISIONS.includes(decision)) throw new Error(`decision must be one of ${CASE_DECISIONS.join(", ")}`);
    if (!this.get(id)) throw new Error(`unknown case idea ${id}`);
    this.db.update(caseIdeas).set({ status: decision === "accept" ? "accepted" : "rejected", decision, note: note?.trim() || null, decided_at: now() })
      .where(eq(caseIdeas.id, id)).run();
    return this.get(id)!;
  }

  /** Undo a decision (D.1): back to pending, decision, note and decided_at cleared. Archived ideas cannot be undone. */
  undo(id: string): CaseIdea {
    const cur = this.get(id);
    if (!cur) throw new Error(`unknown case idea ${id}`);
    if (cur.status === "archived") throw new Error(`case idea ${id} is archived`);
    this.db.update(caseIdeas).set({ status: "pending", decision: null, note: null, decided_at: null }).where(eq(caseIdeas.id, id)).run();
    return this.get(id)!;
  }

  archive(ids: string[], reason: string): number {
    let n = 0;
    for (const id of ids) {
      if (!this.get(id)) continue;
      this.db.update(caseIdeas).set({ status: "archived", note: reason }).where(eq(caseIdeas.id, id)).run();
      n++;
    }
    return n;
  }

  /** Decided ideas since an ISO time (exclusive), oldest first: the case loop's feedback feed. */
  feedback(since?: string): CaseIdea[] {
    return this.db.select().from(caseIdeas).orderBy(asc(caseIdeas.decided_at)).all().map(hydrate)
      .filter((i) => i.status !== "archived" && i.decided_at && (!since || i.decided_at > since));
  }
}

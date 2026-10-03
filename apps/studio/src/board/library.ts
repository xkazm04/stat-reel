/**
 * Pure logic for the Board's two libraries (ADR 008): the Styles gallery (verdict + the owner's lock /
 * retire) and the Use cases list (registry formats, cases accepted through designs, case ideas from
 * the text-only case loop). No React here; covered by library.test.ts.
 */
import type { UseCase } from "@statreel/schemas";
import type { BoardItem, CaseDecision, CaseIdea, StyleEntry, StyleStatus } from "../api";
import { slug } from "./board";

export type Tab = "designs" | "styles" | "cases";
export const TABS: readonly { tab: Tab; name: string; sub: string }[] = [
  { tab: "designs", name: "Designs", sub: "videos behind your gate" },
  { tab: "styles", name: "Styles", sub: "accepted looks, lock or retire" },
  { tab: "cases", name: "Use cases", sub: "stories worth a decade" },
];
export const parseTab = (v: unknown): Tab => (v === "styles" || v === "cases" ? v : "designs");

// ---------------------------------------------------------------- styles

export const STYLE_GROUPS: readonly { status: StyleStatus; title: string; hint: string }[] = [
  { status: "locked", title: "Locked", hint: "Signatures: loops rebuild them faithfully on new use cases." },
  { status: "accepted", title: "Accepted", hint: "The floor loops build on. Lock one to make it a signature, retire it to drop it." },
  { status: "open", title: "Not judged yet", hint: "Only pending designs carry these styles." },
  { status: "retired", title: "Retired", hint: "Once accepted, now out of the pool. Loops do not build on them." },
];

/** Rejected styles are hidden (D.1, Q3); the loops still read them from /api/styles. */
export const visibleStyles = <T extends { status: StyleStatus }>(styles: readonly T[]): T[] =>
  styles.filter((s) => s.status !== "rejected");

export function groupStyles(styles: readonly StyleEntry[]): { status: StyleStatus; title: string; hint: string; styles: StyleEntry[] }[] {
  return STYLE_GROUPS.map((g) => ({ ...g, styles: styles.filter((s) => s.status === g.status) })).filter((g) => g.styles.length);
}

/** The items of one style, hero first, in board order otherwise. */
export function styleItems(style: StyleEntry, byId: ReadonlyMap<string, BoardItem>): BoardItem[] {
  const ids = style.hero_item_id ? [style.hero_item_id, ...style.item_ids.filter((i) => i !== style.hero_item_id)] : style.item_ids;
  return ids.map((id) => byId.get(id)).filter((i): i is BoardItem => !!i);
}

// ---------------------------------------------------------------- use cases

export type CaseOrigin = "registry" | "design" | "idea";
export type CaseVerdict = "accepted" | "rejected" | "untested" | "pending";
export type CaseRow = {
  key: string;
  name: string;
  origin: CaseOrigin;
  verdict: CaseVerdict;
  pitch: string | null;
  /** "1950-2026" for ideas, the registry wording ("first season → latest race") otherwise */
  span: string | null;
  span_years: number | null;
  chart: string | null;
  accepts: number;
  case_rejects: number;
  pending: number;
  idea: CaseIdea | null;
  note: string | null;
};

const tally = (items: readonly BoardItem[], key: (i: BoardItem) => string | null) => {
  const t = new Map<string, { accepts: number; case_rejects: number; pending: number; notes: string[] }>();
  for (const i of items) {
    const k = key(i);
    if (!k || i.status === "archived") continue;
    const e = t.get(k) ?? { accepts: 0, case_rejects: 0, pending: 0, notes: [] };
    if (i.decision === "accept") e.accepts++;
    else if (i.decision === "reject_case" || i.decision === "reject_both") e.case_rejects++;
    else if (!i.decision) e.pending++;
    if (i.note && (i.decision === "reject_case" || i.decision === "reject_both")) e.notes.push(i.note);
    t.set(k, e);
  }
  return t;
};

const verdictOf = (t: { accepts: number; case_rejects: number; pending: number } | undefined): CaseVerdict =>
  !t || (!t.accepts && !t.case_rejects) ? (t?.pending ? "pending" : "untested") : t.accepts >= t.case_rejects ? "accepted" : "rejected";

const ideaVerdict = (d: CaseDecision | null): CaseVerdict => (!d ? "pending" : d === "accept" ? "accepted" : "rejected");

/**
 * Every use case the Board knows: the registry's time-evolution formats (verdict from designs made
 * on them), cases proposed by design seats (verdict from those designs), and case ideas from the
 * case loop (verdict from the owner's decision on the idea itself).
 */
export function caseRows(usecases: readonly UseCase[], items: readonly BoardItem[], ideas: readonly CaseIdea[]): CaseRow[] {
  const byCase = tally(items, (i) => i.use_case_id);
  const byProposed = tally(items, (i) => (i.proposed_case ? slug(i.proposed_case.name) : null));
  const rows: CaseRow[] = [];
  for (const u of usecases) {
    if ((u.family ?? "time-evolution") !== "time-evolution") continue;
    const t = byCase.get(u.id);
    rows.push({
      key: u.id, name: u.name, origin: "registry", verdict: verdictOf(t), pitch: u.arc ?? null,
      span: u.data_time ? `${u.data_time.from} → ${u.data_time.to}` : null, span_years: null, chart: u.chart_form ?? null,
      accepts: t?.accepts ?? 0, case_rejects: t?.case_rejects ?? 0, pending: t?.pending ?? 0, idea: null, note: t?.notes.at(-1) ?? null,
    });
  }
  const seen = new Set<string>();
  for (const i of items) {
    if (!i.proposed_case || i.status === "archived") continue;
    const k = slug(i.proposed_case.name);
    if (seen.has(k)) continue;
    seen.add(k);
    const t = byProposed.get(k);
    rows.push({
      key: `proposed:${k}`, name: i.proposed_case.name, origin: "design", verdict: verdictOf(t), pitch: i.proposed_case.pitch || null,
      span: null, span_years: null, chart: (i.source?.chart_form as string | undefined) ?? null,
      accepts: t?.accepts ?? 0, case_rejects: t?.case_rejects ?? 0, pending: t?.pending ?? 0, idea: null, note: t?.notes.at(-1) ?? null,
    });
  }
  for (const d of ideas) {
    rows.push({
      key: d.id, name: d.title, origin: "idea", verdict: ideaVerdict(d.decision), pitch: d.pitch,
      span: `${d.timeline.years_from}–${d.timeline.years_to}`, span_years: d.span_years, chart: d.chart_ideas[0] ?? null,
      accepts: d.decision === "accept" ? 1 : 0, case_rejects: d.decision && d.decision !== "accept" ? 1 : 0, pending: d.decision ? 0 : 1,
      idea: d, note: d.note,
    });
  }
  const rank: Record<CaseVerdict, number> = { accepted: 0, pending: 1, untested: 2, rejected: 3 };
  return rows.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.accepts - a.accepts || a.name.localeCompare(b.name));
}

/** Rejected cases and ideas are hidden from the lists (D.1); they stay in the data for /api/cases/feedback. */
export const visibleCaseRows = (rows: readonly CaseRow[]): CaseRow[] => rows.filter((r) => r.verdict !== "rejected");

export const CASE_DECISION_META: Record<CaseDecision, { label: string; key: string; hint: string }> = {
  accept: { label: "Accept", key: "a", hint: "worth a 30-90 s video over a decade or more" },
  reject_not_interesting: { label: "Not interesting", key: "n", hint: "it may hold up, but it is not worth working with" },
  reject_short: { label: "Too short", key: "s", hint: "cannot last: too little time or too few beats" },
  reject_no_insight: { label: "No insight", key: "i", hint: "the data moves, but nothing interesting happens" },
  reject_no_data: { label: "No data", key: "d", hint: "no source we could legally and reliably use" },
  reject_duplicate: { label: "Duplicate", key: "u", hint: "already covered by another case" },
};

/** A / N / S / I / D / U -> decision (the triage keys of the case dialog). */
export function caseDecisionForKey(key: string): CaseDecision | null {
  const k = key.toLowerCase();
  const hit = (Object.entries(CASE_DECISION_META) as [CaseDecision, { key: string }][]).find(([, m]) => m.key === k);
  return hit ? hit[0] : null;
}

/** The next undecided idea after `fromId` in `order` (wrapping), or null when all are decided. */
export function nextUndecided(order: readonly CaseIdea[], fromId: string | null): string | null {
  const i = order.findIndex((x) => x.id === fromId);
  for (let k = 1; k <= order.length; k++) {
    const c = order[(i + k + order.length) % order.length];
    if (c && !c.decision && c.id !== fromId) return c.id;
  }
  return null;
}

export const KIND_LABEL: Record<CaseIdea["kind"], string> = { observed: "Observed", "what-if": "What-if", influence: "Influence" };

export const DOMAIN_LABEL: Record<CaseIdea["domain"], string> = {
  f1: "F1", sports: "Sports", games: "Games", geoeconomy: "Geo-economy", music: "Music", culture: "Culture", science: "Science", other: "Other",
};

export const DATA_STATUS_LABEL: Record<CaseIdea["data_status"], string> = {
  staged: "Data staged",
  registry: "Source approved, not ingested",
  "new-source": "New source - needs your approval",
  guess: "Data guessed, not verified",
};

/** Pending ideas first, then by span (longer timelines first). */
export function inbox(ideas: readonly CaseIdea[]): CaseIdea[] {
  return ideas.filter((i) => !i.decision).sort((a, b) => b.span_years - a.span_years || a.title.localeCompare(b.title));
}

/**
 * Pure logic for the Board's two libraries (ADR 008): the Styles gallery (verdict + the owner's lock /
 * retire) and the Use cases list (registry formats, cases accepted through designs, case ideas from
 * the text-only case loop). No React here; covered by library.test.ts.
 */
import { DOMAIN_TOPIC, type Topic, type UseCase } from "@statreel/schemas";
import type { BoardItem, CaseDecision, CaseIdea, StyleEntry, StyleStatus } from "../api";
import { slug } from "./board";

export type Tab = "designs" | "styles" | "cases" | "archived";
export const TABS: readonly { tab: Tab; name: string; sub: string }[] = [
  { tab: "designs", name: "Designs", sub: "videos behind your gate" },
  { tab: "styles", name: "Styles", sub: "accepted looks, lock or retire" },
  { tab: "cases", name: "Use cases", sub: "stories worth a decade" },
  { tab: "archived", name: "Archived", sub: "hidden, with the reason" },
];
export const parseTab = (v: unknown): Tab => (v === "styles" || v === "cases" || v === "archived" ? v : "designs");

// ---------------------------------------------------------------- styles

export const STYLE_GROUPS: readonly { status: StyleStatus; title: string; hint: string }[] = [
  { status: "locked", title: "Locked", hint: "Signatures: loops rebuild them faithfully on new use cases." },
  { status: "accepted", title: "Accepted", hint: "The floor loops build on. Lock one to make it a signature, retire it to drop it." },
  { status: "open", title: "Not judged yet", hint: "Only pending designs carry these styles." },
  { status: "retired", title: "Retired", hint: "Once accepted, now out of the pool. Loops do not build on them." },
];

/** The rejected group, listed last and only when the owner asks to see rejected styles (see `filterStyles`). */
export const REJECTED_GROUP = {
  status: "rejected",
  title: "Rejected",
  hint: "More style rejects than accepts. Hidden by default; loops never reuse them. Reject counts show which kind of reject each was.",
} as const satisfies { status: StyleStatus; title: string; hint: string };

/** Rejected styles are hidden (D.1, Q3); the loops still read them from /api/styles. */
export const visibleStyles = <T extends { status: StyleStatus }>(styles: readonly T[]): T[] =>
  styles.filter((s) => s.status !== "rejected");

export type StyleFilter = { showRejected: boolean; atRiskOnly: boolean };
export const DEFAULT_STYLE_FILTER: StyleFilter = { showRejected: false, atRiskOnly: false };

/**
 * The gallery's filter: by default today's view (rejected hidden). `showRejected` reveals them; `atRiskOnly`
 * narrows to styles whose newest decision was a style reject without the verdict having flipped (the server's
 * `at_risk`), which is a triage queue of its own. At-risk takes precedence: a rejected style is never at risk.
 */
export function filterStyles<T extends { status: StyleStatus; at_risk?: true }>(styles: readonly T[], f: StyleFilter): T[] {
  if (f.atRiskOnly) return styles.filter((s) => s.at_risk === true);
  return f.showRejected ? [...styles] : visibleStyles(styles);
}

/**
 * What `at_risk` honestly means (apps/server/src/library.ts): the newest decision on the style is a style reject
 * (reject_style or reject_both) and the verdict is not yet "rejected" - the verdict is rejected once style rejects
 * outnumber accepts, so it takes `accepts - style_rejects + 1` more style rejects to flip it (one on a 1:1 tie).
 * It is a warning about the margin, not a prediction; null when the style is not at risk.
 */
export function atRiskWords(s: Pick<StyleEntry, "at_risk" | "accepts" | "style_rejects">): string | null {
  if (!s.at_risk) return null;
  const n = Math.max(1, s.accepts - s.style_rejects + 1);
  return `At risk: the latest decision was a style reject. ${n} more style reject${n === 1 ? "" : "s"} would turn it rejected (${s.accepts} accepted vs ${s.style_rejects} style-rejected now).`;
}

/** "2 style-rejected (1 style only · 1 style and case)"; null when nothing was style-rejected. */
export function rejectSplitWords(s: Pick<StyleEntry, "reject_style" | "reject_both">): string | null {
  const n = s.reject_style + s.reject_both;
  if (!n) return null;
  const parts = [s.reject_style ? `${s.reject_style} style only` : null, s.reject_both ? `${s.reject_both} style and case` : null].filter(Boolean);
  return `${n} style-rejected (${parts.join(" · ")})`;
}

export const atRiskCount = (styles: readonly { at_risk?: true }[]): number => styles.filter((s) => s.at_risk === true).length;

/**
 * The count on a tab button, from data already loaded (null = unknown or nothing to say, so no badge: an
 * unloaded list is not zero). Designs: pending designs. Use cases: the case inbox (ideas awaiting a decision).
 * Styles: styles at risk of flipping to rejected.
 */
export function tabCount(tab: Tab, c: { pendingDesigns?: number | null; inboxCases?: number | null; atRiskStyles?: number | null }): { n: number; word: string } | null {
  if (tab === "archived") return null; // hidden items are not work waiting for the owner
  const pick = tab === "designs" ? { n: c.pendingDesigns, word: "pending" } : tab === "cases" ? { n: c.inboxCases, word: "to decide" } : { n: c.atRiskStyles, word: "at risk" };
  return typeof pick.n === "number" && pick.n > 0 ? { n: pick.n, word: pick.word } : null;
}

export function groupStyles(styles: readonly StyleEntry[]): { status: StyleStatus; title: string; hint: string; styles: StyleEntry[] }[] {
  return [...STYLE_GROUPS, REJECTED_GROUP].map((g) => ({ ...g, styles: styles.filter((s) => s.status === g.status) })).filter((g) => g.styles.length);
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

/** The topic an idea resolves to on its own: its picked topic, else the unambiguous domain mapping (ADR 011). */
export const ideaTopic = (i: Pick<CaseIdea, "topic" | "domain">): { key: string; source: "case.topic" | "case.domain" } | null =>
  i.topic ? { key: i.topic, source: "case.topic" } : DOMAIN_TOPIC[i.domain] ? { key: DOMAIN_TOPIC[i.domain]!, source: "case.domain" } : null;

/** `sports` and `geoeconomy` ideas have no default: accepting one needs a picked topic first. */
export const needsTopic = (i: Pick<CaseIdea, "topic" | "domain">): boolean => ideaTopic(i) === null;

/** Pickable topics (never the reserved fallback), grouped by family in list order, for a <select>. */
export function topicGroups(topics: readonly Topic[]): { family: Topic["family"]; topics: Topic[] }[] {
  const out = new Map<Topic["family"], Topic[]>();
  for (const t of [...topics].sort((a, b) => a.sort - b.sort)) {
    if (t.key === "unassigned" || !t.active) continue;
    out.set(t.family, [...(out.get(t.family) ?? []), t]);
  }
  return [...out].map(([family, list]) => ({ family, topics: list }));
}

/** Pending ideas first, then by span (longer timelines first). */
export function inbox(ideas: readonly CaseIdea[]): CaseIdea[] {
  return ideas.filter((i) => !i.decision).sort((a, b) => b.span_years - a.span_years || a.title.localeCompare(b.title));
}

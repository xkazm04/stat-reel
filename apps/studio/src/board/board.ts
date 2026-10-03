/**
 * Pure Board helpers (ADR 006): decision vocabulary, item state, the two axes an item is judged on
 * (style and case), filters, counts, the style x case ledger, aspect handling for mixed
 * portrait/landscape shots, the justified wall layout and spatial keyboard moves.
 * No React, no DOM (unit-tested in board.test.ts).
 */
import { BOARD_DECISIONS, type BoardDecision, type BoardItem } from "../api";

// ------------------------------------------------------------------ prototype variants

export type Variant = 1 | 2 | 3;
export const VARIANTS: readonly { v: Variant; name: string; sub: string }[] = [
  { v: 1, name: "Wall", sub: "every shot at once, lightbox on click" },
  { v: 2, name: "Light table", sub: "one at a time, fast triage" },
  { v: 3, name: "Matrix", sub: "style x case, feedback as a pattern" },
];

/** `?v=1|2|3` (a number or a string); anything else is the default, 1. */
export function parseVariant(v: unknown): Variant {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseInt(v, 10) : Number.NaN;
  return n === 2 || n === 3 ? n : 1;
}

// ------------------------------------------------------------------ decisions

export type ItemState = "pending" | "accepted" | "rejected";
export const DECISION_META: Record<BoardDecision, { label: string; done: string; key: string; axis: string }> = {
  accept: { label: "Accept", done: "Accepted", key: "A", axis: "style and case both work" },
  reject_style: {
    label: "Reject style",
    done: "Rejected · style",
    key: "S",
    axis: "the form of presentation is wrong",
  },
  reject_case: { label: "Reject case", done: "Rejected · case", key: "C", axis: "the use case is wrong" },
  reject_both: { label: "Reject both", done: "Rejected · both", key: "B", axis: "neither the style nor the case" },
};
export const DECISIONS: readonly BoardDecision[] = BOARD_DECISIONS;

/** The gate shortcut for a key (A / S / C / B, either case); null for any other key. */
export function decisionForKey(key: string): BoardDecision | null {
  const k = key.toUpperCase();
  return DECISIONS.find((d) => DECISION_META[d].key === k) ?? null;
}

export const isDecision = (v: unknown): v is BoardDecision =>
  typeof v === "string" && (DECISIONS as readonly string[]).includes(v);

/** pending / accepted / rejected, from the decision first (the source of truth), then the status. */
export function itemState(i: Pick<BoardItem, "status" | "decision">): ItemState {
  if (i.decision === "accept") return "accepted";
  if (isDecision(i.decision)) return "rejected";
  return i.status === "accepted" ? "accepted" : i.status === "rejected" ? "rejected" : "pending";
}

/** The word on the grid: "Pending", "Accepted", "Rejected · style" ... */
export function stateLabel(i: Pick<BoardItem, "status" | "decision">): string {
  if (isDecision(i.decision)) return DECISION_META[i.decision].done;
  const s = itemState(i);
  return s === "pending" ? "Pending" : s === "accepted" ? "Accepted" : "Rejected";
}

/** Did this decision reject the item's style / its case? */
export const rejectsStyle = (d: BoardDecision | null): boolean => d === "reject_style" || d === "reject_both";
export const rejectsCase = (d: BoardDecision | null): boolean => d === "reject_case" || d === "reject_both";

// ------------------------------------------------------------------ axes

export const slug = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "x";

export type StyleRef = { key: string; id: string | null; name: string; notes: string | null };
export type CaseRef =
  | { key: string; kind: "existing"; id: string; name: string }
  | { key: string; kind: "proposed"; name: string; pitch: string; requires: string[] };

export function styleOf(i: Pick<BoardItem, "style">): StyleRef {
  const s = i.style;
  if (!s || (!s.id && !s.name)) return { key: "style:none", id: null, name: "No style named", notes: null };
  return { key: `style:${s.id || slug(s.name)}`, id: s.id || null, name: s.name || s.id, notes: s.notes ?? null };
}

/** The use case an item is for: an existing one (named from the heatmap registry) or a proposed one. */
export function caseOf(
  i: Pick<BoardItem, "use_case_id" | "proposed_case">,
  names?: ReadonlyMap<string, string>,
): CaseRef {
  if (i.use_case_id)
    return {
      key: `uc:${i.use_case_id}`,
      kind: "existing",
      id: i.use_case_id,
      name: names?.get(i.use_case_id) ?? i.use_case_id,
    };
  const p = i.proposed_case;
  if (p?.name)
    return {
      key: `new:${slug(p.name)}`,
      kind: "proposed",
      name: p.name,
      pitch: p.pitch ?? "",
      requires: p.requires ?? [],
    };
  return { key: "new:unnamed", kind: "proposed", name: "Unnamed proposal", pitch: "", requires: [] };
}

// ------------------------------------------------------------------ filters and counts

/**
 * SPEC D.1: rejected proposals are not listed in the default views, so "all" means every
 * non-rejected item. The "rejected" filter is the one deliberate way back to them (the rejected
 * lane: read-only, with Undo and re-decide), so a mistaken reject outlives its toast.
 */
export type StatusFilter = "all" | ItemState;
export const STATUS_FILTERS: readonly StatusFilter[] = ["all", "pending", "accepted", "rejected"];

/**
 * The items the owner sees for a status filter: everything except rejected proposals (they stay in
 * the data for the loops), unless the rejected lane itself is the filter.
 */
export const visibleItems = <T extends Pick<BoardItem, "status" | "decision">>(
  all: readonly T[],
  status: StatusFilter = "all",
): T[] => (status === "rejected" ? [...all] : all.filter((i) => itemState(i) !== "rejected"));
export const asStatusFilter = (v: unknown): StatusFilter =>
  typeof v === "string" && (STATUS_FILTERS as readonly string[]).includes(v) ? (v as StatusFilter) : "all";

export type BoardFilter = { status: StatusFilter; style: string; case: string };
export const NO_FILTER: BoardFilter = { status: "all", style: "all", case: "all" };
/** What the owner lands on: the review queue. Accepted shots are a click away, not mixed into it. */
export const DEFAULT_FILTER: BoardFilter = { ...NO_FILTER, status: "pending" };
export const isDefaultFilter = (f: BoardFilter): boolean =>
  f.status === DEFAULT_FILTER.status && f.style === "all" && f.case === "all";

export function filterItems<T extends BoardItem>(items: readonly T[], f: BoardFilter): T[] {
  return items.filter(
    (i) =>
      (f.status === "all" || itemState(i) === f.status) &&
      (f.style === "all" || styleOf(i).key === f.style) &&
      (f.case === "all" || caseOf(i).key === f.case),
  );
}

export type BoardCounts = {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  reject_style: number;
  reject_case: number;
  reject_both: number;
  styles: number;
  cases: number;
  proposed: number;
  loops: string[];
};

export function countItems(items: readonly BoardItem[]): BoardCounts {
  const c: BoardCounts = {
    total: items.length,
    pending: 0,
    accepted: 0,
    rejected: 0,
    reject_style: 0,
    reject_case: 0,
    reject_both: 0,
    styles: 0,
    cases: 0,
    proposed: 0,
    loops: [],
  };
  const styles = new Set<string>();
  const cases = new Set<string>();
  const proposed = new Set<string>();
  const loops = new Set<string>();
  for (const i of items) {
    c[itemState(i)] += 1;
    if (i.decision && i.decision !== "accept" && isDecision(i.decision)) c[i.decision] += 1;
    styles.add(styleOf(i).key);
    const k = caseOf(i);
    cases.add(k.key);
    if (k.kind === "proposed") proposed.add(k.key);
    const loop = i.source?.loop;
    if (typeof loop === "string" && loop) loops.add(loop);
  }
  c.styles = styles.size;
  c.cases = cases.size;
  c.proposed = proposed.size;
  c.loops = [...loops].sort();
  return c;
}

/** Filter options for one axis, in first-seen order, each with its item count. */
export function axisOptions(items: readonly BoardItem[], axis: "style" | "case", names?: ReadonlyMap<string, string>) {
  const out = new Map<string, { key: string; label: string; n: number; proposed: boolean }>();
  for (const i of items) {
    const r = axis === "style" ? styleOf(i) : caseOf(i, names);
    const o = out.get(r.key);
    if (o) o.n += 1;
    else out.set(r.key, { key: r.key, label: r.name, n: 1, proposed: "kind" in r && r.kind === "proposed" });
  }
  const list = [...out.values()];
  // existing cases before proposed ones; otherwise first-seen order
  return axis === "case" ? [...list.filter((o) => !o.proposed), ...list.filter((o) => o.proposed)] : list;
}

export type Group<T> = { key: string; label: string; proposed: boolean; items: T[] };
export function groupItems<T extends BoardItem>(
  items: readonly T[],
  by: "none" | "style" | "case",
  names?: ReadonlyMap<string, string>,
): Group<T>[] {
  if (by === "none") return [{ key: "all", label: "All shots", proposed: false, items: [...items] }];
  const opts = axisOptions(items, by, names);
  return opts.map((o) => ({
    key: o.key,
    label: o.label,
    proposed: o.proposed,
    items: items.filter((i) => (by === "style" ? styleOf(i).key : caseOf(i).key) === o.key),
  }));
}

// ------------------------------------------------------------------ the ledger (style x case)

export type AxisTally = {
  key: string;
  label: string;
  sub: string | null;
  proposed: boolean;
  total: number;
  pending: number;
  accepted: number;
  /** decisions that rejected THIS axis (reject_style + reject_both for a style, reject_case + reject_both for a case) */
  rejected: number;
  /** rejections aimed at the other axis: this one was spared */
  spared: number;
};

export type Ledger<T> = { styles: AxisTally[]; cases: AxisTally[]; cell: (style: string, kase: string) => T[] };

/**
 * Tallies come from every item given (rejections stay visible as feedback on an axis); only the
 * shots passing `shown` are drawn in the cells.
 */
export function ledger<T extends BoardItem>(
  items: readonly T[],
  names?: ReadonlyMap<string, string>,
  shown: (i: T) => boolean = () => true,
): Ledger<T> {
  const cells = new Map<string, T[]>();
  const tally = (key: string, label: string, sub: string | null, proposed: boolean): AxisTally => ({
    key,
    label,
    sub,
    proposed,
    total: 0,
    pending: 0,
    accepted: 0,
    rejected: 0,
    spared: 0,
  });
  const styles = new Map<string, AxisTally>();
  const cases = new Map<string, AxisTally>();
  for (const i of items) {
    const s = styleOf(i);
    const k = caseOf(i, names);
    const st = styles.get(s.key) ?? tally(s.key, s.name, s.id, false);
    const ct = cases.get(k.key) ?? tally(k.key, k.name, k.kind === "existing" ? k.id : null, k.kind === "proposed");
    styles.set(s.key, st);
    cases.set(k.key, ct);
    const state = itemState(i);
    for (const t of [st, ct]) {
      t.total += 1;
      if (state === "pending") t.pending += 1;
      if (state === "accepted") t.accepted += 1;
    }
    if (rejectsStyle(i.decision)) st.rejected += 1;
    else if (i.decision === "reject_case") st.spared += 1;
    if (rejectsCase(i.decision)) ct.rejected += 1;
    else if (i.decision === "reject_style") ct.spared += 1;
    const ck = `${s.key}|${k.key}`;
    if (shown(i)) cells.set(ck, [...(cells.get(ck) ?? []), i]);
  }
  const caseList = [...cases.values()];
  return {
    styles: [...styles.values()],
    cases: [...caseList.filter((c) => !c.proposed), ...caseList.filter((c) => c.proposed)],
    cell: (style, kase) => cells.get(`${style}|${kase}`) ?? [],
  };
}

/** One word for an axis from its tally: what the owner's feedback says about it so far. */
export function axisVerdict(t: AxisTally): "untested" | "open" | "liked" | "rejected" | "mixed" {
  const decided = t.total - t.pending;
  if (!decided) return t.total ? "open" : "untested";
  if (t.rejected && !t.accepted && !t.spared) return "rejected";
  if (!t.rejected && (t.accepted || t.spared)) return "liked";
  return "mixed";
}

// ------------------------------------------------------------------ shots: aspect and the wall

export const MIN_RATIO = 9 / 16;
export const MAX_RATIO = 16 / 9;

/** width / height clamped to 9:16 .. 16:9 (a 1x1 probe or a missing size is a square). */
export function ratioOf(w: number | null | undefined, h: number | null | undefined): number {
  if (!w || !h || w <= 0 || h <= 0) return 1;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, w / h));
}

export function shapeOf(
  w: number | null | undefined,
  h: number | null | undefined,
): "portrait" | "landscape" | "square" {
  const r = ratioOf(w, h);
  return r < 0.9 ? "portrait" : r > 1.1 ? "landscape" : "square";
}

export const sizeLabel = (w: number | null, h: number | null): string => (w && h ? `${w}×${h}` : "size unknown");

export type WallTile = { index: number; w: number; h: number };
export type WallRow = { h: number; tiles: WallTile[] };

/**
 * Justified rows (a photo wall): every tile in a row has the row's height and its own aspect, and
 * the row fills `width` exactly. A row breaks where its height lands nearest `target`; the last row
 * fills too while that keeps it within 1.25x `target`, else it keeps `target` and sits left.
 * Sizes are floored to whole px; the last tile takes the rounding.
 */
export function justify(ratios: readonly number[], width: number, target: number, gap: number): WallRow[] {
  const rows: WallRow[] = [];
  if (width <= 0 || target <= 0) return rows;
  let cur: number[] = [];
  let sum = 0;
  const close = (last: boolean) => {
    if (!cur.length) return;
    const free = width - gap * (cur.length - 1);
    let h = free / sum;
    // the last row fills the width too unless that would blow it past 1.25x the target
    if (last && h > target * 1.25) h = target;
    h = Math.max(1, Math.floor(h));
    const tiles = cur.map((index) => ({ index, w: Math.max(1, Math.floor((ratios[index] ?? 1) * h)), h }));
    if (!last || free / sum <= target * 1.25) {
      const used = tiles.reduce((a, t) => a + t.w, 0) + gap * (tiles.length - 1);
      const lastTile = tiles[tiles.length - 1];
      if (lastTile) lastTile.w = Math.max(1, lastTile.w + (width - used));
    }
    rows.push({ h, tiles });
    cur = [];
    sum = 0;
  };
  const rowH = (s: number, k: number) => (width - gap * (k - 1)) / s;
  ratios.forEach((r, index) => {
    if (cur.length) {
      const without = rowH(sum, cur.length);
      const withIt = rowH(sum + r, cur.length + 1);
      // this tile would squash the row below target: close before it when that lands nearer the target
      if (withIt <= target && Math.abs(without - target) < Math.abs(withIt - target)) close(false);
    }
    cur.push(index);
    sum += r;
    if (rowH(sum, cur.length) <= target) close(false);
  });
  close(true);
  return rows;
}

// ------------------------------------------------------------------ keyboard

export type Box = { x: number; y: number; w: number; h: number };
const MOVE_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
export const isMoveKey = (key: string): boolean => MOVE_KEYS.includes(key);

/**
 * The next item for an arrow key in any 2D layout, from on-screen boxes. Left/right: the nearest
 * box on the same line (vertical overlap), else the previous/next item in reading order.
 * Up/down: the nearest line above/below, then the box closest in x. Home/End: first/last.
 * Returns null when there is nowhere to go (the caller keeps focus where it is).
 */
export function spatialMove(boxes: readonly Box[], from: number, key: string): number | null {
  const n = boxes.length;
  if (!n) return null;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  const a = boxes[from];
  if (!a) return 0;
  const cx = (b: Box) => b.x + b.w / 2;
  const cy = (b: Box) => b.y + b.h / 2;
  const overlapY = (b: Box) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > Math.min(a.h, b.h) * 0.3;
  let best: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const dir = key === "ArrowRight" ? 1 : -1;
    boxes.forEach((b, i) => {
      if (i === from || !overlapY(b)) return;
      const d = (cx(b) - cx(a)) * dir;
      if (d <= 1) return;
      const s = d + Math.abs(cy(b) - cy(a)) * 0.1;
      if (s < bestScore) {
        bestScore = s;
        best = i;
      }
    });
    if (best !== null) return best;
    const next = from + dir;
    return next >= 0 && next < n ? next : null;
  }
  if (key === "ArrowUp" || key === "ArrowDown") {
    const dir = key === "ArrowDown" ? 1 : -1;
    boxes.forEach((b, i) => {
      if (i === from) return;
      // edge gap along y: the box must lie beyond this one
      const gapY = dir === 1 ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
      if (gapY < -Math.min(a.h, b.h) * 0.5) return;
      if ((cy(b) - cy(a)) * dir <= 1) return;
      // lexicographic: nearest line first (bucketed), then nearest in x
      const s = Math.round(Math.max(0, gapY) / 8) * 100_000 + Math.abs(cx(b) - cx(a));
      if (s < bestScore) {
        bestScore = s;
        best = i;
      }
    });
    return best;
  }
  return null;
}

/** Previous/next along a strip (Left/Up, Right/Down, Home, End), clamped; null for other keys. */
export function linearMove(i: number, key: string, n: number): number | null {
  if (!n) return null;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(n - 1, i + 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, i - 1);
  return null;
}

/** The next pending item after `fromId` in list order (wrapping), never `fromId` itself. */
export function nextPending(items: readonly BoardItem[], fromId: string | null): string | null {
  const start = fromId ? items.findIndex((i) => i.id === fromId) : -1;
  for (let k = 1; k <= items.length; k++) {
    const it = items[(start + k + items.length) % items.length];
    if (it && it.id !== fromId && itemState(it) === "pending") return it.id;
  }
  return null;
}

/** The previous pending item before `fromId` in list order (wrapping), never `fromId` itself. */
export function prevPending(items: readonly BoardItem[], fromId: string | null): string | null {
  const start = fromId ? items.findIndex((i) => i.id === fromId) : items.length;
  for (let k = 1; k <= items.length; k++) {
    const it = items[(start - k + items.length * 2) % items.length];
    if (it && it.id !== fromId && itemState(it) === "pending") return it.id;
  }
  return null;
}

/**
 * Where the review cursor goes when `removedId` leaves `order` (a reject under the pending filter,
 * any decision under "pending"): the item that took its place (the next one), else the one before
 * it, so triage keeps its position instead of jumping to the top. `order` is the list BEFORE the
 * removal; null when the id is not in it or nothing else is left.
 */
export function neighbourAfterRemoval<T extends { id: string }>(order: readonly T[], removedId: string): string | null {
  const at = order.findIndex((i) => i.id === removedId);
  if (at < 0) return null;
  return (order[at + 1] ?? order[at - 1])?.id ?? null;
}

// ------------------------------------------------------------------ provenance

/** Fact refs cited by the shot (`<fact_key>#<column>`), as strings. */
export function factRefs(source: Record<string, unknown> | null | undefined): string[] {
  const f = source?.facts;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : [];
}

const PROV_ORDER = ["skill", "loop", "contest", "seat", "variant"];
/** Scalar provenance fields (skill, loop, contest, seat, variant first; then any other scalar). */
export function provenance(source: Record<string, unknown> | null | undefined): { k: string; v: string }[] {
  if (!source) return [];
  const keys = [
    ...PROV_ORDER.filter((k) => k in source),
    ...Object.keys(source).filter((k) => !PROV_ORDER.includes(k)),
  ];
  return keys
    .map((k) => ({ k, v: source[k] }))
    .filter(
      (e): e is { k: string; v: string | number | boolean } =>
        ["string", "number", "boolean"].includes(typeof e.v) && e.v !== "",
    )
    .map((e) => ({ k: e.k, v: String(e.v) }));
}

/** Fact refs grouped by their key prefix (before `#`): "f1db:driver:x:season:2004" -> [wins, season]. */
export function groupFacts(refs: readonly string[]): { key: string; cols: string[] }[] {
  const m = new Map<string, string[]>();
  for (const r of refs) {
    const at = r.lastIndexOf("#");
    const key = at > 0 ? r.slice(0, at) : r;
    const col = at > 0 ? r.slice(at + 1) : "";
    const cols = m.get(key) ?? [];
    if (col && !cols.includes(col)) cols.push(col);
    m.set(key, cols);
  }
  return [...m.entries()].map(([key, cols]) => ({ key, cols }));
}

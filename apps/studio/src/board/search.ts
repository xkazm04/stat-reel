/**
 * The Board route's search params (`/board?tab=&v=&st=&style=&case=`). The filters live in the URL
 * so a reload (or a shared link) lands on the same queue; the default queue is the pending one
 * (`st` absent), so a clean URL is the daily review view. No React, no DOM (tested in search.test.ts).
 */
import {
  type BoardFilter,
  DEFAULT_FILTER,
  parseVariant,
  STATUS_FILTERS,
  type StatusFilter,
  type Variant,
} from "./board";
import { parseTab, type Tab } from "./library";

export type BoardSearch = { v?: Variant; tab?: Tab; st?: StatusFilter; style?: string; case?: string };

const text = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
  return s && s !== "all" ? s : undefined;
};

/** Route `validateSearch`: unknown values fall back to the default; defaults are omitted. */
export function parseBoardSearch(s: Record<string, unknown>): BoardSearch {
  const out: BoardSearch = {};
  if (s.v !== undefined) out.v = parseVariant(s.v);
  if (s.tab !== undefined) out.tab = parseTab(s.tab);
  // an unknown status is the default queue, not "all" (asStatusFilter's fallback)
  if (typeof s.st === "string" && (STATUS_FILTERS as readonly string[]).includes(s.st) && s.st !== DEFAULT_FILTER.status)
    out.st = s.st as StatusFilter;
  const style = text(s.style);
  if (style) out.style = style;
  const kase = text(s.case);
  if (kase) out.case = kase;
  return out;
}

export function filterFromSearch(s: Pick<BoardSearch, "st" | "style" | "case">): BoardFilter {
  return { status: s.st ?? DEFAULT_FILTER.status, style: s.style ?? "all", case: s.case ?? "all" };
}

/** The filter as search params: only what differs from the default queue. */
export function searchFromFilter(f: BoardFilter): Pick<BoardSearch, "st" | "style" | "case"> {
  return {
    st: f.status === DEFAULT_FILTER.status ? undefined : f.status,
    style: f.style === "all" ? undefined : f.style,
    case: f.case === "all" ? undefined : f.case,
  };
}

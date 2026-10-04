/**
 * The Board route's search params (`/board?tab=&v=&st=&style=&case=`). The filters live in the URL
 * so a reload (or a shared link) lands on the same queue; the default queue is the pending one
 * (`st` absent), so a clean URL is the daily review view. No React, no DOM (tested in search.test.ts).
 */

import type { BoardItem } from "../api";
import {
  type BoardFilter,
  caseOf,
  DEFAULT_FILTER,
  parseVariant,
  STATUS_FILTERS,
  type StatusFilter,
  slug,
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

/**
 * The Board designs for one case idea, as search params (the "visuals ready" badge link). Generated designs carry
 * `case_idea_id`; their case filter key is the one `caseOf` derives (a proposed case named after the idea), so it is
 * read off the first such item, falling back to the title the generation names them by. The tab is left out so the link
 * lands on Designs from the Use cases tab; the status is the pending queue unless told otherwise, and the URL is the state.
 */
export function designsSearchForCase(
  caseId: string,
  title: string,
  items: readonly Pick<BoardItem, "case_idea_id" | "use_case_id" | "proposed_case">[],
  status: StatusFilter = "pending",
): BoardSearch {
  const hit = items.find((i) => i.case_idea_id === caseId);
  const key = hit ? caseOf(hit).key : `new:${slug(title)}`;
  return { case: key, st: status === DEFAULT_FILTER.status ? undefined : status };
}

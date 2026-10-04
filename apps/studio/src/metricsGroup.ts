/**
 * How a Metrics group (per use case / per sport) is worded. No React, no DOM.
 *
 * measurement-honesty: the server sums only the publications that have a lifetime snapshot, so a group
 * with an unmeasured member (dry run, not pulled yet) is a LOWER BOUND, not a total, and a group with no
 * measured member has no number at all. Unmeasurable is not zero: it never renders as "0".
 */
import type { MetricsGroup } from "./api";
import { fmtNum } from "./display";

export type GroupFigure = {
  kind: "exact" | "lower_bound" | "unmeasured";
  /** the number cell: "1,200", "at least 1,200", or "—" */
  value: string;
  /** the line under it: the publication count, and what is missing from the number */
  detail: string;
  /** the whole claim in one phrase, for the accessible name: "at least 1,200 views · 2 of 3 measured" */
  summary: string;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function groupFigure(
  g: Pick<MetricsGroup, "publications" | "views" | "measured" | "unmeasured" | "lower_bound">,
): GroupFigure {
  const pubs = plural(g.publications, "publication", "publications");
  if (g.views === null || g.measured === 0) {
    return {
      kind: "unmeasured",
      value: fmtNum(null),
      detail: `${pubs} · no platform numbers`,
      summary: "no platform numbers",
    };
  }
  const measured = `${g.measured} of ${g.measured + g.unmeasured} measured`;
  if (g.lower_bound || g.unmeasured > 0) {
    return {
      kind: "lower_bound",
      value: `at least ${fmtNum(g.views)}`,
      detail: `${pubs} · ${measured}`,
      summary: `at least ${fmtNum(g.views)} views · ${measured}`,
    };
  }
  return { kind: "exact", value: fmtNum(g.views), detail: pubs, summary: `${fmtNum(g.views)} views` };
}

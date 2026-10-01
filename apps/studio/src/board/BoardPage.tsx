/**
 * Board (ADR 006): a huge grid of visual-only design outputs and use-case ideas behind the owner's
 * gate: Accept, Reject style, Reject case, Reject both (each with an optional note). Items come
 * from the `board` skill loops (GET /api/board); decisions go to POST /api/board/:id/decision and
 * are read back by the skill as feedback for its next loop.
 *
 * PROTOTYPE: three page variants behind the switcher (`?v=1|2|3`, default 1), sharing data,
 * filters, the detail body and the gate (shared.tsx):
 *   1 Wall        justified wall of every shot, lightbox detail with a sticky decision bar
 *   2 Light table one shot at a time on the loupe, the contact sheet as a filmstrip, fast triage
 *   3 Matrix      rows = styles, columns = use cases; feedback on an axis shows as a pattern
 * TODO(prototype, 2026-10-14): owner picks a variant; consolidate and delete the switcher + losers.
 *
 * Tabs (ADR 008, `?tab=designs|styles|cases`): Designs is the gate above; Styles the gallery of
 * accepted looks (lock / retire); Use cases the stories judged without art style, with the
 * case-loop inbox.
 */
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { BoardItem } from "../api";
import { Empty, Failure, Loading } from "../components/ui";
import {
  asStatusFilter,
  axisOptions,
  type BoardFilter,
  countItems,
  filterItems,
  NO_FILTER,
  parseVariant,
  STATUS_FILTERS,
  type StatusFilter,
  VARIANTS,
  type Variant,
} from "./board";
import { CasesView } from "./CasesView";
import { LightTableVariant } from "./LightTableVariant";
import { parseTab, type Tab, TABS } from "./library";
import { MatrixVariant } from "./MatrixVariant";
import { useBoard, useCaseNames } from "./shared";
import { StylesView } from "./StylesView";
import { WallVariant } from "./WallVariant";
import "./board.css";

export type VariantProps = {
  /** the items after the filters, newest first */
  items: BoardItem[];
  /** every item (for context such as "3 of 6") */
  all: BoardItem[];
  names: ReadonlyMap<string, string>;
};

const STATUS_WORD: Record<StatusFilter, string> = {
  all: "All",
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
};

function useVariant(): [Variant, (v: Variant) => void] {
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const navigate = useNavigate();
  const v = parseVariant(search.v);
  const set = (next: Variant) =>
    void navigate({ to: "/board", search: { ...search, v: next } as never, replace: true, resetScroll: false });
  return [v, set];
}

function useTab(): [Tab, (t: Tab) => void] {
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const navigate = useNavigate();
  const set = (next: Tab) =>
    void navigate({ to: "/board", search: { ...search, tab: next === "designs" ? undefined : next } as never, replace: true, resetScroll: false });
  return [parseTab(search.tab), set];
}

export function BoardPage() {
  const board = useBoard();
  const names = useCaseNames();
  const [variant, setVariant] = useVariant();
  const [tab, setTab] = useTab();
  const [filter, setFilter] = useState<BoardFilter>(NO_FILTER);
  const all = board.data?.items ?? [];
  const counts = useMemo(() => countItems(all), [all]);
  const items = useMemo(() => filterItems(all, filter), [all, filter]);
  const styleOpts = useMemo(() => axisOptions(all, "style", names), [all, names]);
  const caseOpts = useMemo(() => axisOptions(all, "case", names), [all, names]);
  const filtered = filter.status !== "all" || filter.style !== "all" || filter.case !== "all";
  const V = variant === 2 ? LightTableVariant : variant === 3 ? MatrixVariant : WallVariant;

  return (
    <main id="main" className={`page bd-page bd-page--v${variant}`}>
      <header className="page__head bd-head">
        <div>
          <p className="eyebrow">
            <i />
            Board · design outputs behind your gate
          </p>
          <h1 className="page__title display">What should StatReel look like</h1>
          <p className="page__sub">
            Cut-outs from 30-90 s data videos, each judged on two axes: the <b>style</b> (form of presentation) and the{" "}
            <b>case</b> (the story over time). Styles and Use cases keep what you accepted, so the next loops build on it.
          </p>
        </div>
        {tab === "designs" ? (
        <nav className="bd-switch" aria-label="Board prototype variant">
          <span className="label">Prototype · pick a page</span>
          <div className="bd-switch__opts">
            {VARIANTS.map((o) => (
              <button
                key={o.v}
                type="button"
                aria-pressed={variant === o.v}
                data-testid={`board-variant-${o.v}`}
                onClick={() => setVariant(o.v)}
              >
                <b>
                  <span className="num">{o.v}</span> {o.name}
                </b>
                <span>{o.sub}</span>
              </button>
            ))}
          </div>
        </nav>
        ) : null}
      </header>

      <nav className="bd-tabs" aria-label="Board sections">
        {TABS.map((o) => (
          <button
            key={o.tab}
            type="button"
            aria-pressed={tab === o.tab}
            data-testid={`board-tab-${o.tab}`}
            onClick={() => setTab(o.tab)}
          >
            <b>{o.name}</b>
            <span>{o.sub}</span>
          </button>
        ))}
      </nav>

      {tab === "styles" ? (
        <StylesView names={names} />
      ) : tab === "cases" ? (
        <CasesView />
      ) : board.isError ? (
        <Failure error={board.error} what="The board" />
      ) : board.isLoading ? (
        <Loading what="the board" />
      ) : (
        <>
          <section className="bd-strip" aria-label="Board counts">
            <dl className="bd-counts">
              <div className="bd-count bd-count--pending">
                <dt>Pending</dt>
                <dd className="num">{counts.pending}</dd>
              </div>
              <div className="bd-count bd-count--accepted">
                <dt>Accepted</dt>
                <dd className="num">{counts.accepted}</dd>
              </div>
              <div className="bd-count bd-count--rejected">
                <dt>Rejected</dt>
                <dd className="num">{counts.rejected}</dd>
                <dd className="bd-count__sub num">
                  style {counts.reject_style} · case {counts.reject_case} · both {counts.reject_both}
                </dd>
              </div>
              <div className="bd-count">
                <dt>Styles</dt>
                <dd className="num">{counts.styles}</dd>
              </div>
              <div className="bd-count">
                <dt>Cases</dt>
                <dd className="num">{counts.cases}</dd>
                <dd className="bd-count__sub num">
                  {counts.cases - counts.proposed} existing · {counts.proposed} proposed
                </dd>
              </div>
            </dl>
            <div className="bd-source">
              <p>
                Shots come from the <b>board</b> skill loops
                {counts.loops.length ? ` (${counts.loops.join(", ")})` : ""}. They are design outputs, not results:
                nothing here is published, and your decisions are its training signal.
              </p>
              <code className="mono">node .claude/skills/board/scripts/board.mjs loop|harvest|sync</code>
            </div>
          </section>

          {all.length ? (
            <div className="bd-filters">
              <fieldset className="seg seg--sm">
                <legend className="sr-only">Status</legend>
                {STATUS_FILTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={filter.status === s}
                    data-testid={`board-filter-${s}`}
                    onClick={() => setFilter((f) => ({ ...f, status: asStatusFilter(s) }))}
                  >
                    {STATUS_WORD[s]} <span className="num">{s === "all" ? counts.total : counts[s]}</span>
                  </button>
                ))}
              </fieldset>
              <label className="bd-sel">
                <span className="label">Style</span>
                <select value={filter.style} onChange={(e) => setFilter((f) => ({ ...f, style: e.target.value }))}>
                  <option value="all">All styles ({styleOpts.length})</option>
                  {styleOpts.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label} ({o.n})
                    </option>
                  ))}
                </select>
              </label>
              <label className="bd-sel">
                <span className="label">Case</span>
                <select value={filter.case} onChange={(e) => setFilter((f) => ({ ...f, case: e.target.value }))}>
                  <option value="all">All cases ({caseOpts.length})</option>
                  {caseOpts.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.proposed ? "Proposed · " : ""}
                      {o.label} ({o.n})
                    </option>
                  ))}
                </select>
              </label>
              {filtered ? (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFilter(NO_FILTER)}>
                  Clear filters
                </button>
              ) : null}
              <span className="bd-filters__n num" aria-live="polite">
                {items.length} of {all.length} shown
              </span>
            </div>
          ) : null}

          {!all.length ? (
            <Empty title="No shots on the board yet" className="bd-empty">
              The board is fed by the <b>board</b> skill. Run a loop, then harvest it: <br />
              <code className="mono">node .claude/skills/board/scripts/board.mjs loop --id loop-001</code>
              <br />
              <code className="mono">node .claude/skills/board/scripts/board.mjs harvest --id loop-001</code>
              <br />
              Each harvested shot lands here as pending. Nothing is shown until a real loop produced it.
            </Empty>
          ) : !items.length ? (
            <Empty title="Nothing matches these filters" className="bd-empty">
              {all.length} shots exist on the board.{" "}
              <button type="button" className="bd-linkbtn" onClick={() => setFilter(NO_FILTER)}>
                Show every shot
              </button>
            </Empty>
          ) : (
            <V items={items} all={all} names={names} />
          )}
        </>
      )}
    </main>
  );
}

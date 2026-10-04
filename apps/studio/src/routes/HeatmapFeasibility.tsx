/**
 * Heatmap, Feasibility view (the default Topics view is HeatmapTopics.tsx). Layer 1: the grid alone, full height. Use case x sport in the current mode, each cell a
 * status as shape + label (the literal word is text: GO / DATA READY / ASK / BLOCKED), legend with
 * counts, per-format GO trend, snapshot age + Recompute. Opening a cell (click, Enter) records its
 * rect and routes to layer 2 (/heatmap/$usecase/$sport), which expands from it over the grid;
 * closing returns here with that cell focused. Keyboard: arrows / Home / End move, Enter opens,
 * M flips the mode, Esc closes layer 2.
 * The grid is the Photo Finish finish sheet (ADR 009): four heats as columns, ten lanes as rows,
 * a bar per cell toward the line.
 */
import type { CellStatus, HeatmapCell, Mode, Sport, UseCase } from "@statreel/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Outlet, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, qk } from "../api";
import { Defer } from "../components/arrive";
import { ViewSwitch } from "../components/HeatmapViews";
import { LaneBar, ModeSwitch } from "../components/finish";
import { FormatIcon, StatusChip } from "../components/glyphs";
import { identVar } from "../components/idents";
import { setLayerOrigin } from "../components/layerTransition";
import { artStyle, Failure, Loading, Sparkline } from "../components/ui";
import { useHeatmap, useSources } from "../data";
import { LINE, REACH } from "../finishline";
import { blockedBreakdown, blockedLegend, cellHint, focusKey, gridMove, parseFocus, sportCounts } from "../heatmap";
import { cellOf, countStatuses, MODE_LABEL, relTime, SPORTS, trendSeries } from "../logic";
import { formatLabel, pad2, STATUS_ORDER, STATUS_WORD, trendSummary } from "../display";
import type { HeatmapSearch } from "../router";

type OpenCell = (uc: UseCase, sport: Sport, el: HTMLElement) => void;
type GridProps = {
  usecases: UseCase[];
  cells: HeatmapCell[];
  mode: Mode;
  trend: { at: string; go: Record<string, number> }[];
  cur: string;
  selected: string | null;
  changed: Set<string>;
  onOpen: OpenCell;
  onFocusCell: (key: string) => void;
  register: (key: string, el: HTMLButtonElement | null) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
};

export function HeatmapFeasibility() {
  const search = useSearch({ from: "/heatmap" }) as HeatmapSearch;
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { usecase?: string; sport?: string };
  const open = !!(params.usecase && params.sport);
  const mode: Mode = search.mode ?? "monetized";
  const hm = useHeatmap();
  const src = useSources();
  const qc = useQueryClient();
  const recompute = useMutation({
    mutationFn: api.recomputeHeatmap,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.heatmap }),
  });

  const usecases = hm.data?.usecases ?? [];
  const cells = hm.data?.cells ?? [];
  const trend = hm.data?.trend ?? [];

  const setMode = (m: Mode) =>
    void navigate({
      to: ".",
      search: (s: HeatmapSearch) => ({ ...s, mode: m }),
      replace: true,
      resetScroll: false,
    } as never);

  // roving focus: the focus param wins (a closed layer names its cell), else era-adjusted x F1
  const fallback = focusKey(usecases.find((u) => u.id === "era-adjusted-rankings")?.id ?? usecases[0]?.id ?? "", "F1");
  const [cur, setCur] = useState<string | null>(null);
  const current = cur ?? (parseFocus(search.focus, usecases) ? (search.focus as string) : fallback);
  const selected = open ? focusKey(params.usecase as string, params.sport as string) : null;

  const refs = useRef(new Map<string, HTMLButtonElement>());
  const register = (key: string, el: HTMLButtonElement | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  };

  // back from layer 2 (or a deep link with ?focus=): focus that cell on the grid
  const wasOpen = useRef(open);
  const loaded = !!hm.data;
  useEffect(() => {
    const closedNow = wasOpen.current && !open;
    wasOpen.current = open;
    if (open || !loaded) return;
    const f = parseFocus(search.focus, usecases);
    if (!f) return;
    const key = focusKey(f.uc, f.sport);
    setCur(key);
    const el = refs.current.get(key);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (closedNow) {
      el.classList.remove("is-back");
      void el.offsetWidth;
      el.classList.add("is-back");
    }
  }, [open, loaded, search.focus, usecases]);

  // A/1 flip: cells whose status changed since the last render in this mode
  const prev = useRef<Map<string, CellStatus>>(new Map());
  const changed = useMemo(() => {
    const out = new Set<string>();
    for (const c of cells) {
      if (c.mode !== mode) continue;
      const k = focusKey(c.usecase, c.sport);
      const was = prev.current.get(k);
      if (was && was !== c.status) out.add(k);
    }
    return out;
  }, [cells, mode]);
  useEffect(() => {
    const m = new Map<string, CellStatus>();
    for (const c of cells) if (c.mode === mode) m.set(focusKey(c.usecase, c.sport), c.status);
    prev.current = m;
  });

  const onOpen: OpenCell = (uc, sport, el) => {
    setCur(focusKey(uc.id, sport));
    setLayerOrigin(focusKey(uc.id, sport), el);
    void navigate({
      to: "/heatmap/$usecase/$sport",
      params: { usecase: uc.id, sport },
      search: { mode },
      resetScroll: false,
    });
  };

  const rows = usecases.length;
  const cols = SPORTS.length;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (!el) return;
    const next = gridMove(Number(el.dataset.r), Number(el.dataset.c), e.key, rows, cols);
    if (!next) return;
    e.preventDefault();
    const target = e.currentTarget.querySelector<HTMLButtonElement>(`[data-r="${next[0]}"][data-c="${next[1]}"]`);
    if (target) {
      setCur(target.dataset.key ?? null);
      target.focus();
    }
  };

  // M flips the mode (not while typing)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setMode(mode === "monetized" ? "non_commercial" : "monetized");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const n = countStatuses(cells, mode);
  const per = usecases.length * SPORTS.length;
  const why = blockedLegend(blockedBreakdown(cells, mode));
  const lastSnap = trend.at(-1)?.at;
  const caps = src.data?.capabilities ?? [];

  const gridProps: GridProps = {
    usecases,
    cells,
    mode,
    trend,
    cur: current,
    selected,
    changed,
    onOpen,
    onFocusCell: setCur,
    register,
    onKeyDown,
  };

  return (
    <main id="main" className="hm hm--photofinish" data-layer={open ? "2" : "1"}>
      <div className="hm-layer1" inert={open}>
        <header className="hm-head">
          <div className="hm-title">
            <p className="eyebrow">
              {`The finish sheet · ${SPORTS.length} heats × ${usecases.length || "—"} lanes`}
            </p>
            <h1>What can cross the line</h1>
          </div>
          <ul className="hm-legend" aria-label={`Status counts, ${MODE_LABEL[mode]}`}>
            {STATUS_ORDER.map((k) => (
              <li key={k} className={`st--${k}${n[k] ? "" : " is-zero"}${k === "blocked" && why ? " has-why" : ""}`}>
                <span className="hm-legend__n num">{n[k]}</span>
                <StatusChip status={k} size={14} />
                <small>{n[k] ? `of ${per}` : "none"}</small>
                {k === "blocked" && why ? (
                  <span className="hm-legend__why num" data-testid="legend-blocked-why">
                    {why}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="hm-ctl">
            <ViewSwitch view="feasibility" />
            <ModeSwitch mode={mode} onChange={setMode} label="Line at" testid />
            <span className="hm-ctl__k">
              <kbd>M</kbd> flips the mode
            </span>
          </div>
        </header>
        {recompute.isError ? (
          <p className="hm-msg" role="alert">
            Recompute failed: {errorText(recompute.error)}
          </p>
        ) : null}

        {hm.isError ? (
          <div className="hm-state">
            <Failure error={hm.error} what="The heatmap" onRetry={() => void hm.refetch()} retrying={hm.isFetching} />
          </div>
        ) : hm.isLoading ? (
          <div className="hm-state">
            <Loading what="the heatmap" />
          </div>
        ) : !usecases.length ? (
          <div className="hm-state">
            <div className="empty">
              <b>No use cases</b>
              data/registry/usecases holds no use case, so there is nothing to grid.
            </div>
          </div>
        ) : (
          <div className="hm-wrap card-surface"><FinishSheet {...gridProps} /></div>
        )}

        <Defer tier={1} id="hm:foot" phClass="hm-foot" minHeight={48}>
          <p className="hm-foot">
            <span>
              <kbd>Arrows</kbd> move
            </span>
            <span>
              <kbd>Enter</kbd> open a cell
            </span>
            <span>
              <kbd>Esc</kbd> back to the grid
            </span>
            <span>
              Basis: tested capabilities ({caps.filter((c) => c.status === "pass").length} pass of {caps.length}) ×
              registry × built compositions · {trend.length} snapshot{trend.length === 1 ? "" : "s"}
            </span>
            <span className="hm-snap">
              <span>{lastSnap ? `Snapshot ${relTime(lastSnap)}` : "No snapshot yet"}</span>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => recompute.mutate()}
                disabled={recompute.isPending}
              >
                {recompute.isPending ? "Recomputing" : "Recompute"}
              </button>
            </span>
          </p>
        </Defer>
      </div>
      <Outlet />
    </main>
  );
}

// ------------------------------------------------------------------ shared cell pieces

function trendOf(trend: GridProps["trend"], id: string, mode: Mode) {
  const series = trendSeries(trend, id, mode);
  return { series, t: trendSummary(series) };
}

function TrendLine({ series, t, w = 40 }: { series: number[]; t: ReturnType<typeof trendSummary>; w?: number }) {
  return (
    <span className="hm-trend">
      <Sparkline
        values={series}
        w={w}
        h={14}
        label={`Go count over ${t.snapshots} snapshots`}
        className="spark spark--tiny"
      />
      <span className="num">
        go {t.now}/{SPORTS.length}
        {t.delta === null ? "" : t.delta === 0 ? " · =" : ` · ${t.delta > 0 ? "+" : ""}${t.delta}`}
      </span>
    </span>
  );
}

function cellLabel(u: UseCase, sport: string, mode: Mode, c: HeatmapCell): string {
  return `${u.name}, ${sport}, ${MODE_LABEL[mode]}: ${STATUS_WORD[c.status]}. ${c.reason}. Open the cell.`;
}

// ------------------------------------------------------------------ Photo Finish: the finish sheet

function FinishSheet({ usecases, cells, mode, trend, cur, selected, onOpen, onFocusCell, register, onKeyDown }: GridProps) {
  return (
    <div
      className="pf-heats"
      role="grid"
      aria-label={`Feasibility: ${usecases.length} use cases by ${SPORTS.length} sports, ${MODE_LABEL[mode]}`}
      onKeyDown={onKeyDown}
      style={{ ["--line" as string]: `${LINE[mode]}%`, ["--lanes" as string]: usecases.length }}
    >
      <div className="pf-heats__head" role="row">
        <div className="pf-corner" role="columnheader">
          <span className="eyebrow">Lane · use case</span>
        </div>
        {SPORTS.map((sp, si) => {
          const k = sportCounts(cells, mode, sp);
          const parts = STATUS_ORDER.filter((s) => k[s]).map((s) => `${k[s]} ${STATUS_WORD[s].toLowerCase()}`);
          return (
            <div className={`pf-heat${cur.endsWith(`|${sp}`) ? " hot" : ""}`} role="columnheader" key={sp}>
              <div className="pf-heat__title">
                <span className="eyebrow">Heat {si + 1}</span>
                <b>{sp}</b>
                <span className="pf-heat__count">{parts.join(" · ") || "no cells"}</span>
              </div>
              <div className="pf-scale" aria-hidden="true">
                <span style={{ left: `${REACH.paid}%` }}>paid</span>
                <span style={{ left: `${REACH.non_commercial}%` }}>nc</span>
                <span style={{ left: `${REACH.legal}%` }}>legal</span>
                <i />
              </div>
            </div>
          );
        })}
      </div>
      {usecases.map((u, ui) => {
        const { series, t } = trendOf(trend, u.id, mode);
        const hot = cur.startsWith(`${u.id}|`) || selected?.startsWith(`${u.id}|`);
        return (
          <div className={`pf-row${hot ? " is-row" : ""}`} role="row" key={u.id} style={artStyle(identVar(u.id))}>
            <div className="pf-rowhead" role="rowheader">
              <span className="pf-rowhead__no num">{pad2(ui + 1)}</span>
              <span className="pf-rowhead__bar" aria-hidden="true" />
              <span className="pf-rowhead__text">
                <span className="pf-rowhead__name">{u.name}</span>
                <span className="pf-rowhead__meta">
                  <span className="pf-rowhead__kinds">{u.requires.kinds.join("+")}</span>
                  <TrendLine series={series} t={t} w={32} />
                </span>
              </span>
              <span className="pf-rowhead__fmt" role="img" aria-label={`default format ${formatLabel(u.default_format)}`}>
                <FormatIcon format={u.default_format} h={14} />
              </span>
            </div>
            {SPORTS.map((sp, si) => {
              const c = cellOf(cells, u.id, sp, mode);
              const key = focusKey(u.id, sp);
              if (!c)
                return (
                  <div key={sp} className="pf-hc pf-hc--none" role="gridcell">
                    no cell
                  </div>
                );
              return (
                <button
                  type="button"
                  key={sp}
                  ref={(el) => register(key, el)}
                  role="gridcell"
                  data-testid={`cell-${u.id}-${sp}`}
                  data-r={ui}
                  data-c={si}
                  data-key={key}
                  data-status={c.status}
                  tabIndex={cur === key ? 0 : -1}
                  aria-selected={selected === key}
                  aria-label={cellLabel(u, sp, mode, c)}
                  className="pf-hc"
                  onFocus={() => onFocusCell(key)}
                  onClick={(e) => onOpen(u, sp, e.currentTarget)}
                >
                  <span className="pf-hc__track">
                    <LaneBar cell={c} status={c.status} />
                  </span>
                  <span className={`pf-hc__label st--${c.status}`}>
                    <b>{STATUS_WORD[c.status]}</b>
                    <small>{cellHint(c)}</small>
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

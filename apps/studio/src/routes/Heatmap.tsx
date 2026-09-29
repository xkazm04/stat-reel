/**
 * Heatmap (A/3): MODE switch; BUSES (supply) above MATRIX (demand) on the same 4 sport columns;
 * a scope for the selected cell/bus with the decision aid when idle. Keyboard: arrows move
 * between cells, Enter opens, Esc closes.
 */
import type { CellStatus, HeatmapCell, Mode, UseCase } from "@statreel/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type ProjectWithJobs, qk, type SourcesResponse } from "../api";
import { FormatGlyph, Jack, JackSvg, KindPin, Led, Screws, Sparkline } from "../components/glyphs";
import { ErrorState, Loading, Toggle } from "../components/ui";
import {
  type AidEntry,
  allowedIn,
  type BusState,
  busState,
  CELL_STATUSES,
  cellOf,
  countStatuses,
  decisionAid,
  KIND_NAMES,
  KINDS,
  LICENCE_META,
  MODE_LABEL,
  SPORTS,
  STAGE_LABEL,
  STATUS_META,
  sourceLed,
  trendSeries,
  unlockCounts,
} from "../logic";

type Sel = { type: "cell"; u: string; sport: string } | { type: "bus"; kind: string; sport: string } | null;

const parseCell = (s: string | undefined): Sel => {
  if (!s) return null;
  const [u, sport] = s.split("|");
  return u && sport ? { type: "cell", u, sport } : null;
};

function busLabel(b: BusState): { text: string; cls: string } {
  switch (b.state) {
    case "ok":
      return { text: `${LICENCE_META[b.best].label} ×${b.allowedCount}`, cls: "ok" };
    case "capped":
      return {
        text: b.best === "non_commercial" ? "NC only" : b.best === "paid" ? "paid only" : "capped",
        cls: "capped",
      };
    case "untested":
      return { text: "untested", cls: "untested" };
    case "failing":
      return { text: "test fails", cls: "none" };
    default:
      return { text: "no source", cls: "none" };
  }
}

export function HeatmapPage() {
  const search = useSearch({ from: "/heatmap" });
  const navigate = useNavigate({ from: "/heatmap" });
  const qc = useQueryClient();
  const mode: Mode = search.mode ?? "monetized";
  const [sel, setSel] = useState<Sel>(() => parseCell(search.cell));
  const trigger = useRef<HTMLElement | null>(null);
  const scopeRef = useRef<HTMLDivElement>(null);

  const heat = useQuery({ queryKey: qk.heatmap, queryFn: api.heatmap });
  const src = useQuery({ queryKey: qk.sources, queryFn: api.sources });
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.projects });
  const recompute = useMutation({
    mutationFn: api.recomputeHeatmap,
    onSuccess: (r) => {
      qc.setQueryData(qk.heatmap, (old: typeof heat.data) => (old ? { ...old, cells: r.cells } : old));
      void qc.invalidateQueries({ queryKey: qk.heatmap });
    },
  });

  const cells = heat.data?.cells ?? [];
  const usecases = heat.data?.usecases ?? [];
  const counts = countStatuses(cells, mode);
  const aid = useMemo(() => decisionAid(cells, mode), [cells, mode]);
  const unlocks = useMemo(() => unlockCounts(aid), [aid]);

  const setMode = (m: Mode) => void navigate({ search: (s) => ({ ...s, mode: m }), replace: true });
  const select = (next: Sel, el?: HTMLElement | null) => {
    if (el) trigger.current = el;
    setSel(next);
    void navigate({
      search: (s) => ({ ...s, cell: next?.type === "cell" ? `${next.u}|${next.sport}` : undefined }),
      replace: true,
    });
  };
  const clear = () => {
    select(null);
    const t = trigger.current;
    if (t && document.contains(t)) t.focus();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !sel) return;
      e.preventDefault();
      clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onGridKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    const isSock = t.classList.contains("sock");
    if (!isSock && !t.classList.contains("bus")) return;
    const dr = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    const dc = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!dr && !dc) return;
    e.preventDefault();
    const r = Number(t.dataset.r) + dr;
    const c = Math.max(0, Math.min(3, Number(t.dataset.c) + dc));
    const nrows = isSock ? usecases.length : KINDS.length;
    let next: HTMLElement | null;
    if (isSock && r < 0) next = document.querySelector(`.bus[data-r="${KINDS.length - 1}"][data-c="${c}"]`);
    else if (!isSock && r >= nrows) next = document.querySelector(`.sock[data-r="0"][data-c="${c}"]`);
    else
      next = document.querySelector(
        `${isSock ? ".sock" : ".bus"}[data-r="${Math.max(0, Math.min(nrows - 1, r))}"][data-c="${c}"]`,
      );
    next?.focus();
  };

  // highlights
  const hl = useMemo(() => {
    const cellsHl = new Set<string>();
    const busHl = new Set<string>();
    const rowHl = new Set<string>();
    const kindHl = new Set<string>();
    if (sel?.type === "cell") {
      rowHl.add(sel.u);
      const uc = usecases.find((u) => u.id === sel.u);
      for (const k of uc?.requires.kinds ?? []) {
        busHl.add(`${k}|${sel.sport}`);
        kindHl.add(k);
      }
    } else if (sel?.type === "bus") {
      kindHl.add(sel.kind);
      for (const u of usecases)
        if ((u.requires.kinds as string[]).includes(sel.kind)) {
          cellsHl.add(`${u.id}|${sel.sport}`);
          rowHl.add(u.id);
        }
    }
    return { cellsHl, busHl, rowHl, kindHl };
  }, [sel, usecases]);

  const projectsIn = (u: string, sport: string) =>
    (projects.data?.projects ?? []).filter((p) => p.use_case_id === u && p.sport === sport);

  return (
    <main id="main" className="page heatmap-page">
      <div className="module controls">
        <Screws at={["tl", "br"]} />
        <div className="title">
          <h1>Heatmap</h1>
          <span>supply ⇄ demand · {usecases.length * SPORTS.length || "—"} cells per mode</span>
        </div>
        <Toggle
          title="Mode"
          label="Gate mode"
          value={mode}
          onChange={setMode}
          testIdPrefix="mode-"
          options={[
            { value: "monetized", label: "Monetized" },
            { value: "non_commercial", label: "Non-commercial" },
          ]}
        />
        <p className="rule">
          <b>{MODE_LABEL[mode]}</b>: {mode === "monetized" ? "legal sources only" : "legal + non-commercial sources"}
        </p>
        <button
          type="button"
          className="key small"
          onClick={() => recompute.mutate()}
          disabled={recompute.isPending}
          data-testid="recompute"
        >
          {recompute.isPending ? "Recomputing…" : "↻ Recompute"}
        </button>
        {recompute.isError ? <span className="mono err">{errorText(recompute.error)}</span> : null}
        <div className="display legend-strip" aria-live="polite">
          {CELL_STATUSES.map((s) => (
            <div className="lg" key={s}>
              <span className="display-num">{heat.data ? counts[s] : "—"}</span>
              <Led status={s} />
            </div>
          ))}
        </div>
      </div>

      {heat.isError ? (
        <ErrorState error={heat.error} what="Heatmap" />
      ) : heat.isLoading ? (
        <Loading what="Reading the heatmap…" />
      ) : (
        <div className="work">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow-key roving between grid buttons */}
          <div className={`field${sel ? " dim" : ""}`} onKeyDown={onGridKey}>
            <section className="module bank" aria-labelledby="bus-title">
              <Screws at={["tl", "tr"]} />
              <div className="grid">
                <div className="bank-title">
                  <h2 id="bus-title">Buses · supply</h2>
                  <span>{mode === "monetized" ? "tested legal jacks" : "tested legal + NC jacks"}</span>
                </div>
                {SPORTS.map((s) => (
                  <div key={s} className="colhead">
                    {s}
                  </div>
                ))}
                {KINDS.map((k, r) => {
                  const used = usecases.some((u) => (u.requires.kinds as string[]).includes(k));
                  return (
                    <div className="busrow" key={k}>
                      <div className={`rowlab${hl.kindHl.has(k) ? " hl" : ""}`}>
                        {k} <small>{KIND_NAMES[k]}</small>
                        {used ? null : <span className="unused">unused</span>}
                      </div>
                      {SPORTS.map((s, c) => {
                        const b = src.data
                          ? busState(src.data.capabilities, src.data.sources, k, s, mode)
                          : ({ state: "none" } as BusState);
                        const lab = busLabel(b);
                        const unl = unlocks.get(`${k}|${s}`) ?? 0;
                        const jack =
                          b.state === "ok" || b.state === "capped" || b.state === "untested" ? b.best : "avoid";
                        const pressed = sel?.type === "bus" && sel.kind === k && sel.sport === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            className={`bus ${lab.cls}${hl.busHl.has(`${k}|${s}`) ? " hl" : ""}`}
                            data-r={r}
                            data-c={c}
                            aria-pressed={pressed}
                            data-testid={`bus-${k}-${s}`}
                            aria-label={`${k} bus for ${s}: ${lab.text}${unl ? `, one legal source unlocks ${unl} cells` : ""}`}
                            onClick={(e) => select({ type: "bus", kind: k, sport: s }, e.currentTarget)}
                          >
                            <span className={`lic-${jack} bus-jack`}>
                              <JackSvg cls={jack} />
                            </span>
                            <span className="cls">{lab.text}</span>
                            {unl ? <span className="unl">+{unl}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </section>
            <div className="feeds" aria-hidden="true">
              feeds
            </div>
            <section className="module bank" aria-labelledby="mx-title">
              <Screws at={["tl", "tr"]} />
              <div className="grid">
                <div className="ucrow">
                  <div className="bank-title">
                    <h2 id="mx-title">Matrix · demand</h2>
                  </div>
                  {SPORTS.map((s) => (
                    <div key={s} className="colhead">
                      {s}
                    </div>
                  ))}
                </div>
                {usecases.map((u, r) => (
                  <MatrixRow
                    key={u.id}
                    u={u}
                    r={r}
                    mode={mode}
                    cells={cells}
                    trend={trendSeries(heat.data?.trend ?? [], u.id, mode)}
                    rowHl={hl.rowHl.has(u.id)}
                    cellHl={hl.cellsHl}
                    sel={sel}
                    projectsIn={projectsIn}
                    onSelect={(sport, el) => {
                      select({ type: "cell", u: u.id, sport }, el);
                      requestAnimationFrame(() => scopeRef.current?.scrollTo({ top: 0 }));
                    }}
                  />
                ))}
              </div>
            </section>
          </div>

          <aside className="module scope" aria-labelledby="scope-h" data-testid="scope">
            <Screws at={["tr", "br"]} />
            <div className="scope-head">
              <h2 id="scope-h">Scope</h2>
              <span className="crumbs">
                {sel?.type === "cell"
                  ? `Heatmap › ${usecases.find((u) => u.id === sel.u)?.name ?? sel.u} › ${sel.sport} · ${MODE_LABEL[mode]}`
                  : sel?.type === "bus"
                    ? `Heatmap › bus › ${sel.kind} × ${sel.sport}`
                    : "Heatmap · nothing selected"}
              </span>
              {sel ? (
                <button type="button" className="key small" onClick={clear} data-testid="scope-close">
                  Esc · close
                </button>
              ) : null}
            </div>
            <div className="scope-body" ref={scopeRef} aria-live="polite">
              {sel?.type === "cell" ? (
                <CellScope
                  key={`${sel.u}|${sel.sport}|${mode}`}
                  u={usecases.find((x) => x.id === sel.u)}
                  cell={cellOf(cells, sel.u, sel.sport, mode)}
                  other={cellOf(cells, sel.u, sel.sport, mode === "monetized" ? "non_commercial" : "monetized")}
                  mode={mode}
                  trend={trendSeries(heat.data?.trend ?? [], sel.u, mode)}
                  projects={projectsIn(sel.u, sel.sport)}
                />
              ) : sel?.type === "bus" ? (
                <BusScope
                  kind={sel.kind}
                  sport={sel.sport}
                  mode={mode}
                  data={src.data}
                  aid={aid}
                  usecases={usecases}
                  onCell={(u, sport) => select({ type: "cell", u, sport })}
                />
              ) : (
                <IdleScope
                  aid={aid}
                  mode={mode}
                  counts={counts}
                  total={usecases.length * SPORTS.length}
                  onBus={(k, s) => select({ type: "bus", kind: k, sport: s })}
                  cells={cells}
                  usecases={usecases}
                  onCell={(u, s) => select({ type: "cell", u, sport: s })}
                />
              )}
            </div>
            <div className="honesty">
              <span>
                basis: {src.data ? `${src.data.capabilities.length} capability tests on record` : "capabilities —"}
              </span>
              <span>GO needs a tested allowed source and a built composition</span>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

function MatrixRow({
  u,
  r,
  mode,
  cells,
  trend,
  rowHl,
  cellHl,
  sel,
  projectsIn,
  onSelect,
}: {
  u: UseCase;
  r: number;
  mode: Mode;
  cells: HeatmapCell[];
  trend: number[];
  rowHl: boolean;
  cellHl: Set<string>;
  sel: Sel;
  projectsIn: (u: string, sport: string) => ProjectWithJobs[];
  onSelect: (sport: string, el: HTMLElement) => void;
}) {
  const goNow = trend.at(-1);
  const delta = trend.length > 1 ? (trend.at(-1) ?? 0) - (trend[0] ?? 0) : 0;
  return (
    <div className="ucrow">
      <div className={`rowlab${rowHl ? " hl" : ""}`}>
        <span className="nm">{u.name}</span>
        <span className="pins">
          {u.requires.kinds.map((k) => (
            <KindPin key={k} kind={k} />
          ))}
        </span>
        <FormatGlyph format={u.default_format} />
        {trend.length ? (
          <span className="trend">
            <Sparkline values={trend} label={`GO cells over ${trend.length} snapshots`} />
            <span className="mono">
              GO {goNow ?? 0}
              {trend.length > 1 ? ` · Δ${delta >= 0 ? "+" : ""}${delta}` : ""}
            </span>
          </span>
        ) : null}
      </div>
      {SPORTS.map((s, c) => {
        const cell = cellOf(cells, u.id, s, mode);
        const st: CellStatus = cell?.status ?? "blocked";
        const n = projectsIn(u.id, s).length;
        const pressed = sel?.type === "cell" && sel.u === u.id && sel.sport === s;
        return (
          <button
            key={s}
            type="button"
            className={`sock on-display st-${st}-cell${cellHl.has(`${u.id}|${s}`) ? " hl" : ""}`}
            data-r={r}
            data-c={c}
            data-testid={`cell-${u.id}-${s}`}
            aria-pressed={pressed}
            aria-label={`${u.name}, ${s}: ${STATUS_META[st].word}${n ? `, ${n} project${n > 1 ? "s" : ""}` : ""}. Enter opens the scope.`}
            onClick={(e) => onSelect(s, e.currentTarget)}
          >
            <Led status={st} />
            {n ? <span className="proj">▮{n} proj</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function CellScope({
  u,
  cell,
  other,
  mode,
  trend,
  projects,
}: {
  u: UseCase | undefined;
  cell: HeatmapCell | undefined;
  other: HeatmapCell | undefined;
  mode: Mode;
  trend: number[];
  projects: ProjectWithJobs[];
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => {
      if (!u || !cell) throw new Error("no cell");
      return api.createProject({
        title: `${u.name} · ${cell.sport}`,
        use_case_id: u.id,
        sport: cell.sport,
        format: u.default_format,
        mode,
      });
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: qk.projects });
      void navigate({ to: "/studio/$projectId", params: { projectId: p.id } });
    },
  });
  if (!u || !cell) return <p className="reason">No heatmap cell for this selection.</p>;
  const st = cell.status;
  return (
    <>
      <div className="scope-title">
        <div className="display bigled">
          <Led status={st} />
          <span className="mono">{MODE_LABEL[mode].toLowerCase()}</span>
        </div>
        <div>
          <h3>
            {u.name} · {cell.sport}
          </h3>
          <div className="sub">
            {MODE_LABEL[mode]} mode · default {u.default_format === "vertical" ? "9:16 short" : "16:9 explainer"} · pins{" "}
            {u.requires.kinds.join(" + ")}
          </div>
        </div>
      </div>
      <p className="legend reason-label">Reason (verbatim)</p>
      <p className="reason" data-testid="cell-reason">
        {cell.reason}
      </p>
      {cell.kinds.map((k) => {
        const ok = allowedIn(mode, k.best);
        return (
          <div className="kblock" key={k.kind}>
            <h4>
              <Led status={ok ? "pass" : "refuse"} label={ok ? "PATCHED" : "NOT PATCHABLE"} />
              {k.kind}
              <span className="kmeta">
                {KIND_NAMES[k.kind as keyof typeof KIND_NAMES] ?? k.kind} · {k.tested ? "tested" : "not tested"}
              </span>
            </h4>
            <div className="best">
              <span className="best-lab legend silk-muted">Best tested licence</span>
              {k.best ? <Jack cls={k.best} /> : <span className="mono">no passing source</span>}
              {k.best && !ok ? (
                <span className="mono bad">best available, not allowed in {MODE_LABEL[mode].toLowerCase()} mode</span>
              ) : null}
            </div>
            {k.sources.length ? (
              <ul className="srclist">
                {k.sources.map((s) => (
                  <li key={s.id}>
                    <Jack cls={s.license_class} id={s.id} />
                    <Led status={sourceLed(s.status)} label={s.status.replace(/_/g, " ").toUpperCase()} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mono muted">
                No registry source declares {k.kind} for {cell.sport}.
              </p>
            )}
          </div>
        );
      })}
      <dl className="facts">
        <dt>{MODE_LABEL[mode === "monetized" ? "non_commercial" : "monetized"]}</dt>
        <dd>{other ? <Led status={other.status} /> : "—"}</dd>
        <dt>Composition</dt>
        <dd>
          {u.composition ? <span className="mono">{u.composition}</span> : "not designed yet"} ·{" "}
          {cell.composition_implemented ? "implemented" : "not implemented"}
        </dd>
        <dt>Trend</dt>
        <dd>
          {trend.length ? (
            <span className="trend">
              <Sparkline values={trend} label="GO sports for this use case over snapshots" />
              <span className="mono">
                {trend.length} snapshot{trend.length === 1 ? "" : "s"} · GO sports now {trend.at(-1)}
              </span>
            </span>
          ) : (
            "no snapshots yet"
          )}
        </dd>
        <dt>Projects</dt>
        <dd>
          {projects.length ? (
            <div className="projlinks">
              {projects.map((p) => (
                <Link key={p.id} to="/studio/$projectId" params={{ projectId: p.id }}>
                  <span className="mono">{p.id}</span>
                  {p.title}
                  <span className="mono">
                    · {STAGE_LABEL[p.status] ?? p.status}
                    {p.mode !== mode ? ` · ${MODE_LABEL[p.mode as Mode] ?? p.mode}` : ""}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <span className="muted">none yet in this cell</span>
          )}
        </dd>
      </dl>
      <div className="scope-foot">
        <button
          type="button"
          className="key primary"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          data-testid="create-project"
        >
          {create.isPending ? "Creating…" : "Create project → studio"}
        </button>
        {st === "ask" || st === "blocked" ? (
          <p className="mono warn">
            <Led status={st} /> starts as an idea; the publish gate will refuse {MODE_LABEL[mode].toLowerCase()}{" "}
            publishing until this cell is fixed
          </p>
        ) : st === "data-ready" ? (
          <p className="mono warn">
            <Led status="data-ready" /> data is allowed but the composition is not implemented: the studio shows a
            placeholder
          </p>
        ) : null}
        {create.isError ? (
          <p className="mono err" role="alert">
            {errorText(create.error)}
          </p>
        ) : null}
      </div>
    </>
  );
}

function BusScope({
  kind,
  sport,
  mode,
  data,
  aid,
  usecases,
  onCell,
}: {
  kind: string;
  sport: string;
  mode: Mode;
  data: SourcesResponse | undefined;
  aid: AidEntry[];
  usecases: UseCase[];
  onCell: (u: string, sport: string) => void;
}) {
  if (!data) return <Loading what="Reading the registry…" />;
  const b = busState(data.capabilities, data.sources, kind, sport, mode);
  const entry = aid.find((a) => a.kind === kind && a.sport === sport);
  const declared = data.sources.filter(
    (s) => (s.sport === sport || s.sport === "all") && (s.kinds as string[]).includes(kind),
  );
  const partial = data.sources.filter(
    (s) => (s.sport === sport || s.sport === "all") && ((s.partial_kinds ?? []) as string[]).includes(kind),
  );
  const caps = data.capabilities.filter((c) => c.sport === sport && c.kind === kind);
  const lab = busLabel(b);
  return (
    <>
      <div className="scope-title">
        <div className="display bigled">
          <span className={`display-num${entry ? " accent" : ""}`}>{entry?.flips.length ?? 0}</span>
          <span className="mono">unlocks</span>
        </div>
        <div>
          <h3>
            {kind} bus · {sport}
          </h3>
          <div className="sub">
            {KIND_NAMES[kind as keyof typeof KIND_NAMES] ?? kind} data · {lab.text} in {MODE_LABEL[mode].toLowerCase()}{" "}
            mode
          </div>
        </div>
      </div>
      <p className="reason">
        {entry
          ? `One legal, tested ${kind} source for ${sport} would flip ${entry.flips.length} cell${entry.flips.length > 1 ? "s" : ""} in ${MODE_LABEL[mode].toLowerCase()} mode.`
          : "No cell waits on this bus alone in this mode."}
      </p>
      {entry ? (
        <div className="celllist">
          {entry.flips.map((c) => (
            <button key={c.usecase} type="button" onClick={() => onCell(c.usecase, c.sport)}>
              <Led status={c.status} hideLabel />
              {usecases.find((u) => u.id === c.usecase)?.name ?? c.usecase}
            </button>
          ))}
        </div>
      ) : null}
      <div className="kblock">
        <h4>Capability tests on this bus</h4>
        {caps.length ? (
          <ul className="srclist">
            {caps.map((c) => (
              <li key={c.source_id}>
                <Jack cls={c.license_class} id={c.source_id} />
                <Led status={c.status === "pass" ? "pass" : "fail"} />
                <span className="mono muted">
                  {c.coverage_from ?? "?"}–{c.coverage_to ?? "?"} · {c.rows.toLocaleString("en-US")} rows
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mono muted">
            No capability test has run for {kind} × {sport}.
          </p>
        )}
      </div>
      <div className="kblock">
        <h4>Declared in the registry</h4>
        {declared.length ? (
          <ul className="srclist">
            {declared.map((s) => (
              <li key={s.id}>
                <Jack cls={s.verdict} id={s.id} strike={s.verdict === "avoid"} />
                <span className="mono muted">{s.verdict === "avoid" ? "capped · never fetched" : s.license}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mono muted">
            No registry source declares {kind} for {sport}.
          </p>
        )}
        {partial.length ? <p className="mono muted">partial coverage: {partial.map((s) => s.id).join(", ")}</p> : null}
      </div>
    </>
  );
}

function IdleScope({
  aid,
  mode,
  counts,
  total,
  onBus,
  cells,
  usecases,
  onCell,
}: {
  aid: AidEntry[];
  mode: Mode;
  counts: Record<CellStatus, number>;
  total: number;
  onBus: (k: string, s: string) => void;
  cells: HeatmapCell[];
  usecases: UseCase[];
  onCell: (u: string, s: string) => void;
}) {
  const go = cells.filter((c) => c.mode === mode && c.status === "go");
  return (
    <div className="idle">
      <h3>What to make next</h3>
      <p>
        {counts.go + counts["data-ready"]} of {total} cells can be patched in {MODE_LABEL[mode].toLowerCase()} mode (
        {counts.go} GO). Select any cell or bus to trace it. <span className="kbd">←↑↓→</span> move,{" "}
        <span className="kbd">Enter</span> opens, <span className="kbd">Esc</span> closes.
      </p>
      {go.length ? (
        <>
          <p className="legend aid-title">Ready to produce</p>
          <div className="aid">
            {go.map((c) => (
              <button key={`${c.usecase}|${c.sport}`} type="button" onClick={() => onCell(c.usecase, c.sport)}>
                <Led status="go" />
                <span>
                  <b>
                    {usecases.find((u) => u.id === c.usecase)?.name ?? c.usecase} · {c.sport}
                  </b>
                  <br />
                  <span className="muted">tested allowed data and a built composition</span>
                </span>
                <span />
              </button>
            ))}
          </div>
        </>
      ) : null}
      <p className="legend aid-title" data-testid="decision-aid-title">
        Decision aid · the single source that flips the most
      </p>
      {aid.length ? (
        <div className="aid" data-testid="decision-aid">
          {aid.slice(0, 6).map((a) => (
            <button key={`${a.kind}|${a.sport}`} type="button" onClick={() => onBus(a.kind, a.sport)}>
              <span className="display-num">+{a.flips.length}</span>
              <span>
                <b>
                  {a.kind} · {a.sport}
                </b>
                <br />
                <span className="muted">
                  one legal, tested {a.kind} source flips {a.flips.length} ASK/BLOCKED cell
                  {a.flips.length > 1 ? "s" : ""}
                  {a.becomes.go ? ` (${a.becomes.go} to GO` : " ("}
                  {a.becomes.go && a.becomes["data-ready"] ? ", " : ""}
                  {a.becomes["data-ready"] ? `${a.becomes["data-ready"]} to READY` : ""})
                  {a.alsoHelps ? `; also helps ${a.alsoHelps} more` : ""}
                </span>
                {a.candidates.length ? (
                  <span className="cand">
                    registry already lists legal:{" "}
                    {a.candidates
                      .map((c) => `${c.id} (${c.status === "declared" ? "test it" : `${c.status}: fix it`})`)
                      .join(", ")}
                  </span>
                ) : (
                  <span className="cand">no legal source in the registry yet: ask the owner before adding one</span>
                )}
              </span>
              <span className="lic-legal">
                <JackSvg cls="legal" />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="display aid-empty">
          <span className="silk">Decision aid</span>
          <p>
            No ASK/BLOCKED cell in {MODE_LABEL[mode].toLowerCase()} mode waits on a single kind: each needs more than
            one source, or none is blocked.
          </p>
        </div>
      )}
    </div>
  );
}

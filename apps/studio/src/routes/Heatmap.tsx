/**
 * 02 Heatmap: the rights grid. Four sport channels x the formats, MODE monetized / non-commercial,
 * every cell a glyph + pattern + label. The lower third never goes empty: a summary with "make
 * next" picks, or one cell's kinds, every source with its test status and licence text, the
 * never-fetched list and the cell reason verbatim, plus Create project.
 */
import type { CellStatus, HeatmapCell, Mode, Source, Sport, UseCase } from "@statreel/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type KeyboardEvent, useEffect, useMemo, useRef } from "react";
import { api, errorText, type ProjectWithJobs, qk } from "../api";
import { useCreateProject } from "../components/createProject";
import { Arrow, Field, LicChip, StatusChip, TestChip } from "../components/glyphs";
import { identVar } from "../components/idents";
import { artStyle, Failure, Loading, Sparkline } from "../components/ui";
import { useHeatmap, useProjects, useSources } from "../data";
import {
  allowedIn,
  type Capability,
  cellOf,
  countStatuses,
  decisionAid,
  MODE_LABEL,
  relTime,
  SPORTS,
  STAGE_LABEL,
  trendSeries,
} from "../logic";
import {
  bestCells,
  formatLabel,
  kindLong,
  LICENCE_WORD,
  modeDiff,
  neverFetchedFor,
  pad2,
  STATUS_AIR,
  STATUS_ORDER,
  STATUS_WORD,
  trendSummary,
} from "../onair";
import type { HeatmapSearch } from "../router";

/** The short second line inside a cell: why, in three words. */
function cellHint(c: HeatmapCell): string {
  if (c.status === "go") return "cleared, built";
  if (c.status === "data-ready") return "not built yet";
  if (c.status === "ask") {
    const k = c.kinds.find((x) => x.best && !allowedIn(c.mode, x.best));
    return k?.best === "paid" ? "paid licence" : "NC only";
  }
  const k = c.kinds.find((x) => !x.best);
  if (!k) return "blocked";
  if (k.tested) return "failing test";
  return k.sources.length ? "not tested" : "no source";
}

export function HeatmapPage() {
  const search = useSearch({ from: "/heatmap" }) as HeatmapSearch;
  const navigate = useNavigate({ from: "/heatmap" });
  const mode: Mode = search.mode ?? "monetized";
  const hm = useHeatmap();
  const src = useSources();
  const pr = useProjects();
  const qc = useQueryClient();
  const recompute = useMutation({
    mutationFn: api.recomputeHeatmap,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.heatmap }),
  });

  const usecases = hm.data?.usecases ?? [];
  const cells = hm.data?.cells ?? [];
  const [selUc, selSport] = (search.cell ?? "").split("|");
  const sel =
    usecases.find((u) => u.id === selUc) && SPORTS.includes(selSport as Sport)
      ? { uc: selUc as string, sport: selSport as Sport }
      : null;

  const setSearch = (next: HeatmapSearch) => void navigate({ search: next, replace: true, resetScroll: false });
  const setMode = (m: Mode) => setSearch({ mode: m, cell: search.cell });
  const select = (uc: string | null, sport?: Sport) =>
    setSearch({ mode, cell: uc && sport ? `${uc}|${sport}` : undefined });

  // flip animation: cells whose status changed since the last render in this view
  const prev = useRef<Map<string, CellStatus>>(new Map());
  const changed = useMemo(() => {
    const out = new Set<string>();
    for (const c of cells) {
      if (c.mode !== mode) continue;
      const k = `${c.usecase}|${c.sport}`;
      const was = prev.current.get(k);
      if (was && was !== c.status) out.add(k);
    }
    return out;
  }, [cells, mode]);
  useEffect(() => {
    const m = new Map<string, CellStatus>();
    for (const c of cells) if (c.mode === mode) m.set(`${c.usecase}|${c.sport}`, c.status);
    prev.current = m;
  });

  const grid = useRef<HTMLDivElement>(null);
  const focusCell = (r: number, c: number) => {
    const el = grid.current?.querySelector<HTMLButtonElement>(`[data-r="${r}"][data-c="${c}"]`);
    el?.focus();
  };
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (!el) return;
    let r = Number(el.dataset.r);
    let c = Number(el.dataset.c);
    if (e.key === "ArrowRight") c = Math.min(usecases.length - 1, c + 1);
    else if (e.key === "ArrowLeft") c = Math.max(0, c - 1);
    else if (e.key === "ArrowDown") r = Math.min(SPORTS.length - 1, r + 1);
    else if (e.key === "ArrowUp") r = Math.max(0, r - 1);
    else if (e.key === "Home") c = 0;
    else if (e.key === "End") c = usecases.length - 1;
    else return;
    e.preventDefault();
    focusCell(r, c);
  };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      if (e.key === "Escape" && search.cell) {
        e.preventDefault();
        const [u, s] = search.cell.split("|");
        const r = SPORTS.indexOf(s as Sport);
        const c = usecases.findIndex((x) => x.id === u);
        setSearch({ mode });
        window.setTimeout(() => focusCell(r, c), 0);
      } else if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setMode(mode === "monetized" ? "non_commercial" : "monetized");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const focus = sel
    ? { r: SPORTS.indexOf(sel.sport), c: usecases.findIndex((u) => u.id === sel.uc) }
    : {
        r: 0,
        c: Math.max(
          0,
          usecases.findIndex((u) => u.id === "era-adjusted-rankings"),
        ),
      };
  const n = countStatuses(cells, mode);
  const per = usecases.length * SPORTS.length;
  const lastSnap = hm.data?.trend.at(-1)?.at;
  const caps = src.data?.capabilities ?? [];
  const selUsecase = sel ? usecases.find((u) => u.id === sel.uc) : undefined;

  return (
    <main id="main" className="hm">
      <div className="bar">
        <h1>
          Rights grid
          <small>
            {SPORTS.length} sport channels × {usecases.length || "—"} formats
          </small>
        </h1>
        <div className="ctl">
          <span className="label">
            Mode <kbd>M</kbd>
          </span>
          <div className="seg" role="group" aria-label="Mode">
            {(["monetized", "non_commercial"] as const).map((m) => (
              <button
                type="button"
                key={m}
                aria-pressed={mode === m}
                data-testid={`mode-${m}`}
                onClick={() => setMode(m)}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        <div className="ctl">
          <span className="label">{lastSnap ? `Snapshot ${relTime(lastSnap)}` : "No snapshot yet"}</span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
          >
            {recompute.isPending ? "Recomputing" : "Recompute"}
          </button>
        </div>
        <ul className="legend" aria-label="Status legend and counts">
          {STATUS_ORDER.map((k) => (
            <li key={k} className={`st--${k}${n[k] ? "" : " zero"}`}>
              <span className="n num">{pad2(n[k])}</span>
              <StatusChip status={k} size={14} />
              <small>{n[k] ? `of ${per}` : "none"}</small>
            </li>
          ))}
        </ul>
      </div>
      {recompute.isError ? <p className="bar-msg is-error">Recompute failed: {errorText(recompute.error)}</p> : null}

      {hm.isError ? (
        <div className="grid-wrap">
          <Failure error={hm.error} what="The heatmap" />
        </div>
      ) : hm.isLoading ? (
        <div className="grid-wrap">
          <Loading what="the rights grid" />
        </div>
      ) : (
        <div className="grid-wrap">
          <div
            className="grid"
            ref={grid}
            role="grid"
            aria-label={`Feasibility by sport and format, ${MODE_LABEL[mode]}`}
            onKeyDown={onGridKey}
            style={{ ["--cols" as string]: usecases.length }}
          >
            <div className="corner" role="presentation">
              <span>{SPORTS.length} sports</span>
              <span>× {usecases.length} formats</span>
            </div>
            {usecases.map((u, j) => {
              const series = trendSeries(hm.data?.trend ?? [], u.id, mode);
              const t = trendSummary(series);
              return (
                <div
                  key={u.id}
                  className={`colh${sel?.uc === u.id ? " hot" : ""}`}
                  role="columnheader"
                  style={artStyle(identVar(u.id))}
                >
                  <b className="num">
                    {pad2(j + 1)} · {formatLabel(u.default_format)}
                  </b>
                  <span>{u.name}</span>
                  <i>{u.requires.kinds.join("+")}</i>
                  <em className="colh__trend" title={`${t.snapshots} snapshot${t.snapshots === 1 ? "" : "s"}`}>
                    <Sparkline
                      values={series}
                      w={40}
                      h={14}
                      label={`Go count over ${t.snapshots} snapshots`}
                      className="spark spark--tiny"
                    />
                    <span className="num">
                      go {t.now}/{SPORTS.length}
                      {t.delta === null ? "" : t.delta === 0 ? " · =" : ` · ${t.delta > 0 ? "+" : ""}${t.delta}`}
                    </span>
                  </em>
                </div>
              );
            })}
            {SPORTS.map((sp, i) => {
              const rc: Partial<Record<CellStatus, number>> = {};
              for (const u of usecases) {
                const c = cellOf(cells, u.id, sp, mode);
                if (c) rc[c.status] = (rc[c.status] ?? 0) + 1;
              }
              return (
                <RowCells key={sp}>
                  <div className={`rowh${sel?.sport === sp ? " hot" : ""}`} role="rowheader">
                    <Field sport={sp} />
                    <b>{sp}</b>
                    <small className="num">
                      {STATUS_ORDER.filter((k) => rc[k]).map((k) => (
                        <span key={k} className={`st--${k}`} title={`${rc[k]} ${STATUS_WORD[k]}`}>
                          <StatusChip status={k} size={12} label={String(rc[k])} />
                        </span>
                      ))}
                    </small>
                  </div>
                  {usecases.map((u, j) => {
                    const c = cellOf(cells, u.id, sp, mode);
                    if (!c)
                      return (
                        <div key={u.id} className="cell cell--none">
                          no cell
                        </div>
                      );
                    const isSel = sel?.uc === u.id && sel.sport === sp;
                    const k = `${u.id}|${sp}`;
                    return (
                      <button
                        type="button"
                        key={u.id}
                        role="gridcell"
                        data-testid={`cell-${u.id}-${sp}`}
                        data-r={i}
                        data-c={j}
                        tabIndex={focus.r === i && focus.c === j ? 0 : -1}
                        aria-selected={isSel}
                        aria-label={`${u.name}, ${sp}, ${MODE_LABEL[mode]}: ${STATUS_WORD[c.status]}. ${c.reason}`}
                        className={`cell st--${c.status} pat--${c.status}${changed.has(k) ? " flip" : ""}`}
                        style={{ ["--d" as string]: i * 3 + j * 2 }}
                        onClick={() => select(isSel ? null : u.id, sp)}
                      >
                        <StatusChip status={c.status} />
                        <span className="cell__hint">{cellHint(c)}</span>
                      </button>
                    );
                  })}
                </RowCells>
              );
            })}
          </div>
          <p className="grid-foot">
            <span>
              <kbd>Arrows</kbd> move
            </span>
            <span>
              <kbd>Enter</kbd> open a cell
            </span>
            <span>
              <kbd>Esc</kbd> back to the summary
            </span>
            <span>
              Basis: tested capabilities ({caps.filter((c) => c.status === "pass").length} pass of {caps.length}) ×
              registry × built compositions · {hm.data?.trend.length ?? 0} snapshot
              {(hm.data?.trend.length ?? 0) === 1 ? "" : "s"}
            </span>
          </p>
        </div>
      )}

      {hm.data ? (
        sel && selUsecase ? (
          <CellDetail
            key={`${sel.uc}|${sel.sport}|${mode}`}
            uc={selUsecase}
            sport={sel.sport}
            mode={mode}
            cells={cells}
            sources={src.data?.sources ?? []}
            caps={caps}
            projects={pr.data?.projects ?? []}
            onBack={() => select(null)}
            onMode={setMode}
          />
        ) : (
          <Summary key={mode} mode={mode} cells={cells} usecases={usecases} onPick={(u, s) => select(u, s)} />
        )
      ) : null}
    </main>
  );
}

/** Row fragment: keeps the grid flat (display: contents) while grouping one sport's cells. */
const RowCells = ({ children }: { children: React.ReactNode }) => (
  <div className="grid__row" role="row">
    {children}
  </div>
);

// ------------------------------------------------------------------ detail: one cell

function CellDetail({
  uc,
  sport,
  mode,
  cells,
  sources,
  caps,
  projects,
  onBack,
  onMode,
}: {
  uc: UseCase;
  sport: Sport;
  mode: Mode;
  cells: HeatmapCell[];
  sources: Source[];
  caps: Capability[];
  projects: ProjectWithJobs[];
  onBack: () => void;
  onMode: (m: Mode) => void;
}) {
  const c = cellOf(cells, uc.id, sport, mode);
  const other: Mode = mode === "monetized" ? "non_commercial" : "monetized";
  const oc = cellOf(cells, uc.id, sport, other);
  const create = useCreateProject();
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const never = neverFetchedFor(sources, sport, uc.requires.kinds);
  const mine = projects.filter((p) => p.use_case_id === uc.id && p.sport === sport);
  if (!c) return null;
  const attributions = [
    ...new Set(
      c.kinds
        .flatMap((k) => k.sources.filter((s) => s.status === "pass").map((s) => srcById.get(s.id)?.attribution))
        .filter(Boolean),
    ),
  ];
  return (
    <div className="detail in" aria-live="polite" style={artStyle(identVar(uc.id))}>
      <section>
        <div className="d-crumb">
          <button type="button" onClick={onBack}>
            <Arrow dir="left" />
            Grid summary <kbd>Esc</kbd>
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            data-testid="create-project"
            disabled={create.isPending}
            onClick={() => create.mutate({ usecase: uc, sport, mode })}
          >
            {create.isPending ? "Creating" : "Create project"} <Arrow />
          </button>
        </div>
        {create.isError ? <p className="d-warn">Could not create the project: {errorText(create.error)}</p> : null}
        <h2 className="d-name">
          {uc.name} <em>× {sport}</em>
        </h2>
        <div className="d-status">
          <StatusChip status={c.status} size={22} />
          <small>
            {STATUS_AIR[c.status]} · {MODE_LABEL[mode]}
          </small>
        </div>
        <p className="d-why">
          <span className="label">Reason, verbatim</span>
          {c.reason}
        </p>
        {oc ? (
          <p className="d-other">
            In {MODE_LABEL[other].toLowerCase()} mode: <StatusChip status={oc.status} size={14} />
            <button type="button" onClick={() => onMode(other)}>
              switch
            </button>
          </p>
        ) : null}
        {c.status === "ask" || c.status === "blocked" ? (
          <p className="d-warn">
            You can draft it, but the gate will refuse a {MODE_LABEL[mode].toLowerCase()} publish until every kind
            clears.
          </p>
        ) : null}
        <p className="d-inst">
          {mine.length ? (
            <>
              In the studio:{" "}
              {mine.map((p, i) => (
                <span key={p.id}>
                  {i ? ", " : ""}
                  <Link to="/studio/$projectId" params={{ projectId: p.id }}>
                    {p.id} · {STAGE_LABEL[p.status] ?? p.status} · {MODE_LABEL[p.mode as Mode] ?? p.mode}
                  </Link>
                </span>
              ))}
            </>
          ) : (
            "No project for this pairing yet."
          )}
        </p>
      </section>
      <section>
        <h3 className="sec-h">
          <span>
            What it needs · {c.kinds.length} data kind{c.kinds.length === 1 ? "" : "s"}
          </span>
          <span>complexity stage {uc.stage}</span>
        </h3>
        {c.kinds.map((k) => {
          const ok = allowedIn(mode, k.best);
          return (
            <div className="kind" key={k.kind}>
              <div className="kind__k">
                <b>{kindLong(k.kind)}</b>
                <span className="label">
                  {k.kind} · {k.tested ? "tested" : "not tested"}
                </span>
                <span className="kind__best">
                  best: {k.best ? <LicChip cls={k.best} /> : <span className="label">none passing</span>}
                </span>
                <span className={`verdict verdict--${ok ? "ok" : "no"}`}>
                  <StatusChip
                    status={ok ? "go" : k.best ? "ask" : "blocked"}
                    size={13}
                    label={
                      ok ? "CLEARS" : k.best ? `BEST IS ${LICENCE_WORD[k.best].toUpperCase()}` : "NO PASSING SOURCE"
                    }
                  />
                </span>
              </div>
              <div className="srcs">
                {k.sources.length ? (
                  k.sources.map((s) => {
                    const reg = srcById.get(s.id);
                    const cap = caps.find((x) => x.sport === sport && x.kind === k.kind && x.source_id === s.id);
                    const best = !!k.best && s.status === "pass" && s.license_class === k.best;
                    return (
                      <div
                        className={`src${best ? " src--best" : ""}${allowedIn(mode, s.license_class) ? "" : " src--out"}`}
                        key={s.id}
                      >
                        <i className="src__dot" />
                        <div>
                          <div className="src__h">
                            <b>{s.id}</b>
                            <LicChip cls={s.license_class} />
                            <TestChip status={s.status} />
                            {best ? <em>best</em> : null}
                            {allowedIn(mode, s.license_class) ? null : (
                              <span className="verdict verdict--no">not in this mode</span>
                            )}
                          </div>
                          {reg?.license ?? "not in the registry"}
                          {reg?.verdict_note ? ` · ${reg.verdict_note}` : ""}
                          {cap ? (
                            <span className="src__cap">
                              test: {cap.detail} · {cap.rows.toLocaleString("en-US")} rows
                              {cap.coverage_from ? ` · ${cap.coverage_from}–${cap.coverage_to ?? "now"}` : ""}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="sum-p">No source in the registry declares this kind for {sport}.</p>
                )}
              </div>
            </div>
          );
        })}
      </section>
      <section>
        <h3 className="sec-h">
          <span>Never fetched · {never.length}</span>
        </h3>
        {never.length ? (
          <ul className="off-list">
            {never.map((s) => (
              <li key={s.id}>
                <b>{s.id}</b>
                {s.license}
                {s.notes ? ` · ${s.notes}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="sum-p">No off-limits source touches this cell.</p>
        )}
        {attributions.length ? (
          <p className="attr">
            Attribution every video from this cell carries:
            <br />
            <b>{attributions.join(" · ")}</b>
          </p>
        ) : null}
        <p className="attr">
          {uc.notes ? `${uc.notes} · ` : ""}default {formatLabel(uc.default_format)} · {uc.duration_s.min}–
          {uc.duration_s.max} s · composition{" "}
          {uc.composition
            ? `${uc.composition} ${c.composition_implemented ? "(built)" : "(not built)"}`
            : "none designed"}
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ detail: summary

function Summary({
  mode,
  cells,
  usecases,
  onPick,
}: {
  mode: Mode;
  cells: HeatmapCell[];
  usecases: UseCase[];
  onPick: (uc: string, sport: Sport) => void;
}) {
  const n = countStatuses(cells, mode);
  const diff = modeDiff(cells);
  const nd = [...diff.values()].reduce((a, s) => a + s.length, 0);
  const aid = decisionAid(cells, mode).slice(0, 5);
  const stage = (id: string) => usecases.find((u) => u.id === id)?.stage ?? 9;
  const name = (id: string) => usecases.find((u) => u.id === id)?.name ?? id;
  const picks = bestCells(cells, mode, stage, 5);
  return (
    <div className="detail in" aria-live="polite">
      <section>
        <h2 className="sec-h">
          <span>{MODE_LABEL[mode]} · today</span>
        </h2>
        <div className="sum-n">
          {STATUS_ORDER.map((k) => (
            <div key={k} className={`st--${k}`}>
              <b className="num">{pad2(n[k])}</b>
              <StatusChip status={k} size={16} />
            </div>
          ))}
        </div>
        <p className="sum-p">
          {mode === "monetized"
            ? "Monetized videos may carry legal sources only."
            : "Non-commercial videos may carry legal and non-commercial sources."}{" "}
          A registry declaration alone never makes a cell ready: <b>declared but not tested is Blocked</b>, and says so.
        </p>
      </section>
      <section>
        <h2 className="sec-h">
          <span>
            What the mode switch changes · {nd} cell{nd === 1 ? "" : "s"}
          </span>
        </h2>
        {nd ? (
          <>
            <p className="sum-p">These pairings have a different status in the other mode.</p>
            <ul className="delta">
              {[...diff.entries()].map(([id, sports]) => (
                <li key={id}>
                  <b>{name(id)}</b>
                  {sports.map((sp) => (
                    <span className="chip" key={sp}>
                      {sp}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="sum-p">
            <b>Nothing changes today.</b> No tested source is non-commercial-only for a pairing that would otherwise
            clear, so both modes show the same grid.
          </p>
        )}
        <h2 className="sec-h sec-h--gap">
          <span>Best cells to make · status, then simplest</span>
        </h2>
        <div className="sum-list">
          {picks.map((c, i) => (
            <button type="button" key={`${c.usecase}|${c.sport}`} onClick={() => onPick(c.usecase, c.sport)}>
              <b className="num">{i + 1}</b>
              <span>
                {name(c.usecase)} × {c.sport}
                <small>complexity stage {stage(c.usecase)}</small>
              </span>
              <StatusChip status={c.status} size={14} />
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2 className="sec-h">
          <span>Make next · which legal source flips the most cells</span>
        </h2>
        {aid.length ? (
          <ol className="aid">
            {aid.map((a) => (
              <li key={`${a.kind}|${a.sport}`}>
                <div className="aid__h">
                  <b>
                    {kindLong(a.kind)} × {a.sport}
                  </b>
                  <span className="aid__n num">
                    flips {a.flips.length} cell{a.flips.length === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="aid__to">
                  becomes{" "}
                  {(["go", "data-ready"] as const)
                    .filter((k) => a.becomes[k])
                    .map((k) => (
                      <span key={k}>
                        <StatusChip status={k} size={12} label={`${a.becomes[k]} ${STATUS_WORD[k]}`} />{" "}
                      </span>
                    ))}
                  {a.alsoHelps ? <span className="label"> · helps {a.alsoHelps} more</span> : null}
                </p>
                <p className="aid__c">
                  {a.candidates.length ? (
                    <>
                      Legal candidates already on the registry:{" "}
                      {a.candidates.map((c, i) => (
                        <span key={c.id}>
                          {i ? ", " : ""}
                          <b>{c.id}</b> (
                          {c.status === "declared"
                            ? "test it"
                            : c.status === "needs_review"
                              ? "review it"
                              : "fix its test"}
                          )
                        </span>
                      ))}
                    </>
                  ) : (
                    "No legal source on the registry for this yet: finding one means asking the owner (a new registry entry)."
                  )}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="sum-p">No single legal source would flip a cell in this mode.</p>
        )}
      </section>
    </div>
  );
}

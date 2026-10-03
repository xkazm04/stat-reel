/**
 * Heatmap layer 2: one cell as its own full layer over the grid (fixed below the nav, its own
 * scroll, free to grow). It reads the heatmap cell (status, reason verbatim, required kinds with
 * tested + best licence and every source's test status), the registry (licence text, attribution,
 * never-fetched sources), the capability tests (detail, rows, coverage) and the projects already
 * made for this pairing. It names what would clear this cell (its failing kinds and the legal
 * candidates already on the registry), offers neighbours to make next, and Create project.
 * It expands from the clicked cell (the lane band widens behind the clay hairline) and closes
 * back into it (button or Esc), returning focus to that cell on the grid. Reduced motion: it
 * simply appears.
 */
import type { HeatmapCell, Mode, Source, Sport, UseCase } from "@statreel/schemas";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { errorText, type ProjectWithJobs } from "../api";
import { useCreateProject } from "../components/createProject";
import { DnsList, FinishPicture, ModeSwitch, testWord } from "../components/finish";
import { Arrow, StatusChip } from "../components/glyphs";
import { identVar } from "../components/idents";
import { takeLayerOrigin, visibleRect, type Rect } from "../components/layerTransition";
import { artStyle, Loading, useReducedMotion } from "../components/ui";
import { useHeatmap, useProjects, useSources } from "../data";
import { cellFixes, focusKey, neighbours, snapshotAge } from "../heatmap";
import { type Capability, cellOf, MODE_LABEL, SPORTS, STAGE_LABEL } from "../logic";
import { formatLabel, kindLong, LICENCE_WORD, neverFetchedFor, pad2, STATUS_AIR, STATUS_WORD } from "../display";
import type { HeatmapSearch } from "../router";

// ------------------------------------------------------------------ choreography

function clipFrom(r: Rect, box: DOMRect): string {
  const t = Math.max(0, r.top - box.top);
  const b = Math.max(t + 1, r.bottom - box.top);
  // the lane band widens into the scene: full width, the cell's row height
  return `polygon(0px ${t}px, ${box.width}px ${t}px, ${box.width}px ${b}px, 0px ${b}px)`;
}

function clipFull(box: DOMRect): string {
  const w = box.width;
  const h = box.height;
  return `polygon(0px 0px, ${w}px 0px, ${w}px ${h}px, 0px ${h}px)`;
}

const ms = (el: Element, v: string, fallback: number): number => {
  const s = getComputedStyle(el).getPropertyValue(v).trim();
  const n = Number.parseFloat(s);
  if (Number.isNaN(n)) return fallback;
  return s.endsWith("ms") ? n : n * 1000;
};

// ------------------------------------------------------------------ layer

export function HeatmapCellLayer() {
  const { usecase, sport } = useParams({ from: "/heatmap/$usecase/$sport" });
  const search = useSearch({ from: "/heatmap/$usecase/$sport" }) as HeatmapSearch;
  const mode: Mode = search.mode ?? "monetized";
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const hm = useHeatmap();
  const src = useSources();
  const pr = useProjects();

  const root = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const key = focusKey(usecase, sport);

  const usecases = hm.data?.usecases ?? [];
  const cells = hm.data?.cells ?? [];
  const uc = usecases.find((u) => u.id === usecase);
  const validSport = SPORTS.includes(sport as Sport);
  const cell = uc && validSport ? cellOf(cells, uc.id, sport, mode) : undefined;

  // open: expand from the clicked cell
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const origin = takeLayerOrigin(key);
    el.classList.remove("is-sweeping");
    if (reduced) return;
    void el.offsetWidth;
    el.classList.add("is-sweeping");
    if (!origin) return;
    const box = el.getBoundingClientRect();
    el.style.transition = "none";
    el.style.clipPath = clipFrom(origin, box);
    void el.offsetWidth;
    const dur = ms(el, "--motion-wipe", 600);
    el.style.transition = `clip-path ${dur}ms var(--ease-wipe)`;
    el.style.clipPath = clipFull(box);
    const t = window.setTimeout(() => {
      el.style.transition = "";
      el.style.clipPath = "";
    }, dur + 40);
    return () => window.clearTimeout(t);
  }, [key, reduced]);

  // a new cell starts at the top, with focus on the way back
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus on every cell change
  useEffect(() => {
    root.current?.scrollTo({ top: 0 });
    back.current?.focus({ preventScroll: true });
  }, [key]);

  useEffect(() => {
    document.documentElement.classList.add("hm-layer-open");
    return () => document.documentElement.classList.remove("hm-layer-open");
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const done = () =>
      void navigate({ to: "/heatmap", search: { mode, focus: key, view: "feasibility" }, resetScroll: false });
    const el = root.current;
    const target = visibleRect(document.querySelector(`[data-testid="cell-${usecase}-${sport}"]`));
    if (!el || !target || reduced) {
      done();
      return;
    }
    const box = el.getBoundingClientRect();
    const dur = ms(el, "--motion-base", 300);
    el.style.transition = "none";
    el.style.clipPath = clipFull(box);
    void el.offsetWidth;
    el.style.transition = `clip-path ${dur}ms var(--ease-wipe)`;
    el.style.clipPath = clipFrom(target, box);
    window.setTimeout(done, dur);
  }, [navigate, mode, key, usecase, sport, reduced]);

  // Esc closes; Tab stays inside the layer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if ((e.target as HTMLElement).closest("input, textarea, select")) return;
        e.preventDefault();
        close();
      } else if (e.key === "Tab" && root.current) {
        const f = [
          ...root.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex='0']"),
        ].filter((n) => n.offsetParent !== null);
        if (!f.length) return;
        const first = f[0] as HTMLElement;
        const last = f[f.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        } else if (!root.current.contains(document.activeElement)) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const setMode = (m: Mode) =>
    void navigate({
      to: "/heatmap/$usecase/$sport",
      params: { usecase, sport },
      search: { mode: m },
      replace: true,
      resetScroll: false,
    });
  const goCell = (u: string, s: string) =>
    void navigate({
      to: "/heatmap/$usecase/$sport",
      params: { usecase: u, sport: s },
      search: { mode },
      replace: true,
      resetScroll: false,
    });

  const lane = uc ? usecases.indexOf(uc) + 1 : 0;
  const style: CSSProperties = uc ? artStyle(identVar(uc.id)) : {};

  return (
    <div
      className="hl hl--photofinish"
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hl-title"
      style={style}
    >
      <i className="hl-sweep" aria-hidden="true" />
      <header className="hl-bar">
        <button type="button" className="btn btn--sm hl-back" ref={back} onClick={close}>
          <Arrow dir="left" />
          Back to the grid <kbd>Esc</kbd>
        </button>
        <nav className="hl-crumbs" aria-label="Where you are">
          <button type="button" onClick={close}>
            Heatmap
          </button>
          <i className="sep" aria-hidden="true" />
          <span>{uc ? `Lane ${pad2(lane)} · ${uc.name}` : usecase}</span>
          <i className="sep" aria-hidden="true" />
          <span aria-current="true">{sport}</span>
        </nav>
        <div className="hl-bar__right">
          <ModeSwitch mode={mode} onChange={setMode} label="Line at" />
        </div>
      </header>

      {hm.isLoading ? (
        <div className="hl-state">
          <Loading what="the cell" />
        </div>
      ) : !uc || !validSport || !cell ? (
        <div className="hl-state">
          <div className="empty">
            <b>No such cell</b>
            {hm.isError
              ? `The heatmap did not load: ${errorText(hm.error)}`
              : `There is no heatmap cell for "${usecase}" × "${sport}" in ${MODE_LABEL[mode].toLowerCase()} mode.`}{" "}
            <button type="button" className="hl-link" onClick={close}>
              Back to the grid
            </button>
          </div>
        </div>
      ) : (
        <CellBody
          key={`${key}|${mode}`}
          uc={uc}
          lane={lane}
          lanes={usecases.length}
          sport={sport as Sport}
          mode={mode}
          cell={cell}
          cells={cells}
          usecases={usecases}
          sources={src.data?.sources ?? []}
          caps={src.data?.capabilities ?? []}
          snapshot={snapshotAge(hm.data?.trend ?? [])}
          projects={pr.data?.projects ?? []}
          onClose={close}
          onMode={setMode}
          onCell={goCell}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ body

type BodyProps = {
  uc: UseCase;
  lane: number;
  lanes: number;
  sport: Sport;
  mode: Mode;
  cell: HeatmapCell;
  cells: HeatmapCell[];
  usecases: UseCase[];
  sources: Source[];
  caps: Capability[];
  /** "snapshot 3 h ago": the grid is a computed snapshot, never "today" */
  snapshot: string;
  projects: ProjectWithJobs[];
  onClose: () => void;
  onMode: (m: Mode) => void;
  onCell: (usecase: string, sport: string) => void;
};

function CellBody(p: BodyProps) {
  const { uc, sport, mode, cell, cells, sources } = p;
  const create = useCreateProject();
  const other: Mode = mode === "monetized" ? "non_commercial" : "monetized";
  const oc = cellOf(cells, uc.id, sport, other);
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const never = neverFetchedFor(sources, sport, uc.requires.kinds);
  const mine = p.projects.filter((x) => x.use_case_id === uc.id && x.sport === sport);
  const tested = cell.kinds.filter((k) => k.tested).length;
  const attributions = [
    ...new Set(
      cell.kinds
        .flatMap((k) => k.sources.filter((s) => s.status === "pass").map((s) => srcById.get(s.id)?.attribution))
        .filter((a): a is string => !!a),
    ),
  ];

  return (
    <div className="hl-body">
      {/* ---- the cell */}
      <section className="hl-sum" aria-labelledby="hl-title">
        <p className="eyebrow">
          <span className="hl-lane">
            Lane {pad2(p.lane)} of {pad2(p.lanes)}
          </span>
          · {formatLabel(uc.default_format)} · {MODE_LABEL[mode].toLowerCase()}
        </p>
        <h2 className="hl-title" id="hl-title">
          {uc.name} <em>× {sport}</em>
        </h2>
        <div className="hl-sports" role="group" aria-label="Same use case, other sports">
          {SPORTS.map((s) => {
            const c = cellOf(cells, uc.id, s, mode);
            return (
              <button
                type="button"
                key={s}
                className="hl-sport"
                aria-pressed={s === sport}
                onClick={() => s !== sport && p.onCell(uc.id, s)}
              >
                <b>{s}</b>
                {c ? <StatusChip status={c.status} size={12} /> : <span className="label">no cell</span>}
              </button>
            );
          })}
        </div>
        <div className={`hl-status st--${cell.status}`}>
          <StatusChip status={cell.status} size={20} />
          <small>
            {STATUS_AIR[cell.status]} · {MODE_LABEL[mode]} · {p.snapshot}
          </small>
        </div>
        <div className="hl-why">
          <span className="label">Reason, verbatim</span>
          <p>{cell.reason}</p>
        </div>
        {oc ? (
          <p className="hl-other">
            In {MODE_LABEL[other].toLowerCase()} mode: <StatusChip status={oc.status} size={13} />
            <button type="button" onClick={() => p.onMode(other)}>
              Move the line to {MODE_LABEL[other].toLowerCase()}
            </button>
          </p>
        ) : null}
        {cell.status === "ask" || cell.status === "blocked" ? (
          <p className="hl-warn">
            You can draft it, but the gate refuses a {MODE_LABEL[mode].toLowerCase()} publish until every required kind
            clears.
          </p>
        ) : null}
        <div className="hl-actions">
          <button
            type="button"
            className="btn btn--primary"
            data-testid="create-project"
            disabled={create.isPending}
            onClick={() => create.mutate({ usecase: uc, sport, mode })}
          >
            {create.isPending ? "Creating" : "Create project"} <Arrow />
          </button>
          <button type="button" className="btn btn--ghost" onClick={p.onClose}>
            Back <kbd>Esc</kbd>
          </button>
        </div>
        {create.isError ? (
          <p className="hl-warn" role="alert">
            Could not create the project: {errorText(create.error)}
          </p>
        ) : null}
        <p className="hl-meta">
          {formatLabel(uc.default_format)} default · {uc.duration_s.min}–{uc.duration_s.max} s · complexity stage{" "}
          {uc.stage} · composition{" "}
          {uc.composition
            ? `${uc.composition} ${cell.composition_implemented ? "(built)" : "(not built)"}`
            : "none designed"}{" "}
          · {tested} of {cell.kinds.length} kind{cell.kinds.length === 1 ? "" : "s"} tested
        </p>
        <div className="hl-block">
          <h3 className="sec-h">
            <span>In the studio · {mine.length}</span>
          </h3>
          {mine.length ? (
            <ul className="hl-projects">
              {mine.map((x) => (
                <li key={x.id}>
                  <Link to="/studio/$projectId" params={{ projectId: x.id }}>
                    {x.title}
                  </Link>
                  <span className="mono">
                    {x.id} · {STAGE_LABEL[x.status] ?? x.status} · {MODE_LABEL[x.mode as Mode] ?? x.mode}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hl-p">No project for this pairing yet.</p>
          )}
        </div>
      </section>

      {/* ---- what it needs */}
      <section className="hl-needs" aria-label="What it needs">
        <h3 className="sec-h">
          <span>
            Photo-finish · one lane per data kind · right of the line is allowed
          </span>
          <span>complexity stage {uc.stage}</span>
        </h3>
        {cell.kinds.length === 0 ? (
          <p className="hl-p">This use case declares no required data kind.</p>
        ) : (
          <>
            <FinishPicture cell={cell} sources={sources} />
            <CapTable cell={cell} sport={sport} caps={p.caps} />
          </>
        )}
      </section>

      {/* ---- around it */}
      <aside className="hl-side" aria-label="Never fetched, make next, attribution">
        <div className="hl-block">
          <h3 className="sec-h">
            <span>Did not start · off-limits, never fetched · {never.length}</span>
          </h3>
          <DnsList sources={never} empty="No off-limits source touches this cell." />
        </div>
        <MakeNext {...p} />
        <div className="hl-block">
          <h3 className="sec-h">
            <span>Attribution</span>
          </h3>
          {attributions.length ? (
            <p className="hl-attr">
              Every video from this cell carries: <b>{attributions.join(" · ")}</b>
            </p>
          ) : (
            <p className="hl-p">No passing source yet, so no attribution line.</p>
          )}
          {uc.notes ? <p className="hl-attr">{uc.notes}</p> : null}
        </div>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------ the tests under the picture

function CapTable({ cell, sport, caps }: { cell: HeatmapCell; sport: Sport; caps: Capability[] }) {
  const rows = cell.kinds.flatMap((k) =>
    k.sources.map((s) => ({
      kind: k.kind,
      s,
      cap: caps.find((x) => x.sport === sport && x.kind === k.kind && x.source_id === s.id),
    })),
  );
  if (!rows.length) return null;
  return (
    <div className="hl-caps">
      <h4 className="eyebrow">Capability tests · what was actually run</h4>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Source</th>
              <th>Test</th>
              <th>Detail</th>
              <th className="num">Rows</th>
              <th className="num">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ kind, s, cap }) => (
              <tr key={`${kind}|${s.id}`}>
                <td className="mono">{kind}</td>
                <td className="mono">{s.id}</td>
                <td className={`hl-test hl-test--${s.status}`}>{testWord(s.status)}</td>
                <td>{cap ? cap.detail : "no capability test on record"}</td>
                <td className="num">{cap ? cap.rows.toLocaleString("en-US") : "—"}</td>
                <td className="num">{cap?.coverage_from ? `${cap.coverage_from}–${cap.coverage_to ?? "now"}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ make next for this cell

function MakeNext({ uc, sport, mode, cell, cells, usecases, onCell }: BodyProps) {
  const fixes = cellFixes(cells, cell);
  const stage = (id: string) => usecases.find((u) => u.id === id)?.stage ?? 9;
  const name = (id: string) => usecases.find((u) => u.id === id)?.name ?? id;
  const near = neighbours(cells, cell, stage, 4);
  return (
    <div className="hl-block">
      <h3 className="sec-h">
        <span>Make next · this cell</span>
      </h3>
      {fixes.length ? (
        <ol className="hl-fixes">
          {fixes.map((f) => (
            <li key={f.kind}>
              <div className="hl-fix__h">
                <b>
                  {kindLong(f.kind)} × {sport}
                </b>
                <span className="hl-fix__n num">
                  {f.flipsInGrid
                    ? `flips ${f.flipsInGrid} cell${f.flipsInGrid === 1 ? "" : "s"} in the grid`
                    : "one of several missing kinds"}
                </span>
              </div>
              <p className="hl-fix__to">
                {f.flipsThisCell ? (
                  <>
                    Clearing it makes this cell{" "}
                    <StatusChip status={f.becomes} size={12} label={STATUS_WORD[f.becomes]} />
                  </>
                ) : (
                  "This cell also misses another kind; this fix alone does not clear it."
                )}
                {f.best ? ` · best passing today: ${LICENCE_WORD[f.best].toLowerCase()} (not allowed in ${MODE_LABEL[mode].toLowerCase()})` : ""}
              </p>
              <p className="hl-fix__c">
                {f.candidates.length ? (
                  <>
                    {mode === "monetized" ? "Legal" : "Legal or non-commercial"} candidates on the registry:{" "}
                    {f.candidates.map((c, i) => (
                      <span key={c.id}>
                        {i ? ", " : ""}
                        <b>{c.id}</b> ({c.action})
                      </span>
                    ))}
                  </>
                ) : (
                  `No ${mode === "monetized" ? "legal" : "legal or non-commercial"} source on the registry for this yet: adding one is the owner's call (a new registry entry).`
                )}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="hl-p">
          Nothing to fix: every required kind clears in {MODE_LABEL[mode].toLowerCase()} mode.
          {cell.status === "data-ready"
            ? ` Building the ${uc.composition ?? "(not yet designed)"} composition makes it Go.`
            : ""}
        </p>
      )}
      {near.length ? (
        <>
          <h4 className="eyebrow hl-near-h">Other cells to make · status, then simplest</h4>
          <div className="hl-near">
            {near.map((c) => (
              <button type="button" key={focusKey(c.usecase, c.sport)} onClick={() => onCell(c.usecase, c.sport)}>
                <span>
                  {name(c.usecase)} × {c.sport}
                  <small>complexity stage {stage(c.usecase)}</small>
                </span>
                <StatusChip status={c.status} size={12} />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

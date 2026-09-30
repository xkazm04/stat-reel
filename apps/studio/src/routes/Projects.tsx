/**
 * 03 Rundown: every project across idea -> data ready -> scripted -> rendered -> gated -> published,
 * sorted by "needs you". Live job progress from SSE; a metrics sparkline where platform numbers
 * exist (dry-run publications have none, and say so).
 */
import type { Mode } from "@statreel/schemas";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { MetricsPublication, ProjectWithJobs } from "../api";
import { FormatIcon } from "../components/glyphs";
import { identVar } from "../components/idents";
import { artStyle, Empty, Failure, Loading, Sparkline } from "../components/ui";
import { useMetrics, useProjects } from "../data";
import { useJobProgress } from "../events";
import { MODE_LABEL, nextAction, relTime, STAGE_LABEL, STAGES, stageIndex } from "../logic";
import { activeJob, fmtNum, formatLabel, pad2, pct, rundownOrder } from "../onair";
import type { ProjectsSearch } from "../router";

function Pips({ i }: { i: number }) {
  return (
    <span className="pips" aria-hidden="true">
      {STAGES.map((s, k) => (
        <i key={s} className={k < i ? "on" : k === i ? "now" : ""} />
      ))}
    </span>
  );
}

function Card({
  p,
  live,
  pubs,
}: {
  p: ProjectWithJobs;
  live: Map<string, { progress: number; note?: string }>;
  pubs: MetricsPublication[];
}) {
  const job = activeJob(p.jobs);
  const next = nextAction(p.status, p.jobs[0]);
  const lp = job ? live.get(job.id) : undefined;
  const progress = lp?.progress ?? job?.progress ?? 0;
  const views = pubs.flatMap((x) => x.daily.map((d) => d.views));
  const hasNumbers = views.some((v) => typeof v === "number");
  const dry = pubs.length > 0 && pubs.every((x) => x.mode === "dry");
  return (
    <Link
      to="/studio/$projectId"
      params={{ projectId: p.id }}
      className="card"
      style={artStyle(identVar(p.use_case_id))}
    >
      <span className="card__t">{p.title}</span>
      <span className="card__m">
        <span>{p.id}</span>
        <span>{p.sport}</span>
        <span>
          <FormatIcon format={p.format} h={11} /> {formatLabel(p.format)}
        </span>
        <span>{p.mode === "monetized" ? "monetized" : "non-comm."}</span>
      </span>
      <span className="card__s">
        <span className="row__stage">
          <Pips i={stageIndex(p.status)} />
          {STAGE_LABEL[p.status] ?? p.status}
        </span>
        <span className={`row__next row__next--${next.tone}`}>{next.verb}</span>
      </span>
      {job ? (
        <span className="card__job" role="status">
          <span className="bar-track">
            <span className="bar-fill" style={{ width: pct(progress) }} />
          </span>
          <span className="mono">
            {job.kind} · {job.status} · {pct(progress)}
            {lp?.note ? ` · ${lp.note}` : ""}
          </span>
        </span>
      ) : next.tone === "blocked" ? (
        <span className="card__warn">{next.hint}</span>
      ) : null}
      {pubs.length ? (
        <span className="card__met">
          {hasNumbers ? (
            <>
              <Sparkline values={views} w={120} h={24} label={`Daily views of ${p.title}`} />
              <span className="num">{fmtNum(pubs.reduce((a, x) => a + (x.views ?? 0), 0))} views</span>
            </>
          ) : (
            <span className="label">
              {dry ? "Dry-run publication · no platform numbers" : "Metrics not pulled yet"}
            </span>
          )}
        </span>
      ) : null}
      <span className="card__age">created {relTime(p.created_at)}</span>
    </Link>
  );
}

export function ProjectsPage() {
  const search = useSearch({ from: "/projects" }) as ProjectsSearch;
  const navigate = useNavigate({ from: "/projects" });
  const view = search.view ?? "board";
  const pr = useProjects();
  const met = useMetrics();
  const live = useJobProgress(null);
  const projects = rundownOrder(pr.data?.projects ?? []);
  const pubsOf = (id: string) => (met.data?.publications ?? []).filter((x) => x.project_id === id);
  const needs = projects.filter((p) => ["you", "blocked"].includes(nextAction(p.status, p.jobs[0]).tone)).length;

  return (
    <main id="main" className="page rundown-page">
      <header className="page__head">
        <div>
          <p className="eyebrow">
            <i />
            Rundown
          </p>
          <h1 className="page__title display">Every video, closest to air first</h1>
          <p className="page__sub">
            {pr.data
              ? `${projects.length} project${projects.length === 1 ? "" : "s"} · ${needs} need you`
              : "Reading the rundown"}
          </p>
        </div>
        <div className="page__tools">
          <div className="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "board"} onClick={() => void navigate({ search: {} })}>
              Board
            </button>
            <button
              type="button"
              aria-pressed={view === "list"}
              onClick={() => void navigate({ search: { view: "list" } })}
            >
              List
            </button>
          </div>
          <Link className="btn btn--primary btn--sm" to="/heatmap" search={{ mode: "monetized" }}>
            New from a Go cell
          </Link>
        </div>
      </header>

      {pr.isError ? (
        <Failure error={pr.error} what="The rundown" />
      ) : pr.isLoading ? (
        <Loading what="the rundown" />
      ) : !projects.length ? (
        <Empty title="No project yet">
          Create one from a Go cell on the <Link to="/heatmap">rights grid</Link>: open the cell, then Create project.
        </Empty>
      ) : view === "board" ? (
        <div className="board">
          {STAGES.map((s) => {
            const col = projects.filter((p) => p.status === s);
            return (
              <section className="board__col" key={s} aria-label={STAGE_LABEL[s]}>
                <h2 className="board__h">
                  <b className="num">{pad2(col.length)}</b>
                  {STAGE_LABEL[s]}
                </h2>
                {col.length ? (
                  col.map((p) => <Card key={p.id} p={p} live={live} pubs={pubsOf(p.id)} />)
                ) : (
                  <p className="board__none">Nothing here</p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Project</th>
                <th>Stage</th>
                <th>Next</th>
                <th>Sport</th>
                <th>Format</th>
                <th>Mode</th>
                <th>Job</th>
                <th>Views</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => {
                const job = activeJob(p.jobs);
                const n = nextAction(p.status, p.jobs[0]);
                const pubs = pubsOf(p.id);
                const views = pubs.some((x) => x.views !== null) ? pubs.reduce((a, x) => a + (x.views ?? 0), 0) : null;
                return (
                  <tr key={p.id} style={artStyle(identVar(p.use_case_id))}>
                    <td className="num">{pad2(i + 1)}</td>
                    <td>
                      <Link to="/studio/$projectId" params={{ projectId: p.id }} className="tbl__link">
                        {p.title}
                      </Link>
                      <span className="tbl__sub mono">{p.id}</span>
                    </td>
                    <td>{STAGE_LABEL[p.status] ?? p.status}</td>
                    <td className={`row__next--${n.tone}`}>{n.verb}</td>
                    <td>{p.sport}</td>
                    <td>{formatLabel(p.format)}</td>
                    <td>{MODE_LABEL[p.mode as Mode] ?? p.mode}</td>
                    <td className="mono">
                      {job ? `${job.kind} ${pct(live.get(job.id)?.progress ?? job.progress)}` : "—"}
                    </td>
                    <td className="num">
                      {pubs.length
                        ? views === null
                          ? pubs.every((x) => x.mode === "dry")
                            ? "— dry run"
                            : "—"
                          : fmtNum(views)
                        : "—"}
                    </td>
                    <td>{relTime(p.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

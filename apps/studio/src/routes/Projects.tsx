/**
 * 03 Rundown: every project across idea -> data ready -> scripted -> rendered -> gated -> published,
 * sorted by "needs you". Live job progress from SSE; a metrics sparkline where platform numbers
 * exist (dry-run publications have none, and say so). The board view is the race sheet (ADR 009):
 * one lane per project, six gates, the finish line at Published.
 */
import type { Mode } from "@statreel/schemas";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type CSSProperties, useState } from "react";
import type { MetricsPublication, ProjectWithJobs } from "../api";
import { Defer } from "../components/arrive";
import { Card } from "../components/Card";
import { OnTheLine } from "../components/OnTheLine";
import { Arrow, FormatIcon } from "../components/glyphs";
import { identVar } from "../components/idents";
import { artStyle, Empty, Failure, Loading } from "../components/ui";
import { useMetrics, useProjects } from "../data";
import { useJobProgress } from "../events";
import { MODE_LABEL, nextAction, relTime, STAGE_LABEL, STAGES } from "../logic";
import { activeJob, fmtNum, formatLabel, pad2, pct, rundownOrder } from "../display";
import type { ProjectsSearch } from "../router";
import { modeWord } from "../projectState";
import { byUpdated, GATE_POS, jobCell, laneState, sayLine, sheetCounts } from "../rundown";

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
    <main id="main" className="page page--cards rundown-page">
      <header className="page__head">
        <div>
          <p className="eyebrow">
            <i />
            {view === "board" ? "Rundown · the race sheet" : "Rundown"}
          </p>
          <h1 className="page__title display">
            {view === "board" && projects.length
              ? `${projects.length} lane${projects.length === 1 ? "" : "s"}, six gates`
              : "Every video, closest to air first"}
          </h1>
          <p className="page__sub">
            {pr.data
              ? `${projects.length} project${projects.length === 1 ? "" : "s"} · ${needs} need you`
              : "Reading the rundown"}
          </p>
        </div>
        <div className="page__tools">
          <div className="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "board"} onClick={() => void navigate({ search: {} })}>
              Race sheet
            </button>
            <button
              type="button"
              aria-pressed={view === "list"}
              onClick={() => void navigate({ search: { view: "list" } })}
            >
              List
            </button>
          </div>
          <Link className="btn btn--primary btn--sm" to="/heatmap" search={{ mode: "monetized", view: "feasibility" }}>
            New from a Go cell
          </Link>
        </div>
      </header>

      {pr.isError ? (
        <Failure error={pr.error} what="The rundown" onRetry={() => void pr.refetch()} retrying={pr.isFetching} />
      ) : pr.isLoading ? (
        <Loading what="the rundown" />
      ) : !projects.length ? (
        <Card>
          <Empty title="No project yet">
            Create one from a Go cell on the <Link to="/heatmap" search={{ view: "feasibility" }}>rights grid</Link>: open the cell, then Create project.
            <OnTheLine variant="panel" />
          </Empty>
        </Card>
      ) : view === "board" ? (
        <Defer tier={1} id="rundown:sheet" minHeight={360}>
          <RaceSheet projects={projects} live={live} pubsOf={pubsOf} />
        </Defer>
      ) : (
        <Defer tier={1} id="rundown:list" phClass="card" minHeight={260}>
          <Card title="Projects" tag={projects.length} pad="none">
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
                  const views = pubs.some((x) => x.views !== null)
                    ? pubs.reduce((a, x) => a + (x.views ?? 0), 0)
                    : null;
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
                        {job ? jobCell(job, live.get(job.id)?.progress ?? job.progress) : "—"}
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
          </Card>
        </Defer>
      )}
    </main>
  );
}

// ------------------------------------------------------------------ the race sheet

const cssv = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

function RaceSheet({
  projects,
  live,
  pubsOf,
}: {
  projects: ProjectWithJobs[];
  live: Map<string, { progress: number; note?: string }>;
  pubsOf: (id: string) => MetricsPublication[];
}) {
  const [sort, setSort] = useState<"needs" | "updated">("needs");
  const lanes = sort === "needs" ? projects : byUpdated(projects);
  const n = sheetCounts(projects);
  const say = sayLine(projects);
  const flagged = say.parts.some((x) => x.text.startsWith("is flagged"));
  return (
    <Card
      className="rs-view"
      title="Race sheet"
      tag={`${n.open} in progress · ${n.published} published · ${n.flagged} flagged`}
      pad="none"
      actions={
        <div className="rs-sort" role="group" aria-label="Sort lanes">
          <span className="label">Sort</span>
          <span className="seg seg--sm">
            <button type="button" aria-pressed={sort === "needs"} onClick={() => setSort("needs")}>
              Needs you next
            </button>
            <button type="button" aria-pressed={sort === "updated"} onClick={() => setSort("updated")}>
              Last updated
            </button>
          </span>
        </div>
      }
      footer={
        <div className="rs-foot">
          <span className="rs-key">
            <i className="k" aria-hidden="true" /> marker at its gate
          </span>
          <span className="rs-key">
            <i className="k k--flag" aria-hidden="true" /> flagged: the last job failed or was refused, or the gate did
            not allow the render
          </span>
          <span className="rs-key">
            <i className="k k--fin" aria-hidden="true" /> published = the finish line; v1 uploads private only
          </span>
        </div>
      }
    >
      <p className={`rs-say card__toolbar${flagged ? " is-flagged" : ""}`} role="status">
        <span>
          {say.lead}{" "}
          {say.parts.map((x) => (
            <span key={x.id}>
              <b className="mono">{x.id}</b> {x.text}.{" "}
            </span>
          ))}
        </span>
      </p>
      <div className="rs" role="table" aria-label="Projects by pipeline stage">
        <div className="rs-cols" role="row">
          <span role="columnheader">Id</span>
          <span role="columnheader">Project</span>
          <div className="rs-gates" role="columnheader" aria-label="Stage, six gates">
            {STAGES.map((s, i) => (
              <span key={s} className={i === STAGES.length - 1 ? "finish" : ""} style={{ left: `${GATE_POS(i)}%` }}>
                {STAGE_LABEL[s]}
              </span>
            ))}
          </div>
          <span role="columnheader">Next action</span>
        </div>
        {lanes.map((p) => (
          <RaceLane key={p.id} p={p} live={live} pubs={pubsOf(p.id)} />
        ))}
      </div>
    </Card>
  );
}

function RaceLane({
  p,
  live,
  pubs,
}: {
  p: ProjectWithJobs;
  live: Map<string, { progress: number; note?: string }>;
  pubs: MetricsPublication[];
}) {
  const st = laneState(p);
  const job = activeJob(p.jobs);
  const next = nextAction(p.status, p.jobs[0]);
  const lp = job ? live.get(job.id) : undefined;
  const views = pubs.some((x) => x.views !== null) ? pubs.reduce((a, x) => a + (x.views ?? 0), 0) : null;
  const dry = pubs.length > 0 && pubs.every((x) => x.mode === "dry");
  return (
    <div
      className={`rs-lane${st.done ? " is-done" : ""}${st.flagged ? " is-flagged" : ""}`}
      role="row"
      style={cssv({ "--at": `${st.at}%`, "--art": identVar(p.use_case_id) })}
    >
      <span className="rs-id mono" role="cell">
        {p.id}
      </span>
      <div className="rs-what" role="cell">
        <Link to="/studio/$projectId" params={{ projectId: p.id }} className="rs-t">
          {p.title}
        </Link>
        <span className="rs-meta mono">
          <span>{p.sport}</span>
          <span>
            <FormatIcon format={p.format} h={11} /> {formatLabel(p.format)}
          </span>
          <span>{modeWord(p.mode)}</span>
          <span>created {relTime(p.created_at)}</span>
          {st.flag ? <span className="rs-flag">{st.flag}</span> : null}
          {pubs.length ? (
            <span className="rs-pub">
              {pubs.map((x) => `${x.platform} ${x.visibility}${x.mode === "dry" ? " (dry run)" : ""}`).join(" · ")}
            </span>
          ) : null}
        </span>
      </div>
      <div
        className="rs-track"
        role="cell"
        aria-label={`${STAGE_LABEL[p.status] ?? p.status}, gate ${st.stage + 1} of ${STAGES.length}${st.flagged ? ", flagged" : ""}`}
      >
        {STAGES.map((s, i) => (
          <i key={s} className={`g${i === STAGES.length - 1 ? " finish" : ""}`} style={{ left: `${GATE_POS(i)}%` }} />
        ))}
        <i className="rail" />
        <i className="trail" />
        <i className="marker" />
      </div>
      <div className="rs-next" role="cell">
        {job ? (
          // not a live region: render progress ticks up to once per percent, and a polite region per
          // running lane would narrate every tick; the sheet's one status line says what is running
          <span className="rs-job">
            <span className="bar-track">
              <span className="bar-fill" style={{ width: pct(lp?.progress ?? job.progress) }} />
            </span>
            <span className="mono">
              {next.verb} · {pct(lp?.progress ?? job.progress)}
            </span>
          </span>
        ) : st.done ? (
          <span className="rs-done">
            <b>{views === null ? "Published" : `${fmtNum(views)} views`}</b>
            <span>
              {views === null ? (dry ? "dry run · no platform numbers" : "metrics not pulled yet") : "all publications"}
            </span>
          </span>
        ) : (
          <Link
            to="/studio/$projectId"
            params={{ projectId: p.id }}
            className={`btn btn--sm${next.tone === "you" ? " btn--primary" : ""}`}
          >
            {next.verb} <Arrow />
          </Link>
        )}
      </div>
    </div>
  );
}

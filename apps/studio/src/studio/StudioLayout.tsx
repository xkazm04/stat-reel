/**
 * Studio shell: the project header (crumb back to the Rundown, title, facts, the stage) and the
 * tab strip over the two compose screens: Control room and Render & gate. The stage is
 * the race track with six gates and a marker (published = the finish line, ADR 009). Publishing
 * moved to the Calendar (ADR 006).
 */
import type { Mode } from "@statreel/schemas";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ApiError } from "../api";
import { FormatIcon } from "../components/glyphs";
import { identVar } from "../components/idents";
import { artStyle, Empty, Failure, Loading } from "../components/ui";
import { MODE_LABEL, relTime, STAGE_LABEL, STAGES, stageIndex } from "../logic";
import { fmtDuration, formatLabel } from "../display";
import { useStudio } from "./shared";

export function StudioLayout() {
  const { projectId, q, detail, usecase } = useStudio();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (q.isLoading)
    return (
      <main id="main" className="page">
        <Loading what={`project ${projectId}`} />
      </main>
    );
  if (q.isError || !detail) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <main id="main" className="page">
        {missing ? (
          <Empty title={`No project ${projectId}`}>
            It is not in this studio's database. <Link to="/projects">Open the rundown</Link>.
          </Empty>
        ) : (
          <Failure error={q.error} what={`Project ${projectId}`} onRetry={() => void q.refetch()} retrying={q.isFetching} />
        )}
      </main>
    );
  }
  const p = detail.project;
  const si = stageIndex(p.status);
  const tab = path.endsWith("/render") ? "render" : "room";
  const timing = detail.props?.props.timing;
  const stageWord = STAGE_LABEL[p.status] ?? p.status;
  return (
    <main id="main" className={`studio studio--${tab}`} style={artStyle(identVar(p.use_case_id))}>
      <header className="wk-head">
        <div className="wk-top">
          <nav className="wk-crumbs" aria-label="Where you are">
            <Link to="/projects" className="wk-crumb">
              Rundown
            </Link>
            <span className="wk-sep" aria-hidden="true" />
            <span aria-current="page">{p.id}</span>
          </nav>
          <h1 className="wk-title">{p.title}</h1>
          <div className="wk-k">
            <span className="wk-tag">{usecase?.name ?? p.use_case_id}</span>
            <span className="wk-tag">{p.sport}</span>
            <span className="wk-tag">
              <FormatIcon format={p.format} h={11} /> {formatLabel(p.format)}
            </span>
            <span className="wk-tag">{MODE_LABEL[p.mode as Mode] ?? p.mode}</span>
            <span className="wk-tag">{timing ? fmtDuration(timing.duration_s) : "no length yet"}</span>
            <span className="wk-tag wk-tag--quiet">created {relTime(p.created_at)}</span>
          </div>
        </div>
        <div className="wk-stage">
          <div
            className={`race${p.status === "published" ? " is-done" : ""}`}
            role="img"
            aria-label={`Stage: ${stageWord}, gate ${si + 1} of ${STAGES.length}`}
            style={{ ["--stage" as string]: si }}
          >
            <span className="race__track" aria-hidden="true">
              {STAGES.map((s, i) => (
                <i key={s} className={`race__g${i === STAGES.length - 1 ? " race__g--fin" : ""}`} style={{ left: `${((i + 0.5) / STAGES.length) * 100}%` }} />
              ))}
              <span className="race__trail" />
              <span className="race__marker" />
            </span>
            <b className="race__word">{stageWord}</b>
          </div>
        </div>
        <nav className="tabs" aria-label="Studio screens">
          <Link
            to="/studio/$projectId"
            params={{ projectId }}
            activeOptions={{ exact: true }}
            aria-current={tab === "room" ? "page" : undefined}
          >
            Control room
          </Link>
          <Link
            to="/studio/$projectId/render"
            params={{ projectId }}
            aria-current={tab === "render" ? "page" : undefined}
          >
            Render &amp; gate
          </Link>
        </nav>
      </header>
      <Outlet />
    </main>
  );
}

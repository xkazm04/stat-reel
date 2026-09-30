/** Studio shell: the project header (ident, title, facts, stage stepper) and the tab strip over three screens. */
import type { Mode } from "@statreel/schemas";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ApiError } from "../api";
import { FormatIcon } from "../components/glyphs";
import { identVar } from "../components/idents";
import { artStyle, Empty, Failure, Loading } from "../components/ui";
import { MODE_LABEL, relTime, STAGE_LABEL, STAGES, stageIndex } from "../logic";
import { formatLabel } from "../onair";
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
          <Failure error={q.error} what={`Project ${projectId}`} />
        )}
      </main>
    );
  }
  const p = detail.project;
  const si = stageIndex(p.status);
  const tab = path.endsWith("/render") ? "render" : path.endsWith("/publish") ? "publish" : "room";
  return (
    <main id="main" className="studio" style={artStyle(identVar(p.use_case_id))}>
      <header className="wk-head">
        <div className="wk-top">
          <div className="wk-k">
            <Link to="/projects" className="wk-crumb">
              Rundown
            </Link>
            <b>{p.id}</b>
            <span>{usecase?.name ?? p.use_case_id}</span>
            <span>{p.sport}</span>
            <span>
              <FormatIcon format={p.format} h={11} /> {formatLabel(p.format)}
            </span>
            <span>{MODE_LABEL[p.mode as Mode] ?? p.mode}</span>
            <span>created {relTime(p.created_at)}</span>
          </div>
          <h1 className="wk-title">{p.title}</h1>
        </div>
        <div
          className="stepper"
          role="img"
          aria-label={`Stage: ${STAGE_LABEL[p.status] ?? p.status}, ${si + 1} of ${STAGES.length}`}
        >
          {STAGES.map((s, i) => (
            <span key={s} className={`step ${i < si ? "done" : i === si ? "now" : ""}`}>
              <b>{i + 1}</b>
              {STAGE_LABEL[s]}
            </span>
          ))}
        </div>
        <nav className="tabs" aria-label="Studio screens">
          <Link to="/studio/$projectId" params={{ projectId }} aria-current={tab === "room" ? "page" : undefined}>
            Control room
          </Link>
          <Link
            to="/studio/$projectId/render"
            params={{ projectId }}
            aria-current={tab === "render" ? "page" : undefined}
          >
            Render &amp; gate
          </Link>
          <Link
            to="/studio/$projectId/publish"
            params={{ projectId }}
            aria-current={tab === "publish" ? "page" : undefined}
          >
            Publish
          </Link>
        </nav>
      </header>
      <Outlet />
    </main>
  );
}

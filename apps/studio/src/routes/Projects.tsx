/** Projects (A/3 sequencer): every project across the six stages, with its next action. */
import type { ProjectStatus } from "@statreel/schemas";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { api, type ProjectWithJobs, qk } from "../api";
import { FormatGlyph, Led, Screws } from "../components/glyphs";
import { ErrorState, Loading, Toggle } from "../components/ui";
import { useJobProgress } from "../events";
import { MODE_LABEL, nextAction, relTime, STAGE_LABEL, STAGE_SHORT, STAGES, stageIndex } from "../logic";

const PRIORITY: Record<string, number> = { blocked: 0, you: 1, wait: 2, done: 3 };

export function ProjectsPage() {
  const q = useQuery({ queryKey: qk.projects, queryFn: api.projects });
  const navigate = useNavigate();
  const [sort, setSort] = useState<"needs" | "recent">("needs");
  const [filter, setFilter] = useState<ProjectStatus | null>(null);
  const live = useJobProgress(null);
  const list = q.data?.projects ?? [];

  const rows = useMemo(() => {
    const withAction = list.map((p) => {
      const job = p.jobs[0];
      const lp = job ? live.get(job.id) : undefined;
      return { p, action: nextAction(p.status, job ? { ...job, progress: lp?.progress ?? job.progress } : null) };
    });
    return withAction
      .filter((r) => !filter || r.p.status === filter)
      .sort(
        (a, b) =>
          (sort === "needs" ? (PRIORITY[a.action.tone] ?? 9) - (PRIORITY[b.action.tone] ?? 9) : 0) ||
          b.p.created_at.localeCompare(a.p.created_at),
      );
  }, [list, filter, sort, live]);

  const counts = Object.fromEntries(STAGES.map((s) => [s, list.filter((p) => p.status === s).length])) as Record<
    ProjectStatus,
    number
  >;
  const need = rows.filter((r) => r.action.tone === "you" || r.action.tone === "blocked").length;

  return (
    <main id="main" className="page wrap projects-page">
      <section className="module seq" aria-labelledby="seq-title">
        <Screws at={["tl", "bl"]} />
        <div className="seq-top">
          <h1 id="seq-title">Projects</h1>
          <span className="mono muted">idea → data ready → scripted → rendered → gated → published</span>
          <span className="spacer" />
          <Toggle
            title="Sort"
            label="Sort projects"
            value={sort}
            onChange={setSort}
            options={[
              { value: "needs", label: "Needs you" },
              { value: "recent", label: "Recent" },
            ]}
          />
        </div>
        {q.isError ? (
          <ErrorState error={q.error} what="Projects" />
        ) : q.isLoading ? (
          <Loading what="Reading projects…" />
        ) : (
          <>
            <div className="seq-grid seq-head">
              <span className="lab">Project · sport · frame · mode</span>
              {STAGES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="stagebtn"
                  aria-pressed={filter === s}
                  aria-label={`${STAGE_LABEL[s]}: ${counts[s]} projects. Filter`}
                  onClick={() => setFilter(filter === s ? null : s)}
                  data-testid={`stage-filter-${s}`}
                >
                  <span className="display-num">{counts[s]}</span>
                  <span className="sn">{STAGE_SHORT[s]}</span>
                </button>
              ))}
              <span className="lab lab-next">Next action</span>
            </div>
            <ul className="seq-rows" aria-label="Projects in the sequencer">
              {rows.map(({ p, action }) => (
                <SeqRow
                  key={p.id}
                  p={p}
                  action={action}
                  onOpen={() => void navigate({ to: "/studio/$projectId", params: { projectId: p.id } })}
                />
              ))}
              {!rows.length ? (
                <li className="display empty">
                  {filter ? (
                    <>
                      No project at stage <b>{STAGE_LABEL[filter]}</b>.{" "}
                      <button type="button" className="key small" onClick={() => setFilter(null)}>
                        Show all
                      </button>
                    </>
                  ) : (
                    <>
                      <b>No projects yet.</b> Open the <Link to="/heatmap">heatmap</Link>, select a GO cell and press
                      Create project.
                    </>
                  )}
                </li>
              ) : null}
            </ul>
            <div className="seq-foot">
              <span>
                <b className="accent-ink">{need}</b> need you · {counts.published} published · {list.length} total
              </span>
              {filter ? (
                <span className="filterchip">
                  stage = {STAGE_LABEL[filter]}{" "}
                  <button type="button" className="key small" onClick={() => setFilter(null)}>
                    clear
                  </button>
                </span>
              ) : null}
              <span className="spacer" />
              <span className="mono">publishing: private / draft only</span>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function SeqRow({
  p,
  action,
  onOpen,
}: {
  p: ProjectWithJobs;
  action: ReturnType<typeof nextAction>;
  onOpen: () => void;
}) {
  const i = stageIndex(p.status);
  const job = p.jobs[0];
  return (
    <li className="srow-li">
      <div className="srow seq-grid" data-testid={`project-row-${p.id}`}>
        <span className="tt">
          <Link to="/studio/$projectId" params={{ projectId: p.id }} className="t">
            {p.title}
          </Link>
          <span className="m">
            <span>{p.id}</span>
            <span>{p.sport}</span>
            <FormatGlyph format={p.format} />
            <span>{MODE_LABEL[p.mode as keyof typeof MODE_LABEL] ?? p.mode}</span>
            <span>created {relTime(p.created_at)}</span>
          </span>
        </span>
        {STAGES.map((s, k) => (
          <span
            key={s}
            className={`step${k <= i ? " lit" : ""}${k === i ? " head" : ""}${k === i && action.tone === "wait" ? " act" : ""}${k === i && action.tone === "blocked" ? " refused" : ""}${p.status === "published" ? " pub" : ""}`}
            aria-hidden="true"
          >
            <i />
          </span>
        ))}
        <span className="gl">
          <span className="sr-only">Stage {STAGE_LABEL[p.status] ?? p.status}. </span>
          <span className="stage-now">
            <Led
              status={
                action.tone === "done"
                  ? "pass"
                  : action.tone === "blocked"
                    ? "refuse"
                    : action.tone === "wait"
                      ? "running"
                      : "idle"
              }
              label={(STAGE_LABEL[p.status] ?? p.status).toUpperCase()}
              className="on-display"
            />
          </span>
          <button type="button" className={`act act-${action.tone}`} onClick={onOpen}>
            {action.verb} →
          </button>
          <span className="hint">{action.hint}</span>
          {job && job.status !== "succeeded" && action.tone !== "wait" && action.tone !== "blocked" ? (
            <span className="hint">
              last job: {job.kind} {job.status}
            </span>
          ) : null}
        </span>
      </div>
    </li>
  );
}

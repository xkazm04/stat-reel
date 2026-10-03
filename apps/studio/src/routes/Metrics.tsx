/**
 * 06 Metrics: cross-channel numbers from GET /api/metrics, per publication, per use case, per
 * sport. Nulls are "—"; dry-run publications are labelled (nothing was uploaded, so there are no
 * platform numbers). Refresh enqueues the metrics job.
 */
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, errorText, type MetricsGroup } from "../api";
import { Defer } from "../components/arrive";
import { identVar } from "../components/idents";
import { artStyle, Empty, Failure, Loading, Sparkline } from "../components/ui";
import { useHeatmap, useMetrics } from "../data";
import { useEvents } from "../events";
import { relTime } from "../logic";
import { fmtDuration, fmtNum } from "../display";

function Bars({ title, groups, nameOf }: { title: string; groups: MetricsGroup[]; nameOf: (k: string) => string }) {
  const max = Math.max(0, ...groups.map((g) => g.views ?? 0));
  return (
    <section className="panel">
      <h2 className="sec-h">
        <span>{title}</span>
        <span>views</span>
      </h2>
      {groups.length ? (
        <ul className="bars">
          {groups.map((g) => (
            <li key={g.key} style={artStyle(identVar(g.key))}>
              <span className="bars__k">{nameOf(g.key)}</span>
              <span className="bars__track">
                {g.views !== null && max > 0 ? (
                  <span className="bars__fill" style={{ width: `${(g.views / max) * 100}%` }} />
                ) : null}
              </span>
              <span className="bars__v num">{fmtNum(g.views)}</span>
              <span className="bars__n">
                {g.publications} publication{g.publications === 1 ? "" : "s"}
                {g.views === null ? " · no platform numbers" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sum-p">Nothing published yet.</p>
      )}
    </section>
  );
}

export function MetricsPage() {
  const met = useMetrics();
  const hm = useHeatmap();
  const [jobId, setJobId] = useState<string | null>(null);
  const done = useEvents(
    (e) =>
      !!jobId && e.id === jobId && e.type !== "job.progress" && e.type !== "job.queued" && e.type !== "job.started",
  );
  const last = done.at(-1);
  const note = last
    ? ((last.result as { note?: string; pulled?: number } | null)?.note ??
      (last.error
        ? `${last.type.replace("job.", "")}: ${last.error}`
        : `pulled ${(last.result as { pulled?: number } | null)?.pulled ?? 0}`))
    : null;
  const refresh = useMutation({ mutationFn: api.refreshMetrics, onSuccess: (r) => setJobId(r.job_id) });
  const pubs = met.data?.publications ?? [];
  const ucName = (id: string) => hm.data?.usecases.find((u) => u.id === id)?.name ?? id;
  const allDry = pubs.length > 0 && pubs.every((p) => p.mode === "dry");

  return (
    <main id="main" className="page metrics-page">
      <header className="page__head">
        <div>
          <p className="eyebrow">
            <i />
            Metrics · cross-channel
          </p>
          <h1 className="page__title display">The numbers, where they exist</h1>
          <p className="page__sub">
            {allDry
              ? "Publishing runs dry until the Google app exists, so there are no platform numbers yet."
              : "Views, watch time, likes, comments and shares per publication; unavailable fields stay empty."}
          </p>
        </div>
        <div className="page__tools">
          <button type="button" className="btn btn--sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            {refresh.isPending ? "Queueing" : "Refresh"}
          </button>
          <span className="page__note" role="status">
            {refresh.isError
              ? `Refresh failed: ${errorText(refresh.error)}`
              : note
                ? `Metrics job: ${note}`
                : jobId
                  ? "Metrics job queued"
                  : ""}
          </span>
        </div>
      </header>

      {met.isError ? (
        <Failure error={met.error} what="Metrics" onRetry={() => void met.refetch()} retrying={met.isFetching} />
      ) : met.isLoading ? (
        <Loading what="metrics" />
      ) : !pubs.length ? (
        <Empty title="No publication yet">
          Metrics start with a publication. Publishing runs dry until the Google app exists, so even then there are no
          platform numbers. See the <Link to="/projects">rundown</Link> for what is close to air.
        </Empty>
      ) : (
        <>
          <Defer tier={1} id="metrics:table" phClass="table-wrap" minHeight={220}>
            <div className="table-wrap">
              <table className="tbl tbl--metrics">
                <thead>
                  <tr>
                    <th>Publication</th>
                    <th>Platform</th>
                    <th>Visibility</th>
                    <th className="num">Views</th>
                    <th className="num">Avg view</th>
                    <th className="num">Watch time</th>
                    <th className="num">Likes</th>
                    <th className="num">Comments</th>
                    <th className="num">Shares</th>
                    <th className="num">Subs ±</th>
                    <th>Daily views</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {pubs.map((p) => (
                    <tr key={p.publication_id} style={artStyle(identVar(p.use_case_id))}>
                      <td>
                        <Link to="/studio/$projectId" params={{ projectId: p.project_id }} className="tbl__link">
                          {p.title}
                        </Link>
                        <span className="tbl__sub mono">
                          {p.external_id ?? "no id"} · {relTime(p.published_at)}
                        </span>
                      </td>
                      <td>{p.platform}</td>
                      <td>
                        <span className="pub pub--private">
                          <i />
                          {p.visibility}
                        </span>
                        {p.mode === "dry" ? <span className="dry">DRY RUN</span> : null}
                      </td>
                      <td className="num">{fmtNum(p.views)}</td>
                      <td className="num">
                        {p.avg_view_duration_s === null ? "—" : fmtDuration(p.avg_view_duration_s)}
                      </td>
                      <td className="num">
                        {p.watch_time_s === null ? "—" : `${fmtNum(Math.round(p.watch_time_s / 60))} min`}
                      </td>
                      <td className="num">{fmtNum(p.likes)}</td>
                      <td className="num">{fmtNum(p.comments)}</td>
                      <td className="num">{fmtNum(p.shares)}</td>
                      <td className="num">{fmtNum(p.subs_delta)}</td>
                      <td>
                        <Sparkline
                          values={p.daily.map((d) => d.views)}
                          w={100}
                          h={22}
                          label={`Daily views, ${p.daily.length} days`}
                        />
                      </td>
                      <td className="tbl__note">{p.data}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Defer>
          <Defer tier={2} id="metrics:bars" visible phClass="metrics-grid" minHeight={180}>
            <div className="metrics-grid">
              <Bars title="Per use case" groups={met.data?.by_use_case ?? []} nameOf={ucName} />
              <Bars title="Per sport" groups={met.data?.by_sport ?? []} nameOf={(k) => k} />
            </div>
          </Defer>
          <p className="page__foot">
            Retention curves are not pulled yet (DESIGN §6.7): they appear once live publications exist and the metrics
            job stores them.
          </p>
        </>
      )}
    </main>
  );
}

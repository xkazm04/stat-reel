/**
 * Render & Gate (job progress over SSE, latest render, checks, policy verdict with every deny
 * reason verbatim) and Publish (private only in v1; publication status with the dry-run marker).
 */
import type { UseCase } from "@statreel/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorText, type Job, type PolicyVerdict, type ProjectDetail, parseJson, qk } from "../api";
import { Led } from "../components/glyphs";
import { Module, ProgressBar } from "../components/ui";
import { checkRows, fileUrl, relTime } from "../logic";

const PIPE_KINDS = new Set(["audio", "render", "publish"]);
const ACTIVE = new Set(["queued", "running"]);

export function RenderGatePanel({
  detail,
  usecase,
  progress,
}: {
  detail: ProjectDetail;
  usecase: UseCase | undefined;
  progress: Map<string, { progress: number; note?: string }>;
}) {
  const jobs = detail.jobs.filter((j) => PIPE_KINDS.has(j.kind) && j.kind !== "publish");
  const active = jobs.filter((j) => ACTIVE.has(j.status));
  const render = detail.renders[0];
  const lastDone = jobs.find((j) => !ACTIVE.has(j.status));
  const failure =
    lastDone &&
    (lastDone.status === "failed" || lastDone.status === "refused") &&
    (!render || lastDone.created_at > render.created_at)
      ? lastDone
      : null;
  const policy = parseJson<PolicyVerdict>(render?.policy_json);
  const checks = parseJson<Record<string, unknown>>(render?.checks_json) ?? {};
  const rows = render ? checkRows(checks, render.format, usecase?.duration_s) : [];
  const video = fileUrl(render?.url ?? render?.path);
  const dir = fileUrl(render?.dir_url);

  return (
    <Module
      id="m-gate"
      title="Render & gate"
      tag="audio → render → checks → manifest → OPA gate"
      className="mod gate-mod-studio"
    >
      {active.length ? (
        <div className="jobs" aria-live="polite" data-testid="produce-progress">
          {active.map((j) => (
            <JobRow key={j.id} job={j} live={progress.get(j.id)} />
          ))}
        </div>
      ) : null}
      {failure ? (
        <div className="errbox" role="alert" data-testid="produce-failure">
          <Led
            status={failure.status === "refused" ? "refuse" : "fail"}
            label={`${failure.kind.toUpperCase()} ${failure.status.toUpperCase()}`}
          />
          <span className="mono">{failure.error ?? "no error text"}</span>
        </div>
      ) : null}

      {!render ? (
        <div className="display empty">
          <b>No render yet.</b> Produce runs the audio stage, renders the composition, masters to −14 LUFS, checks the
          file, writes the provenance manifest and asks the publish gate.
        </div>
      ) : (
        <div className="render-grid">
          <div className="render-video">
            {video ? (
              // biome-ignore lint/a11y/useMediaCaption: burned-in captions + sidecar SRT/VTT links below
              <video
                src={video}
                poster={dir ? `${dir}/thumb.png` : undefined}
                controls
                preload="metadata"
                className={render.format === "landscape" ? "l" : "v"}
                data-testid="render-video"
              />
            ) : (
              <div className="display empty">Render file path not servable: {render.path}</div>
            )}
            <p className="mono muted">
              {render.format} · {relTime(render.created_at)}
              {dir ? (
                <>
                  {" · "}
                  <a href={`${dir}/captions.srt`}>captions.srt</a> · <a href={`${dir}/captions.vtt`}>captions.vtt</a> ·{" "}
                  <a href={`${dir}/manifest.json`}>manifest.json</a>
                </>
              ) : null}
            </p>
          </div>
          <div>
            <h4 className="subhead">Checks</h4>
            <table className="ctable" data-testid="render-checks">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row">{r.label}</th>
                    <td className="numc mono">{r.value}</td>
                    <td className="mono muted">{r.target ?? ""}</td>
                    <td>
                      {r.ok === null ? (
                        <span className="muted mono">info</span>
                      ) : (
                        <Led status={r.ok ? "pass" : "fail"} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h4 className="subhead">Publish gate</h4>
      <div data-testid="policy-verdict" className="verdict">
        {!render ? (
          <div className="display gate-lamp">
            <Led status="idle" label="NO VERDICT" />
            <p>The gate runs after the render, on the provenance manifest.</p>
          </div>
        ) : !policy ? (
          <div className="display gate-lamp">
            <Led status="ask" label="NO VERDICT" />
            <p>This render has no stored verdict.</p>
          </div>
        ) : (
          <>
            <div className={`display gate-lamp ${policy.allow ? "allow" : "deny"}`}>
              <Led status={policy.allow ? "pass" : "refuse"} label={policy.allow ? "ALLOW" : "DENY"} />
              <p>
                {policy.allow
                  ? "Every rule passed for "
                  : `${policy.deny.length} deny reason${policy.deny.length === 1 ? "" : "s"} for `}
                {policy.target
                  ? `${policy.target.platform} · ${policy.target.monetized ? "monetized" : "non-commercial"} · AI disclosure ${policy.target.ai_disclosure ? "on" : "off"}`
                  : "the target"}
                .
              </p>
            </div>
            {policy.deny.length ? (
              <ul className="reasons deny">
                {policy.deny.map((d) => (
                  <li key={d}>
                    <Led status="refuse" label="DENY" /> <span>{d}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {policy.warn?.length ? (
              <ul className="reasons warn">
                {policy.warn.map((w) => (
                  <li key={w}>
                    <Led status="ask" label="WARN" /> <span>{w}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="legend checks-run-lab">checks_run · {policy.checks_run.length}</p>
            <div className="checks-run">
              {policy.checks_run.map((c) => (
                <span key={c} className="kind-pin">
                  {c}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </Module>
  );
}

function JobRow({ job, live }: { job: Job; live?: { progress: number; note?: string } }) {
  const p = live?.progress ?? job.progress ?? 0;
  return (
    <div className="job">
      <span className="job-kind">{job.kind}</span>
      <Led status="running" label={job.status.toUpperCase()} />
      <ProgressBar value={p} label={`${job.kind} progress`} />
      <span className="mono job-pct">
        {Math.round(p * 100)} %{live?.note ? ` · ${live.note}` : ""}
      </span>
      <button type="button" className="key small" onClick={() => void api.cancelJob(job.id)}>
        Cancel
      </button>
    </div>
  );
}

export function PublishPanel({
  detail,
  progress,
}: {
  detail: ProjectDetail;
  progress: Map<string, { progress: number; note?: string }>;
}) {
  const qc = useQueryClient();
  const pid = detail.project.id;
  const props = detail.props?.props;
  const [title, setTitle] = useState(props?.title ?? detail.project.title);
  const [description, setDescription] = useState(props ? `${props.title}. ${props.method_note}` : detail.project.title);
  const [tags, setTags] = useState(`${detail.project.sport}, data, sports analytics`);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched || !props) return;
    setTitle(props.title);
    setDescription(`${props.title}. ${props.method_note}`);
  }, [props, touched]);

  const render = detail.renders[0];
  const policy = parseJson<PolicyVerdict>(render?.policy_json);
  const gateAllows =
    policy?.allow === true || detail.project.status === "gated" || detail.project.status === "published";
  const pubJob = detail.jobs.find((j) => j.kind === "publish");
  const running = !!pubJob && ACTIVE.has(pubJob.status);
  const publish = useMutation({
    mutationFn: () =>
      api.publish(pid, {
        platform: "youtube",
        title: title.trim(),
        description: description.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.project(pid) }),
  });
  const already = detail.publications.some((p) => p.render_id === render?.id);
  const why = !render
    ? "Produce a render first."
    : already
      ? "This render is already uploaded (see status below); produce a new render to publish again."
      : !gateAllows
        ? "The publish gate denies this render: fix the deny reasons first."
        : running
          ? "Publishing…"
          : null;
  const pubs = [...detail.publications].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));

  return (
    <Module id="m-publish" title="Publish" tag="YouTube · private upload" className="mod publish-mod">
      <div className="private-note">
        <Led status="ask" label="PRIVATE ONLY" />
        <p>
          v1 publishes <b>private</b> only: the video is uploaded private with the synthetic-media flag and captions.
          Making it public needs the owner's explicit approval, on the platform.
        </p>
      </div>
      <form
        className="pubform"
        onSubmit={(e) => {
          e.preventDefault();
          publish.mutate();
        }}
      >
        <label>
          <span className="legend">Title</span>
          <input
            value={title}
            maxLength={100}
            onChange={(e) => {
              setTouched(true);
              setTitle(e.target.value);
            }}
          />
        </label>
        <label>
          <span className="legend">Description</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => {
              setTouched(true);
              setDescription(e.target.value);
            }}
          />
        </label>
        <label>
          <span className="legend">Tags · comma-separated</span>
          <input
            value={tags}
            onChange={(e) => {
              setTouched(true);
              setTags(e.target.value);
            }}
          />
        </label>
        <p className="mono muted">
          Attribution, the method note and the AI-narration disclosure are appended by the server.
        </p>
        <div className="row-actions">
          <button
            type="submit"
            className="key primary"
            disabled={!!why || publish.isPending || !title.trim()}
            data-testid="publish"
          >
            {publish.isPending || running ? "Publishing…" : "Publish private → YouTube"}
          </button>
          {why ? <span className="mono muted">{why}</span> : null}
        </div>
      </form>
      {publish.isError ? (
        <div className="errbox" role="alert">
          <Led status="blocked" label="ERROR" />
          <span className="mono">{errorText(publish.error)}</span>
        </div>
      ) : null}
      {pubJob && (pubJob.status === "failed" || pubJob.status === "refused") ? (
        <div className="errbox" role="alert">
          <Led
            status={pubJob.status === "refused" ? "refuse" : "fail"}
            label={`PUBLISH ${pubJob.status.toUpperCase()}`}
          />
          <span className="mono">{pubJob.error}</span>
        </div>
      ) : null}
      <h4 className="subhead">Publication status</h4>
      <div data-testid="publication-status" aria-live="polite">
        {running && pubJob ? (
          <div className="job">
            <span className="job-kind">upload</span>
            <Led status="running" label={pubJob.status.toUpperCase()} />
            <ProgressBar value={progress.get(pubJob.id)?.progress ?? pubJob.progress} label="upload progress" />
            <span className="mono job-pct">{progress.get(pubJob.id)?.note ?? ""}</span>
          </div>
        ) : null}
        {pubs.length ? (
          <ul className="pubs">
            {pubs.map((p) => (
              <li key={p.id}>
                <span className="plat-name">{p.platform}</span>
                <span className="vis">{p.visibility.toUpperCase()}</span>
                <Led status="pass" label={p.status.toUpperCase()} />
                {p.mode === "dry" ? <span className="dry-tag">DRY RUN · nothing uploaded</span> : null}
                <span className="mono muted">
                  {p.external_id ? `id ${p.external_id}` : "no external id"} · {relTime(p.published_at)}
                </span>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer noopener">
                    open on {p.platform}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : !running ? (
          <p className="mono muted">Not published yet.</p>
        ) : null}
      </div>
    </Module>
  );
}

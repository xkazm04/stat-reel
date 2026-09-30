/**
 * 04 Control room: props (left), programme monitor (centre), co-pilot (right), tracks (bottom) and
 * the stage bar: Produce (audio -> render -> checks -> manifest -> gate), the gate verdict and a
 * private publish with defaults (the Publish tab has the full form).
 */
import type { PlayerRef } from "@remotion/player";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { api, errorText, qk } from "../api";
import { Arrow } from "../components/glyphs";
import type { PlayerMeta } from "../components/Programme";
import { latestRender, renderPolicy } from "../data";
import { nextAction } from "../logic";
import { Copilot } from "./Copilot";
import { Monitor } from "./Monitor";
import { PropsPanel } from "./PropsPanel";
import { JobError, JobLine, lastJobOf, PublicationStatus, produceJob, publishJob, useStudio, Verdict } from "./shared";
import { Tracks } from "./Tracks";

export function ControlRoom() {
  const { detail, usecase, heatmap } = useStudio();
  const qc = useQueryClient();
  const playerRef = useRef<PlayerRef>(null);
  const [meta, setMeta] = useState<PlayerMeta | null>(null);
  const onMeta = useCallback((m: PlayerMeta | null) => setMeta(m), []);
  const pid = detail?.project.id ?? "";

  const produce = useMutation({
    mutationFn: () =>
      api.produce(pid, { platform: "youtube", monetized: detail?.project.mode === "monetized", ai_disclosure: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.project(pid) }),
  });
  const publish = useMutation({
    mutationFn: () => {
      const title = (detail?.props?.props.title ?? detail?.project.title ?? "").slice(0, 100);
      return api.publish(pid, {
        platform: "youtube",
        title,
        description: title,
        tags: [detail?.project.sport ?? "", "data"].filter(Boolean),
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.project(pid) }),
  });

  if (!detail) return null;
  const props = detail.props?.props ?? null;
  const running = produceJob(detail);
  const pubRunning = publishJob(detail);
  const llm = detail.jobs.find((j) => j.kind === "llm" && (j.status === "queued" || j.status === "running"));
  const render = latestRender(detail);
  const policy = renderPolicy(render);
  const canProduce = !!props && !!detail.script && !running && !llm;
  const canPublish = !!policy?.allow && !running && !pubRunning && !detail.publications.length;
  const next = nextAction(detail.project.status, detail.jobs[0]);

  return (
    <div className="room-wrap">
      <div className="stagebar">
        <div className="stagebar__next">
          <span className="label">Next</span>
          <b className={`next next--${next.tone}`}>{next.verb}</b>
          <span className="stagebar__hint">{next.hint}</span>
        </div>
        <div className="stagebar__produce">
          <button
            type="button"
            className="btn btn--primary"
            data-testid="produce"
            onClick={() => produce.mutate()}
            disabled={!canProduce || produce.isPending}
          >
            {running ? "Producing" : render ? "Produce again" : "Produce"}
          </button>
          {running ? <JobLine job={running} projectId={pid} /> : null}
          {!props || !detail.script ? <span className="stagebar__hint">needs props and a script first</span> : null}
          {produce.isError ? <span className="joberr">{errorText(produce.error)}</span> : null}
        </div>
        <div className="stagebar__gate">
          <span className="label">Gate</span>
          <Verdict detail={detail} />
          {policy && !running ? (
            <Link to="/studio/$projectId/render" params={{ projectId: pid }} className="stagebar__a">
              {policy.allow
                ? `${policy.checks_run.length} checks`
                : `${policy.deny.length} deny reason${policy.deny.length === 1 ? "" : "s"}`}{" "}
              <Arrow />
            </Link>
          ) : null}
        </div>
        <div className="stagebar__pub">
          <button
            type="button"
            className="btn btn--sm"
            data-testid="publish"
            onClick={() => publish.mutate()}
            disabled={!canPublish || publish.isPending}
          >
            {pubRunning ? "Publishing" : "Publish private"}
          </button>
          <PublicationStatus detail={detail} />
          {publish.isError ? <span className="joberr">{errorText(publish.error)}</span> : null}
        </div>
      </div>
      <JobError job={lastJobOf(detail, ["audio", "render", "publish"])} />
      {policy && !policy.allow && !running ? (
        <ul className="deny-inline" role="alert">
          {policy.deny.map((d) => (
            <li key={d} className="mono">
              {d}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="room">
        <PropsPanel detail={detail} usecase={usecase} cells={heatmap?.cells ?? []} />
        <Monitor
          props={props}
          compositionName={usecase?.composition}
          playerRef={playerRef}
          meta={meta}
          onMeta={onMeta}
        />
        <Copilot detail={detail} />
        <Tracks props={props} playerRef={playerRef} meta={meta} />
      </div>
    </div>
  );
}

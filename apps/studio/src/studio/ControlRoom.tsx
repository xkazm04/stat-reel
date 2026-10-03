/**
 * 04 Control room: compose only (ADR 006). The stage bar (next action, Produce: audio -> render ->
 * checks -> manifest -> gate, the gate verdict, the Script key, and "Schedule in Calendar" once the
 * gate allows); parametrisation on the left (use case, dataset, props form + JSON), the programme
 * monitor as the centred main content, the co-pilot on the right, and the tracks across the full
 * width at the bottom. The script opens as a modal. Publishing lives in the Calendar.
 */
import type { PlayerRef } from "@remotion/player";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { api, errorText, qk } from "../api";
import { Defer } from "../components/arrive";
import { Arrow } from "../components/glyphs";
import type { PlayerMeta } from "../components/Programme";
import { latestRender, renderPolicy } from "../data";
import { nextAction } from "../logic";
import { useComposition } from "../composition";
import { canCancelJob, canSchedule, compositionState, produceBlockReason, sceneSpans } from "../studio-logic";
import { Copilot } from "./Copilot";
import { Monitor } from "./Monitor";
import { usePlayerClock } from "./playerClock";
import { PropsPanel } from "./PropsPanel";
import { JobError, JobLine, lastJobOf, PublicationStatus, produceJob, useStudio, Verdict } from "./shared";
import { Tracks } from "./Tracks";

const ScriptModal = lazy(() => import("./ScriptModal").then((m) => ({ default: m.ScriptModal })));

export function ControlRoom() {
  const { detail, usecase, heatmap } = useStudio();
  const qc = useQueryClient();
  const playerRef = useRef<PlayerRef>(null);
  const [meta, setMeta] = useState<PlayerMeta | null>(null);
  const onMeta = useCallback((m: PlayerMeta | null) => setMeta(m), []);
  const clock = usePlayerClock(playerRef, meta);
  const [script, setScript] = useState<{ open: boolean; at: string | null }>({ open: false, at: null });
  const pid = detail?.project.id ?? "";

  const produce = useMutation({
    mutationFn: () =>
      api.produce(pid, { platform: "youtube", monetized: detail?.project.mode === "monetized", ai_disclosure: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.project(pid) }),
  });

  // stop the running audio/render job; job.* SSE events (events.ts) refresh the project, so no manual invalidate
  const cancel = useMutation({ mutationFn: (jobId: string) => api.cancelJob(jobId) });

  const comp = useComposition();
  const cstate = compositionState(usecase?.composition, comp.status);
  const blockReason = produceBlockReason(cstate);

  const props = detail?.props?.props ?? null;
  const duration = props?.timing?.duration_s ?? (meta ? meta.durationInFrames / meta.fps : 0);
  const spans = useMemo(
    () => (props ? sceneSpans(props.scenes, props.timing ?? null, duration) : []),
    [props, duration],
  );
  const seekScene = useCallback(
    (id: string) => {
      const s = spans.find((x) => x.id === id);
      if (!s || !meta) return;
      playerRef.current?.seekTo(Math.max(0, Math.min(meta.durationInFrames - 1, Math.round(s.start * meta.fps))));
    },
    [spans, meta],
  );
  // the script dialog is a chunk of its own, fetched the first time it is asked for
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const openScript = useCallback((at: string | null) => {
    setScriptLoaded(true);
    setScript({ open: true, at });
  }, []);

  if (!detail) return null;
  const running = produceJob(detail);
  const llm = detail.jobs.find((j) => j.kind === "llm" && (j.status === "queued" || j.status === "running"));
  const render = latestRender(detail);
  const policy = renderPolicy(render);
  const canProduce = !!props && !!detail.script && !running && !llm && !blockReason;
  const next = nextAction(detail.project.status, detail.jobs[0]);
  const schedulable = canSchedule(policy, !!running) && !detail.publications.length;

  return (
    <div className="room-wrap">
      <div className="stagebar">
        <div className="stagebar__next">
          <span className="label">Next</span>
          <b className={`next next--${next.tone}`}>
            {next.verb === "Publish private" ? "Schedule it" : next.verb}
          </b>
          <span className="stagebar__hint">
            {next.verb === "Publish private" ? "gate allows; publishing happens in the Calendar (private only)" : next.hint}
          </span>
        </div>
        <div className="stagebar__produce">
          <button
            type="button"
            className="btn btn--primary"
            data-testid="produce"
            onClick={() => produce.mutate()}
            disabled={!canProduce || produce.isPending}
            aria-busy={!!running || produce.isPending}
            title={blockReason ?? undefined}
          >
            {running ? "Producing" : render ? "Produce again" : "Produce"}
          </button>
          {running && canCancelJob(running) ? (
            <button
              type="button"
              className="btn btn--sm"
              data-testid="produce-cancel"
              onClick={() => cancel.mutate(running.id)}
              disabled={cancel.isPending}
              aria-busy={cancel.isPending}
            >
              {cancel.isPending ? "Cancelling" : "Cancel"}
            </button>
          ) : null}
          {running ? <JobLine job={running} projectId={pid} /> : null}
          {!props || !detail.script ? <span className="stagebar__hint">needs props and a script first</span> : null}
          {blockReason ? <span className="stagebar__hint">{blockReason}</span> : null}
          {cancel.isError ? <span className="joberr">{errorText(cancel.error)}</span> : null}
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
        <div className="stagebar__keys">
          <button
            type="button"
            className="btn btn--sm stagebar__script"
            onClick={() => openScript(props?.scenes[0]?.id ?? null)}
            aria-haspopup="dialog"
          >
            Script
            <span className="stagebar__meta num">
              {props ? `${props.scenes.length} scenes` : "empty"}
              {detail.script ? ` · v${detail.script.version}` : ""}
            </span>
          </button>
          {schedulable ? (
            <Link to="/calendar" search={{ project: pid }} className="btn btn--sm btn--primary stagebar__cal">
              Schedule in Calendar <Arrow />
            </Link>
          ) : detail.publications.length ? (
            <PublicationStatus detail={detail} />
          ) : null}
        </div>
      </div>
      <JobError job={lastJobOf(detail, ["audio", "render"])} />
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
        <Defer tier={1} id="room:props" phClass="props panel-col" minHeight={300}>
          <PropsPanel
            detail={detail}
            usecase={usecase}
            cells={heatmap?.cells ?? []}
            onOpenScript={() => openScript(props?.scenes[0]?.id ?? null)}
          />
        </Defer>
        <Defer tier={2} id="room:pgm" phClass="pgm" minHeight={300}>
          <Monitor
            props={props}
            compositionName={usecase?.composition}
            playerRef={playerRef}
            meta={meta}
            onMeta={onMeta}
            state={cstate}
            clock={clock}
          />
        </Defer>
        <Defer tier={3} id="room:copilot" phClass="copilot panel-col" minHeight={300}>
          <Copilot detail={detail} />
        </Defer>
        <Defer tier={4} id="room:tl" phClass="tl" minHeight={120}>
          <Tracks
            props={props}
            spans={spans}
            duration={duration}
            playerRef={playerRef}
            meta={meta}
            state={cstate}
            clock={clock}
            onScene={(id) => {
              seekScene(id);
              openScript(id);
            }}
          />
        </Defer>
      </div>
      {scriptLoaded ? (
        <Suspense fallback={null}>
          <ScriptModal
            open={script.open}
            at={script.at}
            onClose={() => setScript((s) => ({ ...s, open: false }))}
            detail={detail}
            props={props}
            spans={spans}
            onSeek={seekScene}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

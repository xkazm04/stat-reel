/**
 * Studio workspace (A/3 rack): stage bar + Produce key; props | player | co-pilot; timeline;
 * render & gate | publish.
 */
import type { PlayerRef } from "@remotion/player";
import type { Format } from "@statreel/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, qk } from "../api";
import { FormatGlyph, Screws } from "../components/glyphs";
import type { PlayerMeta } from "../components/PlayerStage";
import { ErrorState, Loading } from "../components/ui";
import { useJobProgress } from "../events";
import { MODE_LABEL, nextAction, STAGE_LABEL, STAGES, stageIndex } from "../logic";
import { rememberProject } from "../prefs";
import { CopilotPanel } from "../studio/Copilot";
import { PropsPanel } from "../studio/PropsPanel";
import { PublishPanel, RenderGatePanel } from "../studio/RenderGate";
import { ScreenPanel } from "../studio/Screen";
import { TimelinePanel } from "../studio/Timeline";

export function StudioPage() {
  const { projectId } = useParams({ from: "/studio/$projectId" });
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.project(projectId), queryFn: () => api.project(projectId) });
  const heat = useQuery({ queryKey: qk.heatmap, queryFn: api.heatmap });
  const progress = useJobProgress(projectId);

  useEffect(() => rememberProject(projectId), [projectId]);

  const detail = q.data;
  const props = detail?.props?.props ?? null;
  const usecase = heat.data?.usecases.find((u) => u.id === detail?.project.use_case_id);

  const [format, setFormat] = useState<Format>("vertical");
  const [safe, setSafe] = useState(false);
  const [frame, setFrame] = useState(0);
  const [meta, setMeta] = useState<PlayerMeta | null>(null);
  const playerRef = useRef<PlayerRef>(null);
  const formatKey = props?.format ?? detail?.project.format;
  useEffect(() => {
    if (formatKey === "vertical" || formatKey === "landscape") setFormat(formatKey);
  }, [formatKey]);
  useEffect(() => {
    if (props) setSafe(props.show_safe_zone ?? false);
  }, [props]);
  const onMeta = useCallback((m: PlayerMeta | null) => setMeta(m), []);
  const onFrame = useCallback((f: number) => setFrame(f), []);

  const produce = useMutation({
    mutationFn: () =>
      api.produce(projectId, {
        platform: "youtube",
        monetized: detail?.project.mode === "monetized",
        ai_disclosure: true,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.project(projectId) }),
  });

  if (q.isError) {
    return (
      <main id="main" className="page wrap">
        <ErrorState error={q.error} what={`Project ${projectId}`} />
        <p>
          <Link to="/projects">All projects</Link>
        </p>
      </main>
    );
  }
  if (!detail) {
    return (
      <main id="main" className="page wrap">
        <Loading what={`Opening ${projectId}…`} />
      </main>
    );
  }

  const p = detail.project;
  const i = stageIndex(p.status);
  const latestJob = detail.jobs[0];
  const action = nextAction(p.status, latestJob);
  const producing = detail.jobs.some(
    (j) => (j.kind === "audio" || j.kind === "render") && (j.status === "queued" || j.status === "running"),
  );
  const produceWhy = !props
    ? "Needs props: draft with the co-pilot first."
    : !detail.script
      ? "Needs a narration script: ask the co-pilot to write it."
      : producing
        ? "A produce run is in progress."
        : `Target: YouTube · ${p.mode === "monetized" ? "monetized" : "non-commercial"} · AI disclosure on.`;

  return (
    <main id="main" className="page studio-page">
      <header className="module rack-head">
        <Screws at={["tl", "bl"]} />
        <div className="rh-title">
          <h1>{p.title}</h1>
          <div className="chips">
            <b>{p.id}</b>
            <span>{usecase?.name ?? p.use_case_id}</span>
            <span>{p.sport}</span>
            <FormatGlyph format={p.format} />
            <span>{MODE_LABEL[p.mode as keyof typeof MODE_LABEL] ?? p.mode}</span>
            {detail.script ? <span>script v{detail.script.version}</span> : <span>no script</span>}
          </div>
        </div>
        <ol className="stagebar" aria-label="Stages">
          {STAGES.map((s, k) => (
            <li
              key={s}
              className={`sb-step${k < i ? " done" : ""}${k === i ? " now" : ""}`}
              aria-current={k === i ? "step" : undefined}
            >
              <span
                className={`step${k <= i ? " lit" : ""}${k === i ? " head" : ""}${p.status === "published" ? " pub" : ""}`}
                aria-hidden="true"
              >
                <i />
              </span>
              <span className="sb-lab">
                <span className="sb-n">{k + 1}</span> {STAGE_LABEL[s]}
              </span>
            </li>
          ))}
        </ol>
        <div className="adv">
          <button
            type="button"
            className="key primary"
            onClick={() => produce.mutate()}
            disabled={!props || !detail.script || producing || produce.isPending}
            data-testid="produce"
          >
            {producing || produce.isPending ? "Producing…" : "Produce ▶"}
          </button>
          <span className="why">{produceWhy}</span>
          <span className={`next next-${action.tone}`}>
            Next: <b>{action.verb}</b>
          </span>
          {produce.isError ? (
            <span className="mono err" role="alert">
              {errorText(produce.error)}
            </span>
          ) : null}
        </div>
      </header>

      <div className="studio-work">
        <PropsPanel detail={detail} usecase={usecase} />
        <ScreenPanel
          props={props}
          format={format}
          setFormat={setFormat}
          formats={usecase?.formats ?? ["vertical", "landscape"]}
          safe={safe}
          setSafe={setSafe}
          playerRef={playerRef}
          meta={meta}
          setMeta={onMeta}
          frame={frame}
          setFrame={onFrame}
          compositionName={usecase ? usecase.composition : undefined}
        />
        <CopilotPanel detail={detail} />
      </div>

      <TimelinePanel
        props={props}
        frame={frame}
        fps={meta?.fps ?? 30}
        onSeek={(s) => {
          const f = Math.round(s * (meta?.fps ?? 30));
          playerRef.current?.seekTo(f);
          setFrame(f);
        }}
      />

      <div className="studio-out">
        <RenderGatePanel detail={detail} usecase={usecase} progress={progress} />
        <PublishPanel detail={detail} progress={progress} />
      </div>
    </main>
  );
}

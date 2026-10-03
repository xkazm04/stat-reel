/**
 * Queue strip in the Board header (D.11): "Generating: <case> · 2 queued", or "Generation worker offline"
 * when the lease heartbeat is stale. A details list shows the recent jobs with their log.
 */
import { useState } from "react";
import { elapsed, errorWords, stripState } from "./jobs";
import { LogDrawer } from "./LogDrawer";
import { useOverview } from "./useGeneration";
import "./jobs.css";

export function QueueStrip() {
  const ov = useOverview();
  const [log, setLog] = useState<string | null>(null);
  if (!ov.data) return null;
  const s = stripState(ov.data);
  const titles = new Map(Object.entries(ov.data.cases).map(([id, c]) => [id, c.title]));
  const recent = ov.data.jobs.slice(0, 8);
  return (
    <section className={`jq ${s.offline ? "jq--offline" : ""} ${s.active ? "jq--active" : ""}`} aria-label="Generation queue" aria-live="polite" data-testid="queue-strip">
      <span className="jq__dot" aria-hidden="true">
        {s.offline ? "⊘" : s.active ? "◐" : "○"}
      </span>
      <b className="jq__text">{s.text}</b>
      {s.offline && ov.data.worker.queued ? <span className="jq__hint">run `pnpm worker`</span> : null}
      {recent.length ? (
        <details className="jq__jobs">
          <summary data-testid="queue-jobs">Jobs</summary>
          <ul>
            {recent.map((j) => (
              <li key={j.id} data-testid={`queue-job-${j.id}`}>
                <span className="mono">{j.type === "visual_options" ? "visuals" : "video"}</span>
                <span>{titles.get(j.case_id) ?? j.case_id}</span>
                <span className="mono">
                  {j.status}
                  {j.status === "running" ? ` · ${elapsed(j.started_at, ov.now)}` : ""}
                  {j.status === "failed" ? ` · ${errorWords(j.error_kind)}` : ""}
                  {j.status === "queued" && j.queue_position ? ` · #${j.queue_position}` : ""}
                </span>
                <button type="button" className="bd-linkbtn" onClick={() => setLog(j.id)}>
                  Log
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {log ? <LogDrawer jobId={log} onClose={() => setLog(null)} /> : null}
    </section>
  );
}

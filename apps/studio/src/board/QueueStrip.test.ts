import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type GenerationOverview, qk } from "../api";
import { QueueStrip } from "./QueueStrip";

const job = (o: Record<string, unknown>) =>
  ({
    id: "gj-00000001",
    type: "generate_video",
    case_id: "ci-00000001",
    board_item_id: null,
    dedupe_key: "k",
    status: "running",
    attempts: 1,
    max_attempts: 2,
    params_json: "{}",
    result_json: null,
    error: null,
    error_kind: null,
    log_path: null,
    output_dir: null,
    pid: 1,
    phase: null,
    progress_note: null,
    last_tool: null,
    cancel_requested_at: null,
    heartbeat_at: null,
    created_at: "2026-10-04T10:00:00.000Z",
    started_at: "2026-10-04T10:00:00.000Z",
    finished_at: null,
    updated_at: "2026-10-04T10:00:00.000Z",
    ...o,
  }) as GenerationOverview["jobs"][number];

function render(o: GenerationOverview): string {
  const qc = new QueryClient();
  qc.setQueryData(qk.generation, o);
  return renderToStaticMarkup(h(QueryClientProvider, { client: qc }, h(QueueStrip)));
}

describe("QueueStrip live region", () => {
  const running = job({});
  const html = render({
    worker: { online: true, pid: 1, heartbeat_at: null, queued: 1, running: 1 },
    jobs: [running, job({ id: "gj-00000002", status: "queued", queue_position: 1, started_at: null })],
    cases: {
      "ci-00000001": {
        title: "Season points fight",
        stage: "video_running",
        gate: null,
        visual_job_id: null,
        video_job_id: "gj-00000001",
        accepted_item_id: "bd-1",
        videos: 0,
      },
    },
    running: { job: running, title: "Season points fight" },
  });

  it("announces only the strip's one-line state, not the job list with its ticking clocks and buttons", () => {
    expect(html.match(/aria-live=/g) ?? []).toHaveLength(1);
    const live = html.match(/<(\w+)[^>]*aria-live="polite"[^>]*>([\s\S]*?)<\/\1>/);
    expect(live?.[1]).not.toBe("section");
    expect(live?.[2]).toContain("Generating: Season points fight");
    expect(live?.[2]).not.toContain("<button");
    expect(live?.[2]).not.toContain("<details");
  });
});

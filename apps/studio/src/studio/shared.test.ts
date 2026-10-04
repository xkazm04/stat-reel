import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Job } from "../api";
import { produceOutcome } from "./produce-stages";
import { JobError } from "./shared";

const job = (status: Job["status"], error: string | null): Job => ({
  id: "j1",
  kind: "render",
  project_id: "p1",
  status,
  progress: 0.5,
  params_json: "{}",
  result_json: null,
  error,
  created_at: "2026-10-04T10:00:00Z",
  started_at: null,
  finished_at: null,
});

describe("JobError (a produce's end is voiced once, by ProduceAnnouncer)", () => {
  const ends: [Job["status"], string][] = [
    ["failed", "ffmpeg exited 1"],
    ["refused", "refused by budget: over the test budget"],
    ["cancelled", "cancelled (cause: owner)"],
  ];
  it("shows the ended job's error without a second, assertive live region", () => {
    for (const [status, error] of ends) {
      const html = renderToStaticMarkup(createElement(JobError, { job: job(status, error) }));
      expect(html).toContain(error);
      expect(html, status).not.toContain('role="alert"');
    }
  });
  it("leaves nothing unvoiced: the polite announcer has a sentence for every end JobError shows", () => {
    for (const [status, error] of ends) expect(produceOutcome([job(status, error)], []), status).toMatch(/^Produce /);
  });
  it("renders nothing for a running or succeeded job", () => {
    expect(renderToStaticMarkup(createElement(JobError, { job: job("running", null) }))).toBe("");
    expect(renderToStaticMarkup(createElement(JobError, { job: job("succeeded", null) }))).toBe("");
  });
});

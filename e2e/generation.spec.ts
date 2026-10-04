/**
 * Generation queue, fake mode (ADR 010, T7): the worker process (GEN_MODE=fake, third webServer) takes
 * a queued job through running to done and writes data/generation/<id>/ (the UI flow is in generation-board.spec.ts); the API is the
 * surface. Skipped in live runs: those never enqueue fake jobs.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { e2eModes } from "../scripts/e2e-preflight.mjs";

const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}`;

// fake-mode only: a live worker would hand these jobs to the real Claude CLI
test.skip(!!process.env.E2E_LIVE || e2eModes().GEN_MODE !== "fake", "fake-mode generation test");

test("generation: a visual_options job runs queued -> done in the worker process", async ({ request }) => {
  test.setTimeout(8 * 60_000);
  const idea = await (await request.post(`${API}/api/cases`, { data: {
    title: "e2e generation probe", pitch: "A decade-long probe", domain: "f1", arc: "rise and fall", insight: "probe", why_lasts: "probe",
    tension: { expectation: "steady", reality: "volatile", strength: "moderate" },
    beats: [1, 2, 3, 4].map((n) => ({ at: `20${10 + n}`, what: `turn ${n}` })),
    timeline: { unit: "year", from: 2010, to: 2024, years_from: 2010, years_to: 2024 },
    data_status: "staged", sources: [{ name: "f1db", url: "https://github.com/f1db/f1db", license: "CC-BY-4.0" }],
  } })).json();
  expect(idea.id).toMatch(/^ci-/);

  await expect.poll(async () => (await (await request.get(`${API}/api/generation/worker`)).json()).online, { timeout: 30_000 }).toBe(true);

  const first = await request.post(`${API}/api/generation/jobs`, { data: { type: "visual_options", case_id: idea.id } });
  expect(first.status()).toBe(201);
  const { job } = await first.json();
  expect(job.status).toBe("queued");
  const again = await request.post(`${API}/api/generation/jobs`, { data: { type: "visual_options", case_id: idea.id } });
  expect(again.status()).toBe(200);
  expect((await again.json()).job.id).toBe(job.id); // one row on a double POST

  await expect.poll(async () => (await (await request.get(`${API}/api/generation/jobs/${job.id}`)).json()).job.status, { timeout: 5 * 60_000 }).toBe("done");
  const detail = await (await request.get(`${API}/api/generation/jobs/${job.id}`)).json();
  expect(detail.log_tail.join("\n")).toContain("finalize ok");
  const events = detail.events.map((e: { type: string }) => e.type);
  expect(events).toEqual(expect.arrayContaining(["queued", "started", "done"]));
  const result = JSON.parse(detail.job.result_json);
  expect(result.outputs).toContain("out/variants/v1.props.json");

  const out = path.resolve("data", "generation", job.id, "work", "out");
  expect(existsSync(path.join(out, "variants", "v3.props.json"))).toBe(true);
  expect(JSON.parse(readFileSync(path.resolve("data", "generation", job.id, "work", "case.json"), "utf8")).title).toBe("e2e generation probe");
});

test("generation: the generation MCP endpoint offers fetch_asset (and the co-pilot endpoint does not) and refuses it for a job that is not running", async ({ request }) => {
  const rpc = async (id: number, method: string, params: object = {}, route = "/mcp/generation") => {
    const res = await request.post(`${API}${route}`, { headers: { accept: "application/json, text/event-stream", "content-type": "application/json" }, data: { jsonrpc: "2.0", id, method, params } });
    return (await res.json()) as { result?: { tools?: { name: string }[]; content?: { text: string }[] } };
  };
  const list = await rpc(1, "tools/list");
  const names = list.result?.tools?.map((t) => t.name) ?? [];
  expect(names).toEqual(expect.arrayContaining(["fetch_asset", "validate_generation_output", "get_generation_context", "compute_timing_plan"]));
  const call = await rpc(2, "tools/call", { name: "fetch_asset", arguments: { job_id: "gj-00000000", url: "https://upload.wikimedia.org/x.svg", kind: "logo", entity: "x" } });
  expect(JSON.parse(call.result?.content?.[0]?.text ?? "{}").ok).toBe(false);
  // least privilege: the co-pilot's catalog carries no generation tools (mcp-scope.test.ts pins both lists)
  const copilot = (await rpc(3, "tools/list", {}, "/mcp")).result?.tools?.map((t) => t.name) ?? [];
  expect(copilot).not.toContain("fetch_asset");
});

/**
 * The worker's only channel to the server besides SQLite (ADR 010): renders and domain writes stay in
 * the server. A plain interface so the worker is testable without HTTP.
 */
export type RenderRequest = { kind: "stills" | "video"; props_path: string; frames?: number[] };
export interface ServerCallbacks {
  finalize(jobId: string, body: { outputs: string[]; result?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  render(jobId: string, body: RenderRequest): Promise<{ render_job_id: string }>;
  renderStatus(renderJobId: string): Promise<{ status: string; error?: string | null; result?: unknown }>;
}

export function httpCallbacks(base: string, fetchFn: typeof fetch = fetch): ServerCallbacks {
  const call = async <T>(method: string, url: string, body?: unknown): Promise<T> => {
    const res = await fetchFn(`${base}${url}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  };
  return {
    finalize: (id, body) => call("POST", `/api/generation/jobs/${id}/finalize`, body),
    render: (id, body) => call("POST", `/api/generation/jobs/${id}/render`, body),
    renderStatus: async (id) => {
      const r = await call<{ jobs: { id: string; status: string; error?: string | null; result_json?: string | null }[] }>("GET", "/api/jobs");
      const j = r.jobs.find((x) => x.id === id);
      if (!j) throw new Error(`render job ${id} not found`);
      return { status: j.status, error: j.error, result: j.result_json ? JSON.parse(j.result_json) : undefined };
    },
  };
}

export async function serverHealthy(base: string, fetchFn: typeof fetch = fetch, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetchFn(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

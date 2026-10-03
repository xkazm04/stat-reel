/**
 * Data hook of the generation badges: one query for the whole board (GET /api/generation/overview). SSE
 * `gen.*` events invalidate it (events.ts); while any job is queued or running it also polls every 10 s as
 * a fallback (D.11). A 1 s clock keeps "Running · 03:12" ticking without refetching.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, qk } from "../api";
import { hasActiveJobs, type JobRow } from "./jobs";

export const FALLBACK_POLL_MS = 10_000;

export function useOverview() {
  const q = useQuery({
    queryKey: qk.generation,
    queryFn: () => api.generationOverview(),
    refetchInterval: (query) => (hasActiveJobs(query.state.data) ? FALLBACK_POLL_MS : false),
  });
  const running = !!q.data?.jobs.some((j) => j.status === "running");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const jobs = useMemo(() => new Map<string, JobRow>((q.data?.jobs ?? []).map((j) => [j.id, j])), [q.data]);
  return { ...q, jobs, now, workerOnline: q.data?.worker.online ?? false };
}

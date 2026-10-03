/**
 * Query hooks over the typed API. Every screen reads through these; SSE (events.ts) invalidates
 * them. A project with a queued/running job is also polled, so a dropped SSE connection cannot
 * leave the control room stale.
 */
import type { EraAdjustedProps, PolicyResult, ProvenanceManifest, PublishTarget } from "@statreel/schemas";
import { useQuery } from "@tanstack/react-query";
import { api, type ProjectDetail, parseJson, qk, type RenderRow } from "./api";
import { fileUrl } from "./logic";

/** Query options live apart from the hooks so route loaders can prefetch the same cache entries. */
export const heatmapQuery = { queryKey: qk.heatmap, queryFn: api.heatmap, staleTime: 30_000 } as const;
export const sourcesQuery = { queryKey: qk.sources, queryFn: api.sources, staleTime: 60_000 } as const;
export const projectsQuery = { queryKey: qk.projects, queryFn: api.projects } as const;
export const metricsQuery = { queryKey: qk.metrics, queryFn: api.metrics } as const;
export const calendarQuery = { queryKey: qk.calendar, queryFn: api.calendar } as const;
export const projectQuery = (id: string) => ({ queryKey: qk.project(id), queryFn: () => api.project(id) }) as const;

export const useHeatmap = () => useQuery(heatmapQuery);
export const useSources = () => useQuery(sourcesQuery);
export const useProjects = () => useQuery(projectsQuery);
export const useMetrics = () => useQuery(metricsQuery);
/** The calendar; polled while a slot is publishing (SSE job.* events also invalidate it). */
export const useCalendar = () =>
  useQuery({
    ...calendarQuery,
    refetchInterval: (q) => (q.state.data?.slots.some((s) => s.status === "publishing") ? 3_000 : false),
  });

const busy = (d: ProjectDetail | undefined) => !!d?.jobs.some((j) => j.status === "queued" || j.status === "running");

export function useProject(id: string | null | undefined) {
  return useQuery({
    ...projectQuery(id ?? "-"),
    queryFn: () => api.project(id as string),
    enabled: !!id,
    refetchInterval: (q) => (busy(q.state.data) ? 4_000 : false),
  });
}

export type PolicyVerdict = PolicyResult & { target?: PublishTarget };

export const latestRender = (d: ProjectDetail | undefined | null): RenderRow | null => d?.renders[0] ?? null;
export const renderPolicy = (r: RenderRow | null): PolicyVerdict | null => parseJson<PolicyVerdict>(r?.policy_json);
export const renderChecks = (r: RenderRow | null): Record<string, unknown> | null =>
  parseJson<Record<string, unknown>>(r?.checks_json);

/** Same-origin /files URL of a file next to a render's video (captions, manifest, thumb). */
export function renderFile(r: RenderRow | null, name: string): string | null {
  const dir = fileUrl(r?.dir_url ?? null);
  return dir ? `${dir.replace(/\/$/, "")}/${name}` : null;
}

export function useManifest(r: RenderRow | null) {
  const url = renderFile(r, "manifest.json");
  return useQuery({
    queryKey: qk.file(url ?? "-"),
    queryFn: () => api.file<ProvenanceManifest>(url as string),
    enabled: !!url,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Props for the in-browser Player: server file URLs become same-origin /files paths (proxied). */
export function playerProps(p: EraAdjustedProps | null | undefined): EraAdjustedProps | null {
  if (!p) return null;
  if (!p.timing) return p;
  const t = p.timing;
  return {
    ...p,
    timing: {
      ...t,
      scenes: t.scenes.map((s) => ({
        ...s,
        voice_src: s.voice_src ? (fileUrl(s.voice_src) ?? s.voice_src) : undefined,
      })),
      music: t.music.map((m) => ({ ...m, src: fileUrl(m.src) ?? m.src })),
    },
  };
}

/** The programme the Front plays (routes/FrontPhotoFinish.tsx FirstShort; Photo Finish is the only theme, ADR 009). */
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, type ProjectDetail, type ProjectWithJobs, qk } from "../api";

/** Newest project that has props (details of the five newest projects are read). */
export function useProgramme(projects: ProjectWithJobs[] | undefined) {
  const newest = useMemo(
    () => [...(projects ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5),
    [projects],
  );
  const details = useQueries({
    queries: newest.map((p) => ({ queryKey: qk.project(p.id), queryFn: () => api.project(p.id) })),
  });
  const loading = details.some((d) => d.isLoading);
  const found = details.map((d) => d.data).find((d): d is ProjectDetail => !!d?.props);
  return { detail: found ?? null, loading: !!projects && loading };
}

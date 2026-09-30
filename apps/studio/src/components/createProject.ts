/** Create a project from a heatmap cell (POST /api/projects) and cut to its control room. */
import type { Mode, Sport, UseCase } from "@statreel/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api, qk } from "../api";
import { identVar } from "./idents";
import { useWipe } from "./ui";

export function useCreateProject() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const wipe = useWipe();
  return useMutation({
    mutationFn: (v: { usecase: UseCase; sport: Sport; mode: Mode }) =>
      api.createProject({
        title: `${v.usecase.name} · ${v.sport}`,
        use_case_id: v.usecase.id,
        sport: v.sport,
        format: v.usecase.default_format,
        mode: v.mode,
      }),
    onSuccess: (p, v) => {
      void qc.invalidateQueries({ queryKey: qk.projects });
      wipe(identVar(v.usecase.id), () => {
        void navigate({ to: "/studio/$projectId", params: { projectId: p.id } });
      });
    },
  });
}

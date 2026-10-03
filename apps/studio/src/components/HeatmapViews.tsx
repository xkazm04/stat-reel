/** The two views of /heatmap: Topics (topic x video ordinal) and Feasibility (use case x sport rights grid). */
import { useNavigate } from "@tanstack/react-router";

export type HeatmapView = "topics" | "feasibility";

export function ViewSwitch({ view }: { view: HeatmapView }) {
  const navigate = useNavigate();
  const go = (v: HeatmapView) =>
    void navigate({ to: "/heatmap", search: (s: Record<string, unknown>) => ({ ...s, view: v }), resetScroll: false } as never);
  return (
    <div className="hm-views" role="group" aria-label="Heatmap view">
      {(["topics", "feasibility"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          data-testid={`heatmap-view-${v}`}
          onClick={() => go(v)}
        >
          {v === "topics" ? "Topics" : "Feasibility"}
        </button>
      ))}
    </div>
  );
}

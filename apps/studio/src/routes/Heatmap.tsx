/**
 * /heatmap shell (ADR 011): two views on one route, chosen by `?view=`. Topics (the default) is the
 * topic x video-ordinal activity grid; Feasibility is the use case x sport rights grid with its
 * cell layer (child route /heatmap/$usecase/$sport). While a cell layer is open the Feasibility
 * view is forced, so every existing cell link keeps working.
 */
import { useParams, useSearch } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PagePending } from "../components/arrive";
import type { HeatmapSearch } from "../router";
import { HeatmapTopics } from "./HeatmapTopics";

const HeatmapFeasibility = lazy(() => import("./HeatmapFeasibility").then((m) => ({ default: m.HeatmapFeasibility })));

export function HeatmapPage() {
  const search = useSearch({ from: "/heatmap" }) as HeatmapSearch;
  const params = useParams({ strict: false }) as { usecase?: string; sport?: string };
  const cellOpen = !!(params.usecase && params.sport);
  const view = cellOpen ? "feasibility" : (search.view ?? "topics");
  if (view === "topics") return <HeatmapTopics />;
  return (
    <Suspense fallback={<PagePending />}>
      <HeatmapFeasibility />
    </Suspense>
  );
}

/**
 * Code-based TanStack Router (DESIGN §6.1 revised by ADR 006): Front, Heatmap (grid layer +
 * cell layer), Rundown, Studio (compose + Render & Gate), Calendar, Board, Metrics, Sources.
 */
import type { Mode, Sport } from "@statreel/schemas";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  lazyRouteComponent,
  Navigate,
  Outlet,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { api, qk } from "./api";
import { parseBoardSearch } from "./board/search";
import { PagePending } from "./components/arrive";
import { Nav } from "./components/Nav";
import { useNavFocus } from "./hooks/useNavFocus";
import { WipeProvider } from "./components/ui";
import { boardQuery, lineTopicsQuery } from "./workQuery";
import { calendarQuery, heatmapQuery, heatmapTopicsQuery, metricsQuery, projectQuery, projectsQuery, sourcesQuery } from "./data";
import { isModuleLoadError } from "./moduleError";
import { queryClient } from "./queryClient";

/**
 * Page loading: every screen is its own chunk (`lazyRouteComponent`; intent preload fetches it on
 * hover/focus), and each route's loader starts that screen's queries right away, so the data
 * request runs in parallel with the chunk instead of after it. Loaders never await the data:
 * the screen renders its own skeletons and errors from the same cache entries.
 */
const warm = (...qs: readonly { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> }[]): void => {
  for (const q of qs) void queryClient.prefetchQuery(q);
};
const BoardPage = lazyRouteComponent(() => import("./board/BoardPage"), "BoardPage");
const CalendarPage = lazyRouteComponent(() => import("./routes/Calendar"), "CalendarPage");
const HeatmapPage = lazyRouteComponent(() => import("./routes/Heatmap"), "HeatmapPage");
const HeatmapCellLayer = lazyRouteComponent(() => import("./routes/HeatmapCell"), "HeatmapCellLayer");
const MetricsPage = lazyRouteComponent(() => import("./routes/Metrics"), "MetricsPage");
const ProjectsPage = lazyRouteComponent(() => import("./routes/Projects"), "ProjectsPage");
const SourcesPage = lazyRouteComponent(() => import("./routes/Sources"), "SourcesPage");
const StudioIndex = lazyRouteComponent(() => import("./routes/StudioIndex"), "StudioIndex");
const ControlRoom = lazyRouteComponent(() => import("./studio/ControlRoom"), "ControlRoom");
const RenderGatePage = lazyRouteComponent(() => import("./studio/RenderGatePage"), "RenderGatePage");
const StudioLayout = lazyRouteComponent(() => import("./studio/StudioLayout"), "StudioLayout");
const FrontPhotoFinish = lazyRouteComponent(() => import("./routes/FrontPhotoFinish"), "FrontPhotoFinish");

function RootLayout() {
  useNavFocus();
  return (
    <WipeProvider>
      <Nav />
      <Outlet />
    </WipeProvider>
  );
}

function NotFound() {
  return (
    <main id="main" className="page">
      <div className="empty">
        <b>Off air</b>
        There is no screen at this address. <Link to="/">Back to the front</Link>
      </div>
    </main>
  );
}

/**
 * The default error component of every route: it renders inside the shell (each match has its own
 * boundary under the root's <Outlet/>), so the nav survives a screen failing. A lazy-chunk failure
 * after a rebuild cannot be retried (the stale bundle caches the rejection), so it offers a reload
 * instead of an eternal Retry (async-ui-states: version skew offers refresh). The alert takes focus
 * so a keyboard / screen-reader owner lands on it.
 */
function RouteError({ error, reset }: { error: unknown; reset?: () => void }) {
  const stale = isModuleLoadError(error);
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => alertRef.current?.focus(), []);
  const retry = () => {
    reset?.();
    void router.invalidate();
  };
  return (
    <main id="main" className="page">
      <div className="failure" role="alert" tabIndex={-1} ref={alertRef}>
        <b>{stale ? "StatReel was updated" : "This screen failed"}</b>
        {stale ? (
          <span>A newer version of StatReel is available. Reload to continue.</span>
        ) : (
          <span className="mono">{error instanceof Error ? error.message : String(error)}</span>
        )}
        <div className="failure__actions">
          {stale ? (
            <button type="button" className="btn btn--sm" onClick={() => window.location.reload()}>
              Reload
            </button>
          ) : (
            <button type="button" className="btn btn--sm" onClick={retry}>
              Retry
            </button>
          )}
          <Link to="/">Back to the front</Link>
        </div>
      </div>
    </main>
  );
}

const SPORTS: readonly string[] = ["F1", "NBA", "NHL", "Soccer"];
export const asMode = (v: unknown): Mode | undefined =>
  v === "non_commercial" ? "non_commercial" : v === "monetized" ? "monetized" : undefined;
export const asSport = (v: unknown): Sport | undefined =>
  typeof v === "string" && SPORTS.includes(v) ? (v as Sport) : undefined;

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFound });

export type FrontSearch = { format?: string; sport?: Sport; mode?: Mode };
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (s: Record<string, unknown>): FrontSearch => ({
    format: typeof s.format === "string" ? s.format : undefined,
    sport: asSport(s.sport),
    mode: asMode(s.mode),
  }),
  component: FrontPhotoFinish,
  // what the Front reads (useProjects, useHeatmap, useSources, the On the line panel: topics + board); never metrics
  loader: () => warm(projectsQuery, sourcesQuery, heatmapQuery, lineTopicsQuery, boardQuery),
});

/**
 * Heatmap layer 1 (the grid) is the parent; layer 2 (one cell) is a child rendered as a full layer
 * over the grid, so the grid keeps its place and focus when the layer closes.
 * `focus` = "<usecase>|<sport>" names the cell to focus on the grid (`cell` is its legacy name).
 */
export type HeatmapSearch = { mode?: Mode; focus?: string; view?: "topics" | "feasibility" };
export const heatmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/heatmap",
  validateSearch: (s: Record<string, unknown>): HeatmapSearch => ({
    mode: asMode(s.mode),
    focus: typeof s.focus === "string" ? s.focus : typeof s.cell === "string" ? s.cell : undefined,
    view: s.view === "feasibility" ? "feasibility" : s.view === "topics" ? "topics" : undefined,
  }),
  component: HeatmapPage,
  loader: ({ location }) =>
    location.pathname === "/heatmap" && (location.search as { view?: string }).view !== "feasibility"
      ? warm(heatmapTopicsQuery(false))
      : warm(heatmapQuery, sourcesQuery),
});
const heatmapIndexRoute = createRoute({ getParentRoute: () => heatmapRoute, path: "/", component: () => null });
export const heatmapCellRoute = createRoute({
  getParentRoute: () => heatmapRoute,
  path: "$usecase/$sport",
  component: HeatmapCellLayer,
});

export type ProjectsSearch = { view?: "board" | "list" };
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  validateSearch: (s: Record<string, unknown>): ProjectsSearch => ({ view: s.view === "list" ? "list" : undefined }),
  component: ProjectsPage,
  loader: () => warm(projectsQuery, metricsQuery, lineTopicsQuery, boardQuery),
});

const studioIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio",
  component: StudioIndex,
  loader: () => warm(projectsQuery, lineTopicsQuery, boardQuery),
});

export const studioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio/$projectId",
  component: StudioLayout,
  loader: ({ params }) => warm(projectQuery(params.projectId), heatmapQuery),
});
const controlRoute = createRoute({ getParentRoute: () => studioRoute, path: "/", component: ControlRoom });
const renderRoute = createRoute({ getParentRoute: () => studioRoute, path: "render", component: RenderGatePage });
/** Publishing moved to the Calendar (ADR 006); old links land there. */
const publishRoute = createRoute({
  getParentRoute: () => studioRoute,
  path: "publish",
  component: () => <Navigate to="/calendar" replace />,
});

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/calendar",
  component: CalendarPage,
  loader: () => warm(calendarQuery, metricsQuery, heatmapQuery),
});
const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/board",
  // filters live in the URL (board-triage-first): a reload lands on the same queue
  validateSearch: parseBoardSearch,
  component: BoardPage,
  loader: () => warm({ queryKey: qk.board, queryFn: () => api.board() }),
});
const metricsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/metrics",
  component: MetricsPage,
  loader: () => warm(metricsQuery, heatmapQuery),
});
const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sources",
  component: SourcesPage,
  loader: () => warm(sourcesQuery),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  heatmapRoute.addChildren([heatmapIndexRoute, heatmapCellRoute]),
  projectsRoute,
  studioIndexRoute,
  studioRoute.addChildren([controlRoute, renderRoute, publishRoute]),
  calendarRoute,
  boardRoute,
  metricsRoute,
  sourcesRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultErrorComponent: RouteError,
  // the query cache owns freshness; the router must not re-run loaders for a warm preload
  defaultPreloadStaleTime: 0,
  // a pending screen shows only after 150 ms and then stays 250 ms, so fast loads never flash
  defaultPendingComponent: PagePending,
  defaultPendingMs: 150,
  defaultPendingMinMs: 250,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

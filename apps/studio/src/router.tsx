/**
 * Code-based TanStack Router (DESIGN §6.1 revised by ADR 006): Front, Heatmap (grid layer +
 * cell layer), Rundown, Studio (compose + Render & Gate), Calendar, Board, Metrics, Sources.
 * The front has one component per theme; every other screen is one module in both themes.
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
import { lazy, Suspense } from "react";
import { api, qk } from "./api";
import { PagePending } from "./components/arrive";
import { Nav } from "./components/Nav";
import { WipeProvider } from "./components/ui";
import { calendarQuery, heatmapQuery, metricsQuery, projectQuery, projectsQuery, sourcesQuery } from "./data";
import { queryClient } from "./queryClient";
import { useTheme } from "./theme";

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
const FrontPage = lazy(() => import("./routes/Front").then((m) => ({ default: m.FrontPage })));
const FrontPhotoFinish = lazy(() => import("./routes/FrontPhotoFinish").then((m) => ({ default: m.FrontPhotoFinish })));

function RootLayout() {
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

function RouteError({ error }: { error: unknown }) {
  return (
    <main id="main" className="page">
      <div className="failure" role="alert">
        <b>This screen failed</b>
        <span className="mono">{error instanceof Error ? error.message : String(error)}</span>
        <Link to="/">Back to the front</Link>
      </div>
    </main>
  );
}

const SPORTS: readonly string[] = ["F1", "NBA", "NHL", "Soccer"];
export const asMode = (v: unknown): Mode | undefined =>
  v === "non_commercial" ? "non_commercial" : v === "monetized" ? "monetized" : undefined;
export const asSport = (v: unknown): Sport | undefined =>
  typeof v === "string" && SPORTS.includes(v) ? (v as Sport) : undefined;

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFound, errorComponent: RouteError });

/** The front: A/1's floodlit front in On Air, A/3's finish frame in Photo Finish. */
function FrontRoute() {
  const { theme } = useTheme();
  return (
    <Suspense fallback={<PagePending />}>{theme === "photofinish" ? <FrontPhotoFinish /> : <FrontPage />}</Suspense>
  );
}

export type FrontSearch = { format?: string; sport?: Sport; mode?: Mode };
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (s: Record<string, unknown>): FrontSearch => ({
    format: typeof s.format === "string" ? s.format : undefined,
    sport: asSport(s.sport),
    mode: asMode(s.mode),
  }),
  component: FrontRoute,
  // the theme is on <html> before first paint (index.html), so the right front chunk is known now
  loader: async () => {
    warm(projectsQuery, metricsQuery, heatmapQuery);
    await (document.documentElement.dataset.theme === "photofinish"
      ? import("./routes/FrontPhotoFinish")
      : import("./routes/Front"));
  },
});

/**
 * Heatmap layer 1 (the grid) is the parent; layer 2 (one cell) is a child rendered as a full layer
 * over the grid, so the grid keeps its place and focus when the layer closes.
 * `focus` = "<usecase>|<sport>" names the cell to focus on the grid (`cell` is its legacy name).
 */
export type HeatmapSearch = { mode?: Mode; focus?: string };
export const heatmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/heatmap",
  validateSearch: (s: Record<string, unknown>): HeatmapSearch => ({
    mode: asMode(s.mode),
    focus: typeof s.focus === "string" ? s.focus : typeof s.cell === "string" ? s.cell : undefined,
  }),
  component: HeatmapPage,
  loader: () => warm(heatmapQuery, sourcesQuery),
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
  loader: () => warm(projectsQuery, metricsQuery),
});

const studioIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio",
  component: StudioIndex,
  loader: () => warm(projectsQuery),
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
